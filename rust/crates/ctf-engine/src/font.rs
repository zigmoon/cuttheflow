//! Recherche d'une police TrueType pour les clips texte.
//!
//! `drawtext` a besoin d'un fichier de police. On privilégie `CTF_FONT`, puis
//! les polices système usuelles. Le fichier choisi est copié dans le dossier de
//! travail sous un nom simple (`ctf-font.ttf`) : le chemin du filtre ne contient
//! alors ni lecteur Windows (`C:`) ni espace, ce qui évite les échappements
//! fragiles de ffmpeg.

use std::path::{Path, PathBuf};

pub fn default_font() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("CTF_FONT") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["fonts/Inter-Regular.ttf", "fonts/Arial.ttf", "ctf-font.ttf"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    let candidates: &[&str] = if cfg!(windows) {
        &[
            r"C:\Windows\Fonts\segoeui.ttf",
            r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\calibri.ttf",
            r"C:\Windows\Fonts\tahoma.ttf",
        ]
    } else if cfg!(target_os = "macos") {
        &[
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Verdana.ttf",
        ]
    } else {
        &[
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        ]
    };

    candidates
        .iter()
        .map(Path::new)
        .find(|path| path.is_file())
        .map(Path::to_path_buf)
}

/// Copie la police sous un nom neutre dans le dossier de travail.
pub fn stage_font(source: &Path, work_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let destination = work_dir.join(file_name);
    if source == destination {
        return Ok(destination);
    }
    std::fs::copy(source, &destination).map_err(|e| {
        format!(
            "copie de la police « {} » impossible : {e}",
            source.display()
        )
    })?;
    Ok(destination)
}
