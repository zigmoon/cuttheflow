//! Ressources web embarquées (générées par `build.rs`).

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

/// Préfixe du déploiement web (`app.zigmoon.com/CUTTHEFLOW`).
///
/// Le site est compilé avec `base: '/CUTTHEFLOW'` pour tenir dans ce
/// sous-dossier ; le binaire, lui, sert à la racine. Une même compilation sert
/// donc les deux : on retire le préfixe s'il est présent.
const WEB_BASE: &str = "/CUTTHEFLOW";

/// Retourne (contenu, type MIME) pour un chemin d'URL.
pub fn find(path: &str) -> Option<(&'static [u8], &'static str)> {
    let path = match path.strip_prefix(WEB_BASE) {
        Some(rest) if rest.is_empty() => "/",
        Some(rest) if rest.starts_with('/') => rest,
        _ => path,
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str) -> Option<&'static [u8]> {
        find(path).map(|(bytes, _)| bytes)
    }

    #[test]
    fn racine_sert_index() {
        assert_eq!(entry("/"), entry("/index.html"));
        assert!(entry("/").is_some());
    }

    #[test]
    fn prefixe_web_accepte() {
        // Déploiement app.zigmoon.com/CUTTHEFLOW : le HTML réclame
        // `/CUTTHEFLOW/_astro/…`, le binaire doit répondre pareil.
        assert_eq!(entry("/CUTTHEFLOW"), entry("/index.html"));
        assert_eq!(entry("/CUTTHEFLOW/"), entry("/index.html"));
        for (path, bytes, _) in ASSETS {
            assert!(
                entry(&format!("{WEB_BASE}{path}")).is_some(),
                "préfixe non résolu pour {path}"
            );
            assert_eq!(entry(&format!("{WEB_BASE}{path}")), Some(*bytes));
        }
    }

    #[test]
    fn chemin_inconnu_absent() {
        assert!(entry("/absent.js").is_none());
    }
}
