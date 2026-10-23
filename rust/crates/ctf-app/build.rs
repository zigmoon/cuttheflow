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
    let root = manifest.join("..").join("..").join("..");
    let dist = root.join("astro").join("dist");
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

    embed_windows_resources(&manifest, &root);
}

/// Icône et métadonnées du `.exe`.
///
/// Sans elles, Explorer affiche une icône générique et les propriétés du fichier
/// n'ont ni éditeur ni version : l'application paraît bricolée. Le fichier
/// `.rc` est généré ici pour que la version ne soit jamais recopiée à la main.
///
/// Un échec n'interrompt pas la compilation : mieux vaut un binaire sans icône
/// qu'un build cassé sur une machine sans compilateur de ressources.
fn embed_windows_resources(manifest: &Path, root: &Path) {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let icon = manifest.join("..").join("..").join("scripts").join("icons").join("cuttheflow.ico");
    println!("cargo:rerun-if-changed={}", icon.display());
    if !icon.is_file() {
        println!(
            "cargo:warning=icône Windows absente ({}) : le .exe n'aura pas d'icône.",
            icon.display()
        );
        return;
    }

    // Version moteur = version du binaire ; version studio = celle de l'interface.
    let engine = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into());
    let studio = fs::read_to_string(root.join("astro").join("package.json"))
        .ok()
        .and_then(|text| studio_version(&text))
        .unwrap_or_else(|| engine.clone());

    let quad = |v: &str| {
        let mut parts: Vec<u32> = v
            .split(['.', '-', '+'])
            .take(3)
            .map(|p| p.parse().unwrap_or(0))
            .collect();
        while parts.len() < 3 {
            parts.push(0);
        }
        format!("{},{},{},0", parts[0], parts[1], parts[2])
    };

    let rc = format!(
        "1 ICON \"{}\"\n\
         1 VERSIONINFO\n\
         FILEVERSION {}\n\
         PRODUCTVERSION {}\n\
         FILEOS 0x40004L\n\
         FILETYPE 0x1L\n\
         BEGIN\n\
           BLOCK \"StringFileInfo\"\n\
           BEGIN\n\
             BLOCK \"040C04B0\"\n\
             BEGIN\n\
               VALUE \"CompanyName\", \"Zigmoon\"\n\
               VALUE \"FileDescription\", \"CUT THE FLOW - studio de montage\"\n\
               VALUE \"FileVersion\", \"{}\"\n\
               VALUE \"InternalName\", \"cuttheflow\"\n\
               VALUE \"LegalCopyright\", \"Zigmoon\"\n\
               VALUE \"OriginalFilename\", \"cuttheflow.exe\"\n\
               VALUE \"ProductName\", \"CUT THE FLOW\"\n\
               VALUE \"ProductVersion\", \"{}\"\n\
             END\n\
           END\n\
           BLOCK \"VarFileInfo\"\n\
           BEGIN\n\
             VALUE \"Translation\", 0x40C, 1200\n\
           END\n\
         END\n",
        icon.display().to_string().replace('\\', "\\\\"),
        quad(&engine),
        quad(&studio),
        engine,
        studio,
    );

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let rc_path = out_dir.join("resources.rc");
    if fs::write(&rc_path, rc).is_err() {
        println!("cargo:warning=écriture du fichier .rc impossible");
        return;
    }

    match compile_resource(&rc_path, &out_dir) {
        Ok(()) => println!("cargo:rustc-link-arg={}", out_dir.join("resources.res").display()),
        Err(reason) => println!("cargo:warning=ressources Windows non incorporées : {reason}"),
    }
}

/// Extrait `"version": "x.y.z"` de `package.json` sans dépendre d'un parseur JSON.
fn studio_version(json: &str) -> Option<String> {
    let start = json.find("\"version\"")?;
    let rest = &json[start..];
    let value = rest.split('"').nth(3)?;
    if value.chars().next()?.is_ascii_digit() {
        Some(value.to_string())
    } else {
        None
    }
}

/// Cherche un compilateur de ressources et compile `resources.rc`.
fn compile_resource(rc: &Path, out_dir: &Path) -> Result<(), String> {
    const CANDIDATES: [&str; 4] = ["llvm-rc", "windres", "x86_64-w64-mingw32-windres", "rc"];
    let mut tried: Vec<String> = Vec::new();

    // `rc.exe` n'est pas toujours dans le PATH, même quand le SDK Windows est
    // installé : sur un runner MSVC, seul `link.exe` est résolu par rustc. On
    // le cherche donc aussi dans les kits, sinon les binaires de la CI
    // sortiraient sans icône alors que ceux d'ici en ont une.
    let mut tools: Vec<String> = CANDIDATES.iter().map(|t| t.to_string()).collect();
    if let Some(sdk) = windows_sdk_rc() {
        tools.push(sdk);
    }

    for tool in tools {
        // windres et llvm-rc veulent `-fo`, le rc.exe de Microsoft `/fo`.
        let output_flag = if tool.contains("windres") || tool.contains("llvm-rc") {
            "-fo"
        } else {
            "/fo"
        };
        let status = std::process::Command::new(&tool)
            .arg(output_flag)
            .arg(out_dir.join("resources.res"))
            .arg(rc)
            .status();
        match status {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => tried.push(format!("{tool} : code {status}")),
            Err(_) => tried.push(format!("{tool} : introuvable")),
        }
    }
    Err(tried.join(", "))
}

/// `rc.exe` du SDK Windows, s'il est installé (chemin complet).
fn windows_sdk_rc() -> Option<String> {
    let base = env::var("WindowsSdkDir")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            env::var("ProgramFiles(x86)")
                .ok()
                .map(|p| PathBuf::from(p).join("Windows Kits").join("10"))
        })?;
    let bin = base.join("bin");
    let mut versions: Vec<PathBuf> = fs::read_dir(&bin)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    versions.sort();
    versions.reverse();
    for version in versions {
        for arch in ["x64", "x86"] {
            let candidate = version.join(arch).join("rc.exe");
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
        }
    }
    None
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
