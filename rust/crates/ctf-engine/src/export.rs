//! Orchestration d'un export : mixage audio → composition vidéo → ffprobe.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use ctf_core::graph::{
    build_audio_graph, build_video_graph, shape_alpha_expression, FONT_FILE_NAME, InputKind,
    ShapeAsset,
};
use ctf_core::model::{ExportFormat, Project};
use ctf_core::time::{secs, Micros};

use crate::ffmpeg::{run_ffmpeg, Ffmpeg};
use crate::{font, wav};

#[derive(Debug, Clone)]
pub struct ExportOptions {
    pub output: PathBuf,
    pub format: ExportFormat,
    pub crf: u8,
    pub preset: String,
    /// Dossier de travail (créé si absent). Par défaut : temporaire système.
    pub work_dir: Option<PathBuf>,
    /// Police des clips texte (sinon CTF_FONT / police système).
    pub font: Option<PathBuf>,
    /// Conserve le dossier de travail (graphes, WAV) pour le diagnostic.
    pub keep_work: bool,
    pub cancel: Option<Arc<AtomicBool>>,
}

impl ExportOptions {
    pub fn new(output: impl Into<PathBuf>, format: ExportFormat) -> Self {
        Self {
            output: output.into(),
            format,
            crf: if format == ExportFormat::Webm { 30 } else { 18 },
            preset: "medium".into(),
            work_dir: None,
            font: None,
            keep_work: false,
            cancel: None,
        }
    }

    pub fn from_project(project: &Project, output: impl Into<PathBuf>) -> Self {
        Self {
            crf: project.export.crf,
            preset: project.export.preset.clone(),
            format: project.export.format,
            ..Self::new(output, project.export.format)
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Progress {
    /// 0 → 100
    pub percent: f32,
    /// `audio`, `video`, `mux`, `done`
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExportResult {
    pub path: String,
    pub format: String,
    pub duration_us: Micros,
    pub frames: i64,
    pub width: u32,
    pub height: u32,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub size_bytes: u64,
    /// Gain appliqué au mixage (1.0 = aucun écrêtage détecté).
    pub audio_gain: f64,
    pub elapsed_ms: u128,
}

/// Exporte la timeline. La fonction est bloquante ; le serveur l'exécute dans
/// un fil de fond et lit l'avancement par le callback.
pub fn export(
    ffmpeg: &Ffmpeg,
    project: &Project,
    options: &ExportOptions,
    mut on_progress: impl FnMut(Progress),
) -> Result<ExportResult, String> {
    let started = SystemTime::now();
    project.validate()?;

    let timeline_us = project.timeline_end_us();
    if timeline_us <= 0 {
        return Err("timeline vide".into());
    }

    // ffmpeg tourne avec `current_dir` = dossier de travail : tout chemin
    // relatif serait résolu là-bas. On fige donc la sortie en absolu.
    let output_absolute = std::path::absolute(&options.output)
        .map_err(|e| format!("chemin de sortie « {} » : {e}", options.output.display()))?;
    let mut options = options.clone();
    options.output = output_absolute;

    if let Some(parent) = options.output.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("dossier de sortie « {} » : {e}", parent.display()))?;
        }
    }

    let work_dir = match &options.work_dir {
        Some(dir) => dir.clone(),
        None => default_work_dir(),
    };
    let work_dir = std::path::absolute(&work_dir).unwrap_or(work_dir);
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| format!("dossier de travail « {} » : {e}", work_dir.display()))?;

    let font_source = if has_text_clips(project) {
        let source = options
            .font
            .clone()
            .or_else(font::default_font)
            .ok_or_else(|| {
                "clip texte : aucune police trouvée. Définissez CTF_FONT vers un .ttf.".to_string()
            })?;
        font::stage_font(&source, &work_dir, FONT_FILE_NAME)?;
        Some(source)
    } else {
        None
    };

    let report = |percent: f32, stage: &str, message: &str| Progress {
        percent: percent.clamp(0.0, 100.0),
        stage: stage.to_string(),
        message: message.to_string(),
    };

    let result = run_export(
        ffmpeg,
        project,
        &options,
        &work_dir,
        font_source.is_some(),
        timeline_us,
        &mut on_progress,
        &report,
    );

    match &result {
        Ok(_) if !options.keep_work => {
            let _ = std::fs::remove_dir_all(&work_dir);
        }
        Err(error) if !options.keep_work => {
            // Un échec de filtre est illisible sans le graphe : on le conserve et
            // on indique où le trouver.
            eprintln!("Dossier de diagnostic conservé : {}", work_dir.display());
            let _ = error;
        }
        _ => {}
    }

    let mut result = result?;
    result.elapsed_ms = started.elapsed().map(|d| d.as_millis()).unwrap_or(0);
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn run_export(
    ffmpeg: &Ffmpeg,
    project: &Project,
    options: &ExportOptions,
    work_dir: &Path,
    font_available: bool,
    timeline_us: Micros,
    on_progress: &mut impl FnMut(Progress),
    report: &impl Fn(f32, &str, &str) -> Progress,
) -> Result<ExportResult, String> {
    let timeline_sec = secs(timeline_us);
    let cancel = options.cancel.as_ref();

    // ── 1. MIXAGE AUDIO ──────────────────────────────────────────────────
    let audio = build_audio_graph(project)?;
    let mut gain = 1.0f64;
    let mut mix_path: Option<PathBuf> = None;
    // Graphes conservés dans le dossier de travail : indispensables pour
    // diagnostiquer un export (le dossier n'est supprimé qu'en cas de succès).
    std::fs::write(work_dir.join("filter-audio.txt"), audio.filter.as_bytes()).ok();

    if audio.clip_count > 0 {
        on_progress(report(1.0, "audio", ""));
        let wav_path = work_dir.join("mix.wav");
        let mut args = base_args();
        for input in &audio.inputs {
            args.push("-i".into());
            args.push(arg_path(&input.path));
        }
        args.extend([
            "-filter_complex".into(),
            audio.filter.clone(),
            "-map".into(),
            "[aoutpad]".into(),
            "-c:a".into(),
            "pcm_f32le".into(),
            "-ar".into(),
            "48000".into(),
            "-ac".into(),
            "2".into(),
            "-t".into(),
            timeline_sec.clone(),
            wav_path.to_string_lossy().to_string(),
        ]);
        run_ffmpeg(
            &ffmpeg.ffmpeg,
            &args,
            Some(work_dir),
            timeline_us,
            |percent| {
                on_progress(report(
                    1.0 + percent * 0.11,
                    "audio",
                    "",
                ));
            },
            cancel,
        )?;

        let peak = wav::peak_of_wav(&wav_path)?;
        gain = wav::normalization_gain(peak);
        if gain < 1.0 {
            eprintln!(
                "mixdown: peak {:.3} -> {:.2} dB attenuation (never any amplification).",
                peak,
                20.0 * gain.log10()
            );
        }
        mix_path = Some(wav_path);
    }

    if options.format == ExportFormat::Mp3 {
        let mix = mix_path
            .as_ref()
            .ok_or_else(|| "no audio track: nothing to encode for the MP3 export".to_string())?;
        on_progress(report(14.0, "mux", ""));
        let mut args = base_args();
        args.push("-i".into());
        args.push(mix.to_string_lossy().to_string());
        args.extend([
            "-af".into(),
            format!("volume={gain:.6}"),
            "-c:a".into(),
            "libmp3lame".into(),
            "-b:a".into(),
            "192k".into(),
            "-ar".into(),
            "48000".into(),
            "-ac".into(),
            "2".into(),
            "-id3v2_version".into(),
            "3".into(),
            options.output.to_string_lossy().to_string(),
        ]);
        run_ffmpeg(
            &ffmpeg.ffmpeg,
            &args,
            Some(work_dir),
            timeline_us,
            |percent| {
                on_progress(report(
                    14.0 + percent * 0.86,
                    "mux",
                    "",
                ));
            },
            cancel,
        )?;
        return finish(ffmpeg, options, timeline_us, project, gain);
    }

    // ── 2. COMPOSITION VIDÉO ─────────────────────────────────────────────
    if let Some(flag) = cancel {
        if flag.load(Ordering::Relaxed) {
            return Err("export cancelled".into());
        }
    }
    let video = build_video_graph(project, font_available)?;
    std::fs::write(work_dir.join("filter-video.txt"), video.filter.as_bytes()).ok();
    for asset in &video.text_assets {
        std::fs::write(work_dir.join(&asset.file_name), asset.content.as_bytes())
            .map_err(|e| format!("écriture du texte « {} » : {e}", asset.file_name))?;
    }
    // Les formes sont rasterisées UNE fois (un `geq` par image serait
    // prohibitif) puis bouclées comme des images.
    for asset in &video.shape_assets {
        rasterize_shape(ffmpeg, asset, work_dir)?;
    }

    on_progress(report(13.0, "video", ""));
    let mut args = base_args();
    for input in &video.inputs {
        if input.kind == InputKind::Image {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-framerate".into(),
                input.fps.as_ratio(),
                "-t".into(),
                secs(input.loop_duration_us),
                "-i".into(),
                arg_path_in(&input.path, work_dir),
            ]);
        } else {
            args.push("-i".into());
            args.push(arg_path_in(&input.path, work_dir));
        }
    }

    let audio_index = video.inputs.len();
    if let Some(mix) = &mix_path {
        args.push("-i".into());
        args.push(mix.to_string_lossy().to_string());
    }

    // Le gain est appliqué DANS le graphe : `-af` cohabite mal avec
    // `-filter_complex` sur certaines versions de ffmpeg.
    let mut filter_complex = video.filter.clone();
    if mix_path.is_some() && gain < 1.0 {
        filter_complex.push_str(&format!(";{audio_index}:a volume={gain:.6}[aoutv]"));
    }
    args.extend([
        "-filter_complex".into(),
        filter_complex,
        "-map".into(),
        "[vout]".into(),
    ]);
    if mix_path.is_some() {
        if gain < 1.0 {
            args.extend(["-map".into(), "[aoutv]".into()]);
        } else {
            args.extend(["-map".into(), format!("{audio_index}:a")]);
        }
    }

    let vp9 = options.format == ExportFormat::Webm;
    if vp9 {
        args.extend([
            "-c:v".into(),
            "libvpx-vp9".into(),
            "-crf".into(),
            options.crf.to_string(),
            "-b:v".into(),
            "0".into(),
            "-row-mt".into(),
            "1".into(),
            "-deadline".into(),
            "good".into(),
            "-cpu-used".into(),
            "2".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-c:a".into(),
            "libopus".into(),
            "-b:a".into(),
            "128k".into(),
        ]);
    } else {
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            normalise_preset(&options.preset),
            "-crf".into(),
            options.crf.to_string(),
            "-profile:v".into(),
            "high".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-movflags".into(),
            "+faststart".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
        ]);
    }
    args.extend([
        "-ar".into(),
        "48000".into(),
        "-ac".into(),
        "2".into(),
        "-t".into(),
        timeline_sec,
        "-r".into(),
        project.fps.as_ratio(),
        options.output.to_string_lossy().to_string(),
    ]);

    run_ffmpeg(
        &ffmpeg.ffmpeg,
        &args,
        Some(work_dir),
        timeline_us,
        |percent| {
            on_progress(report(
                13.0 + percent * 0.87,
                "video",
                // Le pourcentage est déjà affiché par l'interface : ne pas le répéter ici.
                "",
            ));
        },
        cancel,
    )?;

    finish(ffmpeg, options, timeline_us, project, gain)
}

fn finish(
    ffmpeg: &Ffmpeg,
    options: &ExportOptions,
    timeline_us: Micros,
    project: &Project,
    gain: f64,
) -> Result<ExportResult, String> {
    let summary = ffmpeg.summarize(&options.output)?;
    let size_bytes = std::fs::metadata(&options.output).map(|m| m.len()).unwrap_or(0);
    if size_bytes < 512 {
        return Err(format!("fichier de sortie vide ({} octets)", size_bytes));
    }
    let expected = project.fps.frame_count(timeline_us);
    if summary.video_frames > 0 && (summary.video_frames - expected).abs() > 1 {
        return Err(format!(
            "nombre d'images inattendu : {} au lieu de {} — l'export n'est pas conforme",
            summary.video_frames, expected
        ));
    }
    Ok(ExportResult {
        path: options.output.to_string_lossy().to_string(),
        format: options.format.extension().to_string(),
        duration_us: summary.duration_us.max(timeline_us),
        frames: summary.video_frames.max(if options.format == ExportFormat::Mp3 { 0 } else { expected }),
        width: summary.width.max(if options.format == ExportFormat::Mp3 { 0 } else { project.width }),
        height: summary.height.max(if options.format == ExportFormat::Mp3 { 0 } else { project.height }),
        video_codec: summary.video_codec,
        audio_codec: summary.audio_codec,
        size_bytes,
        audio_gain: gain,
        elapsed_ms: 0,
    })
}

fn base_args() -> Vec<String> {
    [
        "-y",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
    ]
    .iter()
    .map(|value| value.to_string())
    .collect()
}

fn has_text_clips(project: &Project) -> bool {
    project
        .tracks
        .iter()
        .filter(|track| !track.muted)
        .flat_map(|track| track.clips.iter())
        .any(|clip| clip.kind == ctf_core::model::ClipKind::Text)
}

fn default_work_dir() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("ctf-export-{stamp}"))
}

fn normalise_preset(preset: &str) -> String {
    match preset.trim().to_ascii_lowercase().as_str() {
        "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow"
        | "slower" | "veryslow" => preset.trim().to_ascii_lowercase(),
        _ => "medium".into(),
    }
}

fn arg_path(path: &Path) -> String {
    std::path::absolute(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

/// Les ressources générées (formes) portent un chemin **relatif** au dossier de
/// travail ; les médias de l'utilisateur sont absolus.
fn arg_path_in(path: &Path, work_dir: &Path) -> String {
    if path.is_absolute() {
        arg_path(path)
    } else {
        arg_path(&work_dir.join(path))
    }
}

/// Dessine une forme en PNG RGBA transparent (un seul plan, `geq` sur l'alpha).
fn rasterize_shape(ffmpeg: &Ffmpeg, asset: &ShapeAsset, work_dir: &Path) -> Result<(), String> {
    let alpha = shape_alpha_expression(asset.kind, asset.width_px, asset.height_px, asset.radius_px);
    let color = asset.color.trim_start_matches("0x");
    let (r, g, b) = rgb_components(color);
    let filter = if alpha == "255" {
        format!("format=rgba,geq=r={r}:g={g}:b={b}:a=255")
    } else {
        format!("format=rgba,geq=r={r}:g={g}:b={b}:a='{alpha}'")
    };
    let mut args = base_args();
    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("nullsrc=s={}x{}", asset.width_px, asset.height_px),
        "-vf".into(),
        filter,
        "-frames:v".into(),
        "1".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        work_dir.join(&asset.file_name).to_string_lossy().to_string(),
    ]);
    run_ffmpeg(&ffmpeg.ffmpeg, &args, Some(work_dir), 0, |_| {}, None)
        .map_err(|e| format!("dessin de la forme « {} » : {e}", asset.file_name))
}

fn rgb_components(hex: &str) -> (String, String, String) {
    let digits: String = hex.chars().take(6).collect();
    if digits.len() != 6 {
        return ("0".into(), "0".into(), "0".into());
    }
    (
        format!("0x{}", &digits[0..2]),
        format!("0x{}", &digits[2..4]),
        format!("0x{}", &digits[4..6]),
    )
}
