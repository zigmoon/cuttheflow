//! Découverte et exécution de ffmpeg / ffprobe.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use ctf_core::model::Media;
use ctf_core::probe::parse_probe;

#[derive(Debug, Clone)]
pub struct Ffmpeg {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FfmpegInfo {
    pub ffmpeg: String,
    pub ffprobe: String,
    pub version: String,
    pub encoders: Vec<String>,
}

impl Ffmpeg {
    /// Cherche ffmpeg dans cet ordre : variables d'environnement, dossier de
    /// l'exécutable, PATH. Le premier candidat qui répond à `-version` gagne.
    pub fn discover() -> Result<Self, String> {
        let mut candidates: Vec<(PathBuf, PathBuf)> = Vec::new();

        if let (Ok(ffmpeg), Ok(ffprobe)) = (std::env::var("CTF_FFMPEG"), std::env::var("CTF_FFPROBE")) {
            candidates.push((PathBuf::from(ffmpeg), PathBuf::from(ffprobe)));
        } else if let Ok(ffmpeg) = std::env::var("CTF_FFMPEG") {
            let ffmpeg_path = PathBuf::from(&ffmpeg);
            candidates.push((ffmpeg_path.clone(), sibling(&ffmpeg_path, "ffprobe")));
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push((dir.join(exe_name("ffmpeg")), dir.join(exe_name("ffprobe"))));
                candidates.push((
                    dir.join("ffmpeg").join(exe_name("ffmpeg")),
                    dir.join("ffmpeg").join(exe_name("ffprobe")),
                ));
            }
        }

        candidates.push((PathBuf::from(exe_name("ffmpeg")), PathBuf::from(exe_name("ffprobe"))));

        let mut last_error = String::from("ffmpeg introuvable");
        for (ffmpeg, ffprobe) in candidates {
            let candidate = Ffmpeg { ffmpeg, ffprobe };
            match candidate.version() {
                Ok(_) => return Ok(candidate),
                Err(error) => last_error = error,
            }
        }
        Err(format!(
            "{last_error}\nInstallez ffmpeg, ou définissez CTF_FFMPEG et CTF_FFPROBE vers les exécutables."
        ))
    }

    pub fn version(&self) -> Result<String, String> {
        let output = hidden(&mut Command::new(&self.ffmpeg))
            .arg("-hide_banner")
            .arg("-version")
            .output()
            .map_err(|e| format!("ffmpeg « {} » : {e}", self.ffmpeg.display()))?;
        if !output.status.success() {
            return Err(format!(
                "ffmpeg « {} » ne démarre pas ({})",
                self.ffmpeg.display(),
                first_line(&output.stderr)
            ));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        Ok(text.lines().next().unwrap_or("ffmpeg").trim().to_string())
    }

    pub fn info(&self) -> Result<FfmpegInfo, String> {
        let version = self.version()?;
        let output = hidden(&mut Command::new(&self.ffmpeg))
            .args(["-hide_banner", "-encoders"])
            .output()
            .map_err(|e| format!("ffmpeg -encoders : {e}"))?;
        let encoders = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.split_whitespace().nth(1).map(str::to_string))
            .filter(|name| {
                matches!(
                    name.as_str(),
                    "libx264" | "libvpx-vp9" | "libopus" | "libmp3lame" | "aac" | "pcm_f32le"
                )
            })
            .collect();
        Ok(FfmpegInfo {
            ffmpeg: self.ffmpeg.display().to_string(),
            ffprobe: self.ffprobe.display().to_string(),
            version,
            encoders,
        })
    }

    pub fn probe(&self, path: &Path, id: &str, name: &str, size_bytes: u64) -> Result<Media, String> {
        let output = hidden(&mut Command::new(&self.ffprobe))
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
            ])
            .arg(path)
            .output()
            .map_err(|e| format!("ffprobe « {} » : {e}", self.ffprobe.display()))?;
        if !output.status.success() {
            return Err(format!(
                "ffprobe a refusé « {} » : {}",
                path.display(),
                first_line(&output.stderr)
            ));
        }
        let json = String::from_utf8_lossy(&output.stdout);
        parse_probe(
            &json,
            id,
            name,
            &path.to_string_lossy(),
            size_bytes,
        )
    }
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct StreamSummary {
    pub duration_us: i64,
    pub width: u32,
    pub height: u32,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub video_frames: i64,
}

impl Ffmpeg {
    /// Résumé d'un fichier produit (durée, codecs, taille réelle des images).
    pub fn summarize(&self, path: &Path) -> Result<StreamSummary, String> {
        let output = hidden(&mut Command::new(&self.ffprobe))
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
            ])
            .arg(path)
            .output()
            .map_err(|e| format!("ffprobe : {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "ffprobe a refusé « {} » : {}",
                path.display(),
                first_line(&output.stderr)
            ));
        }
        let root: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|e| format!("ffprobe JSON : {e}"))?;

        let mut summary = StreamSummary::default();
        summary.duration_us = root
            .pointer("/format/duration")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| value.parse::<f64>().ok())
            .map(|seconds| (seconds * 1_000_000.0).round() as i64)
            .unwrap_or(0);

        if let Some(streams) = root.get("streams").and_then(serde_json::Value::as_array) {
            for stream in streams {
                match stream
                    .get("codec_type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                {
                    "video" => {
                        summary.width = stream
                            .get("width")
                            .and_then(serde_json::Value::as_u64)
                            .unwrap_or(0) as u32;
                        summary.height = stream
                            .get("height")
                            .and_then(serde_json::Value::as_u64)
                            .unwrap_or(0) as u32;
                        summary.video_codec = stream
                            .get("codec_name")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string);
                    }
                    "audio" if summary.audio_codec.is_none() => {
                        summary.audio_codec = stream
                            .get("codec_name")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string);
                    }
                    _ => {}
                }
            }
        }

        summary.video_frames = self.count_video_packets(path).unwrap_or(0);
        Ok(summary)
    }

    /// Compte les paquets vidéo sans décoder les images (`-count_packets`).
    pub fn count_video_packets(&self, path: &Path) -> Result<i64, String> {
        let output = hidden(&mut Command::new(&self.ffprobe))
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_packets",
                "-show_entries",
                "stream=nb_read_packets",
                "-of",
                "default=nw=1:nk=1",
            ])
            .arg(path)
            .output()
            .map_err(|e| format!("ffprobe : {e}"))?;
        if !output.status.success() {
            return Err(first_line(&output.stderr));
        }
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<i64>()
            .map_err(|_| "ffprobe : nombre d'images illisible".to_string())
    }
}

fn sibling(path: &Path, name: &str) -> PathBuf {
    let filename = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    match path.parent() {
        Some(dir) => dir.join(filename),
        None => PathBuf::from(filename),
    }
}

fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn first_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Empêche l'ouverture d'une console noire à chaque lancement sous Windows.
pub fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Lance ffmpeg en suivant `-progress pipe:1`. Le pourcentage est calculé sur
/// `out_time_us` rapporté à `expected_us`. Le processus est tué si `cancel`
/// passe à `true`.
pub fn run_ffmpeg(
    ffmpeg: &Path,
    args: &[String],
    cwd: Option<&Path>,
    expected_us: i64,
    mut on_progress: impl FnMut(f32),
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let mut command = Command::new(ffmpeg);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    hidden(&mut command);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Impossible de lancer ffmpeg : {e}"))?;

    let stderr = child.stderr.take().expect("stderr piped");
    let stderr_thread = thread::spawn(move || {
        let mut lines: Vec<String> = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(|line| line.ok()) {
            if lines.len() < 400 {
                lines.push(line);
            }
        }
        lines
    });

    let stdout = child.stdout.take().expect("stdout piped");
    let mut cancelled = false;
    for line in BufReader::new(stdout).lines().map_while(|line| line.ok()) {
        if let Some(value) = line.strip_prefix("out_time_us=") {
            if let Ok(us) = value.trim().parse::<i64>() {
                if expected_us > 0 {
                    let percent = (us.max(0) as f64 / expected_us as f64 * 100.0).clamp(0.0, 99.9);
                    on_progress(percent as f32);
                }
            }
        }
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                let _ = child.kill();
                cancelled = true;
                break;
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg : attente du processus impossible ({e})"))?;
    let stderr_lines = stderr_thread.join().unwrap_or_default();

    if cancelled {
        return Err("Export annulé".into());
    }
    if !status.success() {
        let tail = stderr_lines
            .iter()
            .rev()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("ffmpeg a échoué :\n{tail}"));
    }
    on_progress(100.0);
    Ok(())
}
