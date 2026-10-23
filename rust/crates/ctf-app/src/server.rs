//! Serveur HTTP local : l'interface Astro et l'API d'import/export.
//!
//! Pourquoi un serveur local plutôt qu'un simple fichier HTML : l'export doit
//! être identique sur toutes les machines. Le navigateur ne peut pas encoder
//! en H.264/AAC de façon déterministe, alors que ffmpeg le fait. L'interface
//! envoie donc la timeline au moteur Rust, qui rend le fichier ; le navigateur
//! ne sert qu'à l'édition et à la preview.
//!
//! Le serveur n'utilise que la bibliothèque standard : aucune dépendance
//! native, donc compilation triviale pour Windows, macOS et Linux.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use ctf_core::model::{ExportFormat, Media, Project};
use ctf_engine::{export, ExportOptions, ExportResult, Ffmpeg};
use serde::Serialize;
use serde_json::{json, Value};

use crate::assets;

// Origine CORS de la requête courante. Chaque connexion a son propre fil
// (thread par connexion), donc cette valeur ne fuit pas d'une requête à l'autre.
// Elle permet à `astro dev` (port 4321) de parler au moteur (port 7317) sans
// ouvrir le serveur à des origines distantes : seules les origines locales sont
// acceptées.
thread_local! {
    static CORS: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

fn set_cors(origin: &Option<String>) {
    CORS.with(|cell| {
        *cell.borrow_mut() = origin.as_ref().filter(|value| is_local_origin(value)).cloned();
    });
}

fn cors_headers() -> String {
    CORS.with(|cell| match cell.borrow().as_ref() {
        Some(origin) => format!(
            "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range\r\n"
        ),
        None => String::new(),
    })
}

fn is_local_origin(origin: &str) -> bool {
    origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("http://localhost:")
        || origin.starts_with("http://[::1]:")
}

const MAX_JSON_BODY: u64 = 16 * 1024 * 1024;
const MAX_UPLOAD_BODY: u64 = 64 * 1024 * 1024 * 1024;
const EXPORT_HISTORY: usize = 20;

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub host: String,
    pub port: u16,
    pub root: PathBuf,
    pub open_browser: bool,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 7317,
            root: default_root(),
            open_browser: true,
        }
    }
}

pub fn default_root() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("cuttheflow")
}

struct State {
    root: PathBuf,
    media_dir: PathBuf,
    export_dir: PathBuf,
    cache_dir: PathBuf,
    /// `None` quand ffmpeg est introuvable : le studio sert alors l'interface en
    /// mode navigateur (WebCodecs) au lieu de refuser de démarrer.
    ffmpeg: Option<Ffmpeg>,
    /// Explication lisible de l'absence de ffmpeg, relayée à l'interface.
    ffmpeg_error: Option<String>,
    ffmpeg_version: String,
    font: Option<PathBuf>,
    media: Mutex<HashMap<String, Media>>,
    jobs: Mutex<HashMap<String, Arc<JobHandle>>>,
    counter: AtomicU64,
    origins: Vec<String>,
    port: u16,
}

struct JobHandle {
    cancel: Arc<AtomicBool>,
    state: Mutex<Job>,
}

#[derive(Debug, Clone, Serialize)]
struct Job {
    id: String,
    status: String,
    progress: f32,
    stage: String,
    message: String,
    error: Option<String>,
    output: Option<ExportResult>,
    created_ms: u128,
}

pub fn run(ffmpeg: Option<Ffmpeg>, ffmpeg_error: Option<String>, options: ServerOptions) -> Result<(), String> {
    let root = options.root.clone();
    let media_dir = root.join("media");
    let export_dir = root.join("exports");
    let cache_dir = root.join("cache");
    for dir in [&media_dir, &export_dir, &cache_dir] {
        fs::create_dir_all(dir).map_err(|e| format!("dossier « {} » : {e}", dir.display()))?;
    }
    cleanup_exports(&export_dir, EXPORT_HISTORY);

    let ffmpeg_version = ffmpeg
        .as_ref()
        .and_then(|tool| tool.version().ok())
        .unwrap_or_else(|| "absent".into());
    let font = ctf_engine::default_font();
    let media = load_registry(&media_dir);

    let listener = TcpListener::bind((options.host.as_str(), options.port))
        .map_err(|e| format!("écoute sur {}:{} impossible : {e}", options.host, options.port))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("adresse locale illisible : {e}"))?
        .port();

    let origins = vec![
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
        format!("http://[::1]:{port}"),
    ];
    let url = format!("http://127.0.0.1:{port}/");

    let state = Arc::new(State {
        root,
        media_dir,
        export_dir,
        cache_dir,
        ffmpeg,
        ffmpeg_error,
        ffmpeg_version,
        font,
        media: Mutex::new(media),
        jobs: Mutex::new(HashMap::new()),
        counter: AtomicU64::new(1),
        origins,
        port,
    });

    println!("CUT THE FLOW — moteur prêt");
    println!("  interface : {url}");
    println!("  données   : {}", state.root.display());
    if state.ffmpeg.is_some() {
        println!("  ffmpeg    : {}", state.ffmpeg_version);
    } else {
        println!("  ffmpeg    : ABSENT — mode navigateur (export WebCodecs)");
        if let Some(error) = &state.ffmpeg_error {
            println!("              {error}");
        }
    }
    if state.font.is_none() {
        println!("  police    : aucune (clip texte indisponible — définissez CTF_FONT)");
    } else {
        println!("  police    : {}", state.font.as_ref().unwrap().display());
    }
    if options.open_browser {
        open_browser(&url);
    }

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = state.clone();
                thread::spawn(move || {
                    let peer = stream.peer_addr().ok();
                    if let Err(error) = handle_connection(state, stream) {
                        if peer.is_some() {
                            eprintln!("requête : {error}");
                        }
                    }
                });
            }
            Err(error) => eprintln!("connexion refusée : {error}"),
        }
    }
    Ok(())
}

fn handle_connection(state: Arc<State>, stream: TcpStream) -> Result<(), String> {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(120)))
        .ok();
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(120)))
        .ok();
    let mut reader = BufReader::new(stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).map_err(|e| e.to_string())? == 0 {
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    if method.is_empty() {
        return Ok(());
    }

    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);

    let origin = headers.get("origin").cloned();
    set_cors(&origin);

    if method == "OPTIONS" {
        if origin.as_deref().map(is_local_origin).unwrap_or(false) {
            let head = format!(
                "HTTP/1.1 204 No Content\r\n{}Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: content-type, range\r\nAccess-Control-Max-Age: 600\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                cors_headers()
            );
            reader
                .get_mut()
                .write_all(head.as_bytes())
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        return respond_json(&mut reader, 403, &json!({"error": "origine refusée"}));
    }

    if method != "GET" && method != "HEAD" {
        if let Some(origin) = &origin {
            if !is_local_origin(origin) && !state.origins.contains(origin) {
                return respond_json(
                    &mut reader,
                    403,
                    &json!({"error": "origine refusée"}),
                );
            }
        }
    }

    let (raw_path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_string(), parse_query(query)),
        None => (target.clone(), HashMap::new()),
    };
    // Le site est compilé pour `app.zigmoon.com/CUTTHEFLOW` : ses liens et ses
    // appels d'API portent ce préfixe. Le binaire sert la même compilation à la
    // racine, donc on normalise ici — interface ET API répondent alors sur les
    // deux formes.
    let path = strip_web_base(&percent_decode(&raw_path));

    if path == "/api/health" {
        // `ok: false` quand ffmpeg manque : l'interface bascule alors en mode
        // navigateur (WebCodecs) au lieu de croire le moteur opérationnel et
        // d'échouer au premier import. Le studio reste pleinement utilisable.
        let engine = state.ffmpeg.is_some();
        return respond_json(
            &mut reader,
            200,
            &json!({
                "ok": engine,
                "app": "cuttheflow",
                "version": env!("CARGO_PKG_VERSION"),
                "ffmpeg": state.ffmpeg_version,
                "engine": engine,
                "reason": state.ffmpeg_error,
                "font": state.font.as_ref().map(|p| p.display().to_string()),
                "media": state.media.lock().unwrap().len(),
                "port": state.port
            }),
        );
    }

    if path == "/api/import" && method == "POST" {
        return import_media(&state, &mut reader, &query, content_length);
    }

    if path == "/api/media" && method == "GET" {
        let list: Vec<Media> = state.media.lock().unwrap().values().cloned().collect();
        return respond_json(&mut reader, 200, &json!({ "media": list }));
    }

    if let Some(rest) = path.strip_prefix("/api/media/") {
        if method == "DELETE" {
            return delete_media(&state, &mut reader, rest);
        }
        if rest.ends_with("/thumbnail") {
            let id = rest.trim_end_matches("/thumbnail");
            return serve_thumbnail(&state, &mut reader, id);
        }
        if rest.ends_with("/waveform") {
            let id = rest.trim_end_matches("/waveform");
            return serve_waveform(&state, &mut reader, id, &query);
        }
        return serve_media(&state, &mut reader, rest, &headers, &method);
    }

    if path == "/api/export" && method == "POST" {
        return start_export(&state, &mut reader, content_length);
    }

    if let Some(rest) = path.strip_prefix("/api/jobs/") {
        if let Some(id) = rest.strip_suffix("/file") {
            return serve_job_file(&state, &mut reader, id, &method);
        }
        if let Some(id) = rest.strip_suffix("/cancel") {
            if method != "POST" {
                return respond_json(&mut reader, 405, &json!({"error": "POST attendu"}));
            }
            return cancel_job(&state, &mut reader, id);
        }
        if method == "GET" {
            return job_status(&state, &mut reader, rest);
        }
    }

    if method == "GET" || method == "HEAD" {
        return serve_static(&mut reader, &path, &method);
    }

    respond_json(&mut reader, 404, &json!({"error": "route inconnue"}))
}

// ─────────────────────────────── Import ───────────────────────────────

fn import_media(
    state: &Arc<State>,
    reader: &mut BufReader<TcpStream>,
    query: &HashMap<String, String>,
    content_length: u64,
) -> Result<(), String> {
    if content_length == 0 {
        return respond_json(reader, 400, &json!({"error": "fichier vide"}));
    }
    if content_length > MAX_UPLOAD_BODY {
        return respond_json(reader, 413, &json!({"error": "fichier trop volumineux"}));
    }

    let raw_name = query.get("name").cloned().unwrap_or_else(|| "media".into());
    let display_name: String = raw_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("media")
        .chars()
        .take(120)
        .collect();
    let name = sanitize_file_name(&raw_name);
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    const ALLOWED: &[&str] = &[
        "mp4", "mov", "m4v", "webm", "mkv", "avi", "ogv", "mpg", "mpeg", "ts", "m2ts", "mp3",
        "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff", "png", "jpg", "jpeg", "webp", "gif",
        "bmp", "tif", "tiff", "avif",
    ];
    if !ALLOWED.contains(&extension.as_str()) {
        return respond_json(
            reader,
            415,
            &json!({"error": format!("extension « .{extension} » non prise en charge")}),
        );
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let counter = state.counter.fetch_add(1, Ordering::Relaxed);
    let id = format!("m{stamp:x}{counter:x}");
    let path = state.media_dir.join(format!("{id}-{name}"));

    let mut file = File::create(&path).map_err(|e| format!("création du média : {e}"))?;
    let mut remaining = content_length;
    let mut buffer = vec![0u8; 256 * 1024];
    while remaining > 0 {
        let to_read = (buffer.len() as u64).min(remaining) as usize;
        let read = reader
            .read(&mut buffer[..to_read])
            .map_err(|e| format!("réception du média : {e}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("écriture du média : {e}"))?;
        remaining -= read as u64;
    }
    file.flush().ok();
    drop(file);

    if remaining != 0 {
        let _ = fs::remove_file(&path);
        return respond_json(reader, 400, &json!({"error": "transfert interrompu"}));
    }

    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let tool = match state.ffmpeg {
        Some(ref tool) => tool,
        None => {
            let _ = fs::remove_file(&path);
            return respond_json(reader, 503, &json!({"error": needs_ffmpeg(state)}));
        }
    };
    let media = match tool.probe(&path, &id, &display_name, size) {
        Ok(media) => media,
        Err(error) => {
            let _ = fs::remove_file(&path);
            return respond_json(
                reader,
                415,
                &json!({"error": format!("média illisible : {error}")}),
            );
        }
    };

    if media.duration_us <= 0 && media.kind != ctf_core::model::MediaKind::Image {
        let _ = fs::remove_file(&path);
        return respond_json(
            reader,
            415,
            &json!({"error": "durée invalide : le fichier est peut-être corrompu ou sans index"}),
        );
    }

    write_registry(&state.media_dir, &media);
    state.media.lock().unwrap().insert(id, media.clone());
    respond_json(reader, 200, &serde_json::to_value(&media).unwrap_or(Value::Null))
}

fn delete_media(state: &Arc<State>, reader: &mut BufReader<TcpStream>, id: &str) -> Result<(), String> {
    let media = state.media.lock().unwrap().remove(id);
    match media {
        Some(media) => {
            let _ = fs::remove_file(&media.path);
            let _ = fs::remove_file(state.media_dir.join(format!("{id}.json")));
            let _ = fs::remove_file(state.cache_dir.join(format!("{id}.jpg")));
            respond_json(reader, 200, &json!({"ok": true}))
        }
        None => respond_json(reader, 404, &json!({"error": "média inconnu"})),
    }
}

// ─────────────────────────────── Médias ───────────────────────────────

fn serve_media(
    state: &Arc<State>,
    reader: &mut BufReader<TcpStream>,
    id: &str,
    headers: &HashMap<String, String>,
    method: &str,
) -> Result<(), String> {
    let media = match state.media.lock().unwrap().get(id).cloned() {
        Some(media) => media,
        None => return respond_json(reader, 404, &json!({"error": "média inconnu"})),
    };
    let mime = match media.kind {
        ctf_core::model::MediaKind::Video => "video/mp4",
        ctf_core::model::MediaKind::Audio => "audio/mpeg",
        ctf_core::model::MediaKind::Image => "image/png",
    };
    let mime = sniff_mime(Path::new(&media.path), mime);
    serve_path(
        reader,
        Path::new(&media.path),
        mime,
        headers.get("range").map(String::as_str),
        method == "HEAD",
        None,
    )
}

fn serve_thumbnail(state: &Arc<State>, reader: &mut BufReader<TcpStream>, id: &str) -> Result<(), String> {
    let media = match state.media.lock().unwrap().get(id).cloned() {
        Some(media) => media,
        None => return respond_json(reader, 404, &json!({"error": "média inconnu"})),
    };
    if media.kind == ctf_core::model::MediaKind::Audio {
        return respond_json(reader, 404, &json!({"error": "pas de vignette pour un fichier audio"}));
    }
    let cache = state.cache_dir.join(format!("{id}.jpg"));
    if !cache.is_file() {
        let tool = match state.ffmpeg {
            Some(ref tool) => tool,
            None => return respond_json(reader, 503, &json!({"error": needs_ffmpeg(state)})),
        };
        let seek = if media.kind == ctf_core::model::MediaKind::Video && media.duration_us > 2_000_000 {
            "0.5"
        } else {
            "0"
        };
        let status = std::process::Command::new(&tool.ffmpeg)
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                seek,
                "-i",
                &media.path,
                "-frames:v",
                "1",
                "-vf",
                "scale=320:-2",
                "-q:v",
                "4",
                &cache.to_string_lossy(),
            ])
            .status();
        match status {
            Ok(status) if status.success() && cache.is_file() => {}
            _ => return respond_json(reader, 500, &json!({"error": "vignette impossible"})),
        }
    }
    serve_path(reader, &cache, "image/jpeg", None, false, None)
}

fn serve_waveform(
    state: &Arc<State>,
    reader: &mut BufReader<TcpStream>,
    id: &str,
    query: &HashMap<String, String>,
) -> Result<(), String> {
    let media = match state.media.lock().unwrap().get(id).cloned() {
        Some(media) => media,
        None => return respond_json(reader, 404, &json!({"error": "média inconnu"})),
    };
    if !media.has_audio {
        return respond_json(reader, 200, &json!({"points": [], "peak": 0.0}));
    }
    let points = query
        .get("points")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(800)
        .clamp(64, 4000);

    let tool = match state.ffmpeg {
        Some(ref tool) => tool,
        None => return respond_json(reader, 503, &json!({"error": needs_ffmpeg(state)})),
    };
    let output = std::process::Command::new(&tool.ffmpeg)
        .args([
            "-v",
            "error",
            "-i",
            &media.path,
            "-ac",
            "1",
            "-ar",
            "1000",
            "-f",
            "s16le",
            "-",
        ])
        .output()
        .map_err(|e| format!("waveform : {e}"))?;
    if !output.status.success() {
        return respond_json(reader, 200, &json!({"points": [], "peak": 0.0}));
    }

    let samples: Vec<i16> = output
        .stdout
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    if samples.is_empty() {
        return respond_json(reader, 200, &json!({"points": [], "peak": 0.0}));
    }

    let buckets = points.min(samples.len()).max(1);
    let mut peaks = Vec::with_capacity(buckets);
    let mut global: f32 = 0.0;
    for bucket in 0..buckets {
        let start = bucket * samples.len() / buckets;
        let end = ((bucket + 1) * samples.len() / buckets).max(start + 1).min(samples.len());
        let mut peak: f32 = 0.0;
        for value in &samples[start..end] {
            peak = peak.max((*value as f32 / 32768.0).abs());
        }
        global = global.max(peak);
        peaks.push((peak * 1000.0).round() / 1000.0);
    }
    let normalised: Vec<f32> = if global > 0.0 {
        peaks.iter().map(|value| (value / global * 1000.0).round() / 1000.0).collect()
    } else {
        peaks
    };

    respond_json(
        reader,
        200,
        &json!({
            "points": normalised,
            "peak": global,
            "duration_us": media.duration_us
        }),
    )
}

// ─────────────────────────────── Export ───────────────────────────────

fn start_export(
    state: &Arc<State>,
    reader: &mut BufReader<TcpStream>,
    content_length: u64,
) -> Result<(), String> {
    if content_length == 0 || content_length > MAX_JSON_BODY {
        return respond_json(reader, 413, &json!({"error": "requête d'export invalide"}));
    }
    let mut body = vec![0u8; content_length as usize];
    reader
        .read_exact(&mut body)
        .map_err(|e| format!("lecture de la requête : {e}"))?;

    let payload = serde_json::from_slice::<Value>(&body)
        .map_err(|e| format!("JSON invalide : {e}"))
        .and_then(|value| {
            let project_value = value
                .get("project")
                .cloned()
                .ok_or_else(|| "champ « project » manquant".to_string())?;
            let mut project: Project = serde_json::from_value(project_value)
                .map_err(|e| format!("projet invalide : {e}"))?;

            if let Some(format) = value.get("format").and_then(Value::as_str) {
                project.export.format =
                    ExportFormat::parse(format).map_err(|e| e.to_string())?;
            }
            if let Some(crf) = value.get("crf").and_then(Value::as_u64) {
                project.export.crf = crf.min(51) as u8;
            }
            if let Some(preset) = value.get("preset").and_then(Value::as_str) {
                project.export.preset = preset.to_string();
            }
            Ok(project)
        });

    let mut project = match payload {
        Ok(project) => project,
        Err(error) => return respond_json(reader, 400, &json!({ "error": error })),
    };

    // 🔒 Les chemins ne viennent JAMAIS du navigateur : chaque média est résolu
    // dans le registre du serveur. Un projet forgé ne peut donc pas lire un
    // fichier arbitraire de la machine.
    {
        let registry = state.media.lock().unwrap();
        for media in project.media.iter_mut() {
            let known = match registry.get(&media.id) {
                Some(known) => known.clone(),
                None => {
                    return respond_json(
                        reader,
                        400,
                        &json!({"error": format!("média {} absent du registre — réimportez-le", media.id)}),
                    )
                }
            };
            media.name = known.name.clone();
            media.path = known.path.clone();
            media.kind = known.kind;
            media.duration_us = known.duration_us;
            media.width = known.width;
            media.height = known.height;
            media.fps = known.fps;
            media.has_audio = known.has_audio;
            media.sample_rate = known.sample_rate;
            media.channels = known.channels;
            media.size_bytes = known.size_bytes;
        }
    }

    if let Err(error) = project.validate() {
        return respond_json(reader, 400, &json!({ "error": error }));
    }

    // Les fonctions de la 2.2 (keyframes, masques, vitesse) ne sont pas rendues
    // par ffmpeg : mieux vaut refuser franchement que livrer un fichier faux.
    for track in &project.tracks {
        for clip in &track.clips {
            if let Some(feature) = clip.needs_browser_render() {
                return respond_json(
                    reader,
                    409,
                    &json!({
                        "error": format!(
                            "ce projet utilise « {feature} », que le moteur natif ne rend pas encore — exportez-le depuis le navigateur (WebCodecs)"
                        )
                    }),
                );
            }
        }
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let counter = state.counter.fetch_add(1, Ordering::Relaxed);
    let job_id = format!("j{stamp:x}{counter:x}");
    // Un export sans ffmpeg échouerait de toute façon : on refuse tout de suite,
    // avec le message qui dit quoi faire, plutôt que de créer un job fantôme.
    let tool = match state.ffmpeg {
        Some(ref tool) => tool.clone(),
        None => return respond_json(reader, 503, &json!({"error": needs_ffmpeg(state)})),
    };
    let format = project.export.format;
    let output = state
        .export_dir
        .join(format!("{job_id}.{}", format.extension()));

    let handle = Arc::new(JobHandle {
        cancel: Arc::new(AtomicBool::new(false)),
        state: Mutex::new(Job {
            id: job_id.clone(),
            status: "queued".into(),
            progress: 0.0,
            stage: "queued".into(),
            message: String::new(),
            error: None,
            output: None,
            created_ms: stamp,
        }),
    });
    state
        .jobs
        .lock()
        .unwrap()
        .insert(job_id.clone(), handle.clone());

    cleanup_exports(&state.export_dir, EXPORT_HISTORY);

    let state_bg = state.clone();
    let job_bg = handle.clone();
    let project_bg = project.clone();
    let output_bg = output.clone();
    thread::spawn(move || {
        {
            let mut job = job_bg.state.lock().unwrap();
            job.status = "running".into();
            job.stage = "audio".into();
            job.message = String::new();
        }
        let options = ExportOptions {
            output: output_bg,
            format,
            crf: project_bg.export.crf,
            preset: project_bg.export.preset.clone(),
            work_dir: None,
            font: state_bg.font.clone(),
            keep_work: false,
            cancel: Some(job_bg.cancel.clone()),
        };
        let result = export(
            &tool,
            &project_bg,
            &options,
            |progress| {
                if let Ok(mut job) = job_bg.state.lock() {
                    job.progress = progress.percent;
                    job.stage = progress.stage;
                    job.message = progress.message;
                }
            },
        );
        if let Ok(mut job) = job_bg.state.lock() {
            match result {
                Ok(output) => {
                    job.status = "done".into();
                    job.progress = 100.0;
                    job.stage = "done".into();
                    job.message = String::new();
                    job.output = Some(output);
                }
                Err(error) => {
                    let cancelled = job_bg.cancel.load(Ordering::Relaxed);
                    job.status = if cancelled { "cancelled".into() } else { "error".into() };
                    job.message = String::new();
                    job.error = Some(error);
                }
            }
        }
    });

    respond_json(reader, 202, &json!({ "job_id": job_id }))
}

fn job_status(state: &Arc<State>, reader: &mut BufReader<TcpStream>, id: &str) -> Result<(), String> {
    let jobs = state.jobs.lock().unwrap();
    let handle = match jobs.get(id) {
        Some(handle) => handle.clone(),
        None => return respond_json(reader, 404, &json!({"error": "export inconnu"})),
    };
    let job = handle.state.lock().unwrap().clone();
    respond_json(reader, 200, &serde_json::to_value(job).unwrap_or(Value::Null))
}

fn cancel_job(state: &Arc<State>, reader: &mut BufReader<TcpStream>, id: &str) -> Result<(), String> {
    let jobs = state.jobs.lock().unwrap();
    let handle = match jobs.get(id) {
        Some(handle) => handle.clone(),
        None => return respond_json(reader, 404, &json!({"error": "export inconnu"})),
    };
    handle.cancel.store(true, Ordering::Relaxed);
    respond_json(reader, 200, &json!({"ok": true}))
}

fn serve_job_file(
    state: &Arc<State>,
    reader: &mut BufReader<TcpStream>,
    id: &str,
    method: &str,
) -> Result<(), String> {
    let jobs = state.jobs.lock().unwrap();
    let handle = match jobs.get(id) {
        Some(handle) => handle.clone(),
        None => return respond_json(reader, 404, &json!({"error": "export inconnu"})),
    };
    drop(jobs);
    let job = handle.state.lock().unwrap().clone();
    let output = match job.output {
        Some(output) => output,
        None => return respond_json(reader, 404, &json!({"error": "export non terminé"})),
    };
    let name = format!("cuttheflow-{}.{}", id, output.format);
    serve_path(
        reader,
        Path::new(&output.path),
        mime_for_format(&output.format),
        None,
        method == "HEAD",
        Some(&name),
    )
}

// ─────────────────────────────── HTTP ───────────────────────────────

fn serve_static(
    reader: &mut BufReader<TcpStream>,
    path: &str,
    method: &str,
) -> Result<(), String> {
    let candidate = if path == "/" { "/index.html" } else { path };
    if let Some((bytes, mime)) = assets::find(candidate) {
        return respond_bytes(reader, 200, mime, bytes, method == "HEAD", None, true);
    }
    if !assets::looks_like_file(candidate) {
        if let Some((bytes, mime)) = assets::find("/index.html") {
            return respond_bytes(reader, 200, mime, bytes, method == "HEAD", None, true);
        }
    }
    respond_bytes(
        reader,
        404,
        "text/plain; charset=utf-8",
        b"Not found",
        method == "HEAD",
        None,
        false,
    )
}

fn serve_path(
    reader: &mut BufReader<TcpStream>,
    path: &Path,
    mime: &str,
    range: Option<&str>,
    head_only: bool,
    download: Option<&str>,
) -> Result<(), String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return respond_json(reader, 404, &json!({"error": "fichier introuvable"})),
    };
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);

    let (start, end, status) = match range.and_then(|value| parse_range(value, total)) {
        Some((start, end)) => (start, end, 206u16),
        None => (0, total.saturating_sub(1), 200u16),
    };
    let length = if total == 0 { 0 } else { end.saturating_sub(start) + 1 };

    let mut head = format!(
        "HTTP/1.1 {status} {}\r\n{}Content-Type: {mime}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n",
        status_text(status),
        cors_headers()
    );
    if status == 206 {
        head.push_str(&format!("Content-Range: bytes {start}-{end}/{total}\r\n"));
    }
    if let Some(name) = download {
        head.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{}\"\r\n",
            name.replace('"', "_")
        ));
    } else {
        head.push_str("Content-Disposition: inline\r\n");
    }
    head.push_str("\r\n");

    let stream = reader.get_mut();
    stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    if head_only || length == 0 {
        return Ok(());
    }
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut limited = file.take(length);
    std::io::copy(&mut limited, stream).map_err(|e| e.to_string())?;
    Ok(())
}

fn needs_ffmpeg(state: &Arc<State>) -> String {
    match &state.ffmpeg_error {
        Some(error) => format!(
            "ffmpeg est introuvable : cette action passe par le moteur natif. {error}\n\
             Utilisez l'interface dans le navigateur (export WebCodecs), ou installez ffmpeg."
        ),
        None => "ffmpeg est introuvable : cette action passe par le moteur natif.".into(),
    }
}

fn respond_json(reader: &mut BufReader<TcpStream>, status: u16, value: &Value) -> Result<(), String> {    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    respond_bytes(
        reader,
        status,
        "application/json; charset=utf-8",
        &body,
        false,
        None,
        false,
    )
}

fn respond_bytes(
    reader: &mut BufReader<TcpStream>,
    status: u16,
    mime: &str,
    body: &[u8],
    head_only: bool,
    download: Option<&str>,
    cache: bool,
) -> Result<(), String> {
    let mut head = format!(
        "HTTP/1.1 {status} {}\r\n{}Content-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n",
        status_text(status),
        cors_headers(),
        body.len()
    );
    head.push_str(if cache {
        "Cache-Control: no-cache\r\n"
    } else {
        "Cache-Control: no-store\r\n"
    });
    if let Some(name) = download {
        head.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{}\"\r\n",
            name.replace('"', "_")
        ));
    }
    head.push_str("\r\n");
    let stream = reader.get_mut();
    stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    if !head_only {
        stream.write_all(body).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        206 => "Partial Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    let start = start.trim().parse::<u64>().ok()?;
    let end = if end.trim().is_empty() {
        total - 1
    } else {
        end.trim().parse::<u64>().ok()?.min(total - 1)
    };
    if start > end || start >= total {
        return None;
    }
    Some((start, end))
}

// ─────────────────────────────── Utilitaires ───────────────────────────────

fn load_registry(media_dir: &Path) -> HashMap<String, Media> {
    let mut map = HashMap::new();
    let entries = match fs::read_dir(media_dir) {
        Ok(entries) => entries,
        Err(_) => return map,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(_) => continue,
        };
        if let Ok(media) = serde_json::from_str::<Media>(&text) {
            if Path::new(&media.path).is_file() {
                map.insert(media.id.clone(), media);
            }
        }
    }
    map
}

fn write_registry(media_dir: &Path, media: &Media) {
    if let Ok(text) = serde_json::to_string_pretty(media) {
        let _ = fs::write(media_dir.join(format!("{}.json", media.id)), text);
    }
}

fn cleanup_exports(export_dir: &Path, keep: usize) {
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    if let Ok(entries) = fs::read_dir(export_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(UNIX_EPOCH);
                files.push((modified, path));
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

/// Préfixe du déploiement web, retiré avant le routage.
const WEB_BASE: &str = "/CUTTHEFLOW";

fn strip_web_base(path: &str) -> String {
    match path.strip_prefix(WEB_BASE) {
        Some("") => "/".to_string(),
        Some(rest) if rest.starts_with('/') => rest.to_string(),
        _ => path.to_string(),
    }
}

fn sniff_mime(path: &Path, fallback: &'static str) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" | "mov" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" | "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        _ => fallback,
    }
}

fn mime_for_format(format: &str) -> &'static str {
    match format {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn sanitize_file_name(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("media");
    let mut out = String::new();
    for character in base.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
            out.push(character);
        } else if character == ' ' {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push_str("media");
    }
    if out.len() > 100 {
        out.truncate(100);
    }
    out
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter(|part| !part.is_empty())
        .map(|part| match part.split_once('=') {
            Some((key, value)) => (percent_decode(key), percent_decode(value)),
            None => (percent_decode(part), String::new()),
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%'
                if index + 2 < bytes.len()
                    && bytes[index + 1].is_ascii_hexdigit()
                    && bytes[index + 2].is_ascii_hexdigit() =>
            {
                let hex = &value[index + 1..index + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
                out.push(bytes[index]);
            }
            b'+' => out.push(b' '),
            byte => out.push(byte),
        }
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn open_browser(url: &str) {
    #[cfg(windows)]
    {
        let _ = ctf_engine::hidden(&mut std::process::Command::new("cmd"))
            .args(["/C", "start", "", url])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).status();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).status();
    }
}
