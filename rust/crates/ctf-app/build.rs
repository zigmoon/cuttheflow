//! Incorpore le site Astro compilé dans le binaire.
//!
//! Le binaire est ainsi un exécutable unique : `astro/dist` est lu à la
//! compilation, chaque fichier devient une entrée `include_bytes!`. Si le site
//! n'a pas encore été construit (`npm run build` dans `astro/`), une page de
//! secours est embarquée : le binaire reste compilable et explique quoi faire,
//! au lieu d'échouer sur un dossier absent.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let dist = manifest
        .join("..")
        .join("..")
        .join("..")
        .join("astro")
        .join("dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    println!("cargo:rerun-if-env-changed=CTF_WEB_DIR");

    let dist = env::var("CTF_WEB_DIR")
        .map(PathBuf::from)
        .unwrap_or(dist);

    let mut entries = String::new();
    let mut count = 0usize;
    if dist.is_dir() {
        walk(&dist, &dist, &mut entries, &mut count);
    }

    if count == 0 {
        entries.push_str("(\"/index.html\", FALLBACK.as_bytes(), \"text/html; charset=utf-8\"),\n");
    }

    let fallback_const = format!(
        "#[allow(dead_code)]\npub const FALLBACK: &str = r#\"{FALLBACK_HTML}\"#;"
    );
    let source = format!(
        "// Généré par build.rs — ne pas modifier.\npub static ASSETS: &[(&str, &[u8], &str)] = &[\n{entries}];\n\n{fallback_const}\n"
    );

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out_dir.join("assets.rs"), source).expect("écriture de assets.rs");
    if count == 0 {
        println!(
            "cargo:warning=astro/dist introuvable ({}) : le binaire servira une page de secours. Lancez `npm run build` dans astro/.",
            dist.display()
        );
    }
}

fn walk(root: &Path, dir: &Path, entries: &mut String, count: &mut usize) {
    let mut children: Vec<_> = match fs::read_dir(dir) {
        Ok(iter) => iter.filter_map(Result::ok).collect(),
        Err(_) => return,
    };
    children.sort_by_key(|entry| entry.file_name());

    for entry in children {
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, entries, count);
            continue;
        }
        let relative = match path.strip_prefix(root) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let url = format!("/{}", relative.to_string_lossy().replace('\\', "/"));
        let mime = mime_for(&path);
        let literal = path.display().to_string().replace('\\', "\\\\");
        entries.push_str(&format!(
            "(\"{url}\", include_bytes!(\"{literal}\"), \"{mime}\"),\n"
        ));
        *count += 1;
    }
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "webmanifest" => "application/manifest+json",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

const FALLBACK_HTML: &str = r#"<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>CUT THE FLOW — interface non compilée</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#0b0b0e;color:#e8e8ef;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:640px;padding:32px;border:1px solid #2a2a33;border-radius:16px;background:#121218}
code{background:#1c1c24;padding:2px 6px;border-radius:6px}</style></head>
<body><main><h1>CUT THE FLOW</h1>
<p>Le moteur Rust est prêt, mais l'interface Astro n'a pas été compilée.</p>
<p>Dans le dossier <code>astro/</code> :</p>
<pre><code>npm install
npm run build</code></pre>
<p>puis recompilez : <code>cargo build --release</code>.</p>
<p>Le moteur reste utilisable en ligne de commande : <code>cuttheflow doctor</code>.</p>
</main></body></html>"#;
