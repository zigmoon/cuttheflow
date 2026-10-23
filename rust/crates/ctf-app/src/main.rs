//! CUT THE FLOW — point d'entrée.
//!
//! `serve`  : ouvre l'interface Astro et l'API d'import/export sur 127.0.0.1.
//! `doctor` : vérifie ffmpeg, ffprobe, les encodeurs et la police.
//! `probe`  : affiche les métadonnées d'un média (mêmes règles que l'import).
//! `export` : exporte un projet JSON sans navigateur (banc de régression, CI).

mod assets;
#[cfg(feature = "desktop")]
mod desktop;
mod server;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ctf_core::model::{ExportFormat, Project};
use ctf_engine::{export, ExportOptions, Ffmpeg};
use serde_json::{json, Value};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        // Double-clic sur le binaire : on démarre le studio et on ouvre le
        // navigateur. C'est le comportement attendu d'une application de bureau.
        None => serve(&[]),
        Some("--help") | Some("-h") | Some("help") => {
            print_usage();
            Ok(())
        }
        Some("--version") | Some("-V") => {
            println!("cuttheflow {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some("doctor") => doctor(),
        Some("probe") => probe(&args[1..]),
        Some("export") => export_command(&args[1..]),
        Some("serve") => serve(&args[1..]),
        Some(other) => Err(format!(
            "commande inconnue « {other} »\nLancez `cuttheflow --help`."
        )),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("❌ {error}");
            ExitCode::FAILURE
        }
    }
}

fn print_usage() {
    println!(
        "CUT THE FLOW {version} — moteur d'import/export

USAGE
  cuttheflow [serve] [--port 7317] [--host 127.0.0.1] [--root <dossier>] [--no-open]
  cuttheflow doctor
  cuttheflow probe <média>
  cuttheflow export <projet.json> --out <sortie> [--format mp4|webm|mp3]
                    [--crf N] [--preset medium] [--keep-work]

Sans commande, `serve` est lancé et le navigateur s'ouvre.

ffmpeg est cherché dans CTF_FFMPEG / CTF_FFPROBE, à côté de l'exécutable, puis
dans le PATH. La police des clips texte suit le même ordre (CTF_FONT).",
        version = env!("CARGO_PKG_VERSION")
    );
}

fn doctor() -> Result<(), String> {
    let ffmpeg = Ffmpeg::discover()?;
    let info = ffmpeg.info()?;
    let font = ctf_engine::default_font();
    let report = json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "ffmpeg": info.ffmpeg,
        "ffprobe": info.ffprobe,
        "ffmpeg_version": info.version,
        "encoders": info.encoders,
        "font": font.as_ref().map(|path| path.display().to_string()),
        "required_encoders": {
            "libx264": info.encoders.iter().any(|e| e == "libx264"),
            "libvpx-vp9": info.encoders.iter().any(|e| e == "libvpx-vp9"),
            "libopus": info.encoders.iter().any(|e| e == "libopus"),
            "libmp3lame": info.encoders.iter().any(|e| e == "libmp3lame"),
            "aac": info.encoders.iter().any(|e| e == "aac")
        }
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    Ok(())
}

fn probe(args: &[String]) -> Result<(), String> {
    let path = args
        .iter()
        .find(|arg| !arg.starts_with("--"))
        .ok_or_else(|| "probe : chemin du média manquant".to_string())?;
    let path = PathBuf::from(path);
    let ffmpeg = Ffmpeg::discover()?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let media = ffmpeg.probe(&path, "probe", name, size)?;
    println!("{}", serde_json::to_string_pretty(&media).unwrap());
    Ok(())
}

fn export_command(args: &[String]) -> Result<(), String> {
    let mut project_path: Option<PathBuf> = None;
    let mut output: Option<PathBuf> = None;
    let mut format: Option<ExportFormat> = None;
    let mut crf: Option<u8> = None;
    let mut preset: Option<String> = None;
    let mut keep_work = false;

    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        match arg.as_str() {
            "--out" | "-o" => {
                index += 1;
                output = args.get(index).map(PathBuf::from);
            }
            "--format" | "-f" => {
                index += 1;
                format = Some(ExportFormat::parse(
                    args.get(index)
                        .ok_or_else(|| "--format attend mp4, webm ou mp3".to_string())?,
                )?);
            }
            "--crf" => {
                index += 1;
                crf = Some(
                    args.get(index)
                        .and_then(|value| value.parse::<u8>().ok())
                        .ok_or_else(|| "--crf attend un nombre".to_string())?,
                );
            }
            "--preset" => {
                index += 1;
                preset = args.get(index).cloned();
            }
            "--keep-work" => keep_work = true,
            other if other.starts_with("--") => {
                return Err(format!("option inconnue : {other}"));
            }
            other => project_path = Some(PathBuf::from(other)),
        }
        index += 1;
    }

    let project_path =
        project_path.ok_or_else(|| "export : chemin du projet JSON manquant".to_string())?;
    let output = output.ok_or_else(|| "export : --out est obligatoire".to_string())?;

    let text = std::fs::read_to_string(&project_path)
        .map_err(|e| format!("projet « {} » : {e}", project_path.display()))?;
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("projet JSON : {e}"))?;
    let project_value = value.get("project").cloned().unwrap_or(value.clone());
    let mut project: Project =
        serde_json::from_value(project_value).map_err(|e| format!("projet invalide : {e}"))?;

    if let Some(format) = format {
        project.export.format = format;
    }
    if let Some(crf) = crf {
        project.export.crf = crf;
    }
    if let Some(preset) = preset {
        project.export.preset = preset;
    }
    if let Some(override_format) = value.get("format").and_then(Value::as_str) {
        project.export.format = ExportFormat::parse(override_format)?;
    }
    // Un CRF de 18 est un excellent réglage x264 mais très lent en VP9 : si
    // l'appelant n'a rien précisé, on applique le réglage VP9 par défaut.
    if project.export.format == ExportFormat::Webm && project.export.crf == 18 && crf.is_none() {
        project.export.crf = 30;
    }

    project.validate()?;
    for track in &project.tracks {
        for clip in &track.clips {
            if let Some(feature) = clip.needs_browser_render() {
                return Err(format!(
                    "ce projet utilise « {feature} », que le moteur natif ne rend pas encore — exportez-le depuis le navigateur"
                ));
            }
        }
    }
    let ffmpeg = Ffmpeg::discover()?;
    let mut options = ExportOptions::new(&output, project.export.format);
    options.crf = project.export.crf;
    options.preset = project.export.preset.clone();
    options.keep_work = keep_work;

    eprintln!(
        "Export {} → {} ({}×{} @ {})",
        project.name,
        output.display(),
        project.width,
        project.height,
        project.fps.as_ratio()
    );

    let mut last_percent = -10i32;
    let result = export(&ffmpeg, &project, &options, |progress| {
        let percent = progress.percent as i32;
        if percent >= last_percent + 5 || percent >= 100 {
            last_percent = percent;
            eprintln!("  {:3} % · {}", percent, progress.message);
        }
    })?;
    println!("{}", serde_json::to_string_pretty(&result).unwrap());
    Ok(())
}

fn serve(args: &[String]) -> Result<(), String> {
    let mut options = server::ServerOptions::default();
    // Un binaire compilé avec la fenêtre native l'ouvre par défaut : c'est ce
    // qu'on attend d'une application de bureau. `--web` force le navigateur.
    let mut native = cfg!(feature = "desktop");
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--port" | "-p" => {
                index += 1;
                options.port = args
                    .get(index)
                    .and_then(|value| value.parse::<u16>().ok())
                    .ok_or_else(|| "--port attend un nombre".to_string())?;
            }
            "--host" => {
                index += 1;
                options.host = args
                    .get(index)
                    .cloned()
                    .ok_or_else(|| "--host attend une adresse".to_string())?;
            }
            "--root" => {
                index += 1;
                options.root = args
                    .get(index)
                    .map(PathBuf::from)
                    .ok_or_else(|| "--root attend un dossier".to_string())?;
            }
            "--no-open" => options.open_browser = false,
            "--open" => options.open_browser = true,
            // Fenêtre native (WebView du système) au lieu d'un navigateur.
            "--native" => native = true,
            // Force le mode navigateur même sur un binaire « desktop ».
            "--web" => native = false,
            other => return Err(format!("option inconnue : {other}")),
        }
        index += 1;
    }

    // ffmpeg manquant ne doit plus être fatal : le studio sert l'interface en
    // mode navigateur (WebCodecs) et l'annonce. Un utilisateur qui n'a jamais
    // installé ffmpeg obtient un éditeur qui marche, pas une erreur au lancement.
    let (ffmpeg, ffmpeg_error) = match Ffmpeg::discover() {
        Ok(tool) => (Some(tool), None),
        Err(error) => (None, Some(error)),
    };
    if native {
        return server::run_native(ffmpeg, ffmpeg_error, options);
    }
    server::run(ffmpeg, ffmpeg_error, options)
}

#[allow(dead_code)]
fn display(path: &Path) -> String {
    path.display().to_string()
}
