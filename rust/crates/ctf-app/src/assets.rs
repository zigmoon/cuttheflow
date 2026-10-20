//! Ressources web embarquées (générées par `build.rs`).

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

/// Retourne (contenu, type MIME) pour un chemin d'URL.
pub fn find(path: &str) -> Option<(&'static [u8], &'static str)> {
    let normalized = if path.is_empty() || path == "/" {
        "/index.html"
    } else {
        path
    };
    ASSETS
        .iter()
        .find(|(candidate, _, _)| *candidate == normalized)
        .map(|(_, bytes, mime)| (*bytes, *mime))
}

/// Vrai si le chemin ressemble à un fichier (et non à une route de l'interface).
pub fn looks_like_file(path: &str) -> bool {
    Pathish::extension(path).is_some()
}

struct Pathish;

impl Pathish {
    fn extension(path: &str) -> Option<&str> {
        let file = path.rsplit('/').next().unwrap_or(path);
        file.rsplit_once('.').map(|(_, extension)| extension)
    }
}
