//! Construction du graphe de filtres ffmpeg.
//!
//! Deux graphes sont produits, jamais un seul :
//! * `AudioGraph` — un mixage **échantillon-exact** à 48 kHz, qui commence à 0 ;
//! * `VideoGraph` — des images **timbrées** à la cadence du projet, composées
//!   dans l'ordre des pistes.
//!
//! Pourquoi deux graphes : ffmpeg rééchantillonne et encode l'audio par blocs ;
//! en isolant le mixage dans un fichier PCM flottant, on garantit que chaque
//! clip audio tombe sur l'échantillon exact de la timeline, indépendamment du
//! nombre d'images et de la vitesse de la machine. Les deux graphes partent de
//! t = 0 : aucun décalage ne peut être introduit par l'ordre de démarrage des
//! entrées (c'était la cause du décalage de 878 ms de la v1).

use std::collections::HashMap;
use std::path::PathBuf;

use crate::model::{Clip, ClipKind, Effect, Media, Project, ShapeKind};
use crate::plan::resolve_project;
use crate::time::{secs, us_to_samples, Fps, Micros, AUDIO_SAMPLE_RATE};

/// Nom du fichier de police copié dans le dossier de travail.
pub const FONT_FILE_NAME: &str = "ctf-font.ttf";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputKind {
    Video,
    Image,
    Audio,
}

#[derive(Debug, Clone)]
pub struct InputSpec {
    pub path: PathBuf,
    pub kind: InputKind,
    /// Pour une image : durée de la boucle (le clip fixe sa propre durée).
    pub loop_duration_us: Micros,
    pub fps: Fps,
}

#[derive(Debug, Clone)]
pub struct TextAsset {
    pub file_name: String,
    pub content: String,
}

/// Forme à rasteriser une fois avant l'export (PNG RGBA transparent).
///
/// Pourquoi un PNG et pas un filtre `drawbox` : une ellipse (et un rectangle
/// arrondi) n'existent pas comme filtre ffmpeg. `geq` les dessine exactement,
/// mais coûte cher par image ; on le paie donc **une seule fois**, puis le PNG
/// est bouclé comme une image ordinaire.
#[derive(Debug, Clone)]
pub struct ShapeAsset {
    pub file_name: String,
    pub kind: ShapeKind,
    /// Couleur normalisée `0xRRGGBB`.
    pub color: String,
    pub width_px: u32,
    pub height_px: u32,
    pub radius_px: u32,
}

#[derive(Debug, Clone)]
pub struct VideoGraph {
    pub inputs: Vec<InputSpec>,
    /// `-filter_complex` complet, terminé par `[vout]`.
    pub filter: String,
    pub duration_us: Micros,
    /// Fichiers texte à écrire dans le dossier de travail (`textfile=`).
    pub text_assets: Vec<TextAsset>,
    /// Formes à rasteriser avant le rendu.
    pub shape_assets: Vec<ShapeAsset>,
    pub has_visual: bool,
}

#[derive(Debug, Clone)]
pub struct AudioGraph {
    pub inputs: Vec<InputSpec>,
    /// `-filter_complex` complet, terminé par `[aout]` (vide si aucun son).
    pub filter: String,
    pub duration_us: Micros,
    pub clip_count: usize,
}

/// Construit la composition vidéo.
///
/// `font_available` indique que le moteur a bien copié la police dans le
/// dossier de travail : sans elle, un clip texte ne peut pas être rendu et on
/// préfère une erreur explicite à un export silencieusement incomplet.
pub fn build_video_graph(project: &Project, font_available: bool) -> Result<VideoGraph, String> {
    project.validate()?;
    let duration = project.timeline_end_us();
    if duration <= 0 {
        return Err("timeline vide".into());
    }

    let media_map = project.media_map();
    let placements = resolve_project(project);
    let mut inputs: Vec<InputSpec> = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    let mut text_assets: Vec<TextAsset> = Vec::new();
    let mut shape_assets: Vec<ShapeAsset> = Vec::new();
    let mut has_visual = false;
    let mut text_needed = false;

    let background = normalize_color(&project.background)?;
    parts.push(format!(
        "color=c={}:s={}x{}:r={}:d={},format=rgba[v0]",
        background,
        project.width,
        project.height,
        project.fps.as_ratio(),
        secs(duration)
    ));

    let mut step: usize = 0;

    // Les dernières pistes de la liste sont dessinées en premier (fond), la
    // piste 0 est au premier plan — c'est l'ordre affiché par l'interface.
    for (track_index, track) in project.tracks.iter().enumerate().rev() {
        if track.muted {
            continue;
        }
        // `(index d'origine, clip)` : le placement résolu suit l'ordre du
        // tableau `track.clips`, pas l'ordre chronologique.
        let mut clips: Vec<(usize, &Clip)> = track
            .clips
            .iter()
            .enumerate()
            .filter(|(_, clip)| clip.is_visual())
            .collect();
        clips.sort_by_key(|(_, clip)| (clip.start_us, clip.id.clone()));

        for (clip_index, clip) in clips {
            let placement = placements[track_index][clip_index];
            step += 1;
            match clip.kind {
                ClipKind::Video | ClipKind::Image | ClipKind::Shape => {
                    has_visual = true;
                    let (index, source_width, source_height) = match clip.kind {
                        ClipKind::Shape => {
                            let shape = clip
                                .shape
                                .as_ref()
                                .ok_or_else(|| format!("clip forme « {} » : style manquant", clip.id))?;
                            let width_px = shape_pixel_size(project.width, clip.scale, shape.width);
                            let height_px = shape_pixel_size(project.height, clip.scale, shape.height);
                            let radius_px = (shape.radius
                                * width_px.min(height_px) as f64)
                                .round()
                                .clamp(0.0, width_px.min(height_px) as f64 / 2.0)
                                as u32;
                            let file_name = format!("ctf-shape-{:03}.png", shape_assets.len());
                            shape_assets.push(ShapeAsset {
                                file_name: file_name.clone(),
                                kind: shape.kind,
                                color: normalize_color(&shape.color)?,
                                width_px,
                                height_px,
                                radius_px,
                            });
                            inputs.push(InputSpec {
                                path: PathBuf::from(file_name),
                                kind: InputKind::Image,
                                loop_duration_us: placement.duration_us,
                                fps: project.fps,
                            });
                            (inputs.len() - 1, width_px, height_px)
                        }
                        _ => {
                            let media = media_for(&media_map, clip)?;
                            // Une entrée ffmpeg PAR CLIP, jamais une entrée partagée : un flux
                            // d'entrée ne peut être consommé qu'une fois dans un filter_complex.
                            // Deux clips issus du même fichier ouvrent donc le fichier deux fois
                            // (comme la v1, qui avait un élément vidéo par clip).
                            inputs.push(InputSpec {
                                path: PathBuf::from(&media.path),
                                kind: if clip.kind == ClipKind::Image {
                                    InputKind::Image
                                } else {
                                    InputKind::Video
                                },
                                loop_duration_us: if clip.kind == ClipKind::Image {
                                    placement.duration_us
                                } else {
                                    0
                                },
                                fps: project.fps,
                            });
                            let (width, height) = fit_dimensions(media, project, clip);
                            (inputs.len() - 1, width, height)
                        }
                    };

                    let mut width = source_width;
                    let mut height = source_height;

                    let mut chain = if clip.kind == ClipKind::Image || clip.kind == ClipKind::Shape {
                        format!(
                            "[{index}:v]trim=duration={},setpts=PTS-STARTPTS",
                            secs(placement.duration_us)
                        )
                    } else {
                        format!(
                            "[{index}:v]trim=start={}:duration={},setpts=PTS-STARTPTS",
                            secs(placement.source_start_us),
                            secs(placement.duration_us)
                        )
                    };
                    chain.push_str(&format!(
                        ",fps={},scale={width}:{height}:flags=bicubic,setsar=1,format=rgba",
                        project.fps.as_ratio()
                    ));

                    // Effets : appliqués au clip seul, avant composition. Un effet
                    // ne peut donc jamais déborder sur le clip voisin.
                    let effects = effect_chain(&clip.effects, width, height);
                    if !effects.is_empty() {
                        chain.push_str(&effects);
                    }

                    // Rotation : `rotate` élargit l'image à sa boîte englobante,
                    // que l'on recentre ensuite à l'overlay.
                    if clip.rotation.abs() > 0.01 {
                        let angle = clip.rotation.to_radians();
                        let cos = angle.cos().abs();
                        let sin = angle.sin().abs();
                        let rotated_w = (width as f64 * cos + height as f64 * sin).round() as u32;
                        let rotated_h = (width as f64 * sin + height as f64 * cos).round() as u32;
                        chain.push_str(&format!(
                            ",rotate={:.6}:c=none:ow={}:oh={}",
                            angle, rotated_w, rotated_h
                        ));
                        width = rotated_w;
                        height = rotated_h;
                    }

                    if clip.opacity < 0.999_999 {
                        chain.push_str(&format!(",colorchannelmixer=aa={:.6}", clip.opacity));
                    }
                    if placement.fade_in_us > 0 {
                        chain.push_str(&format!(
                            ",fade=t=in:st=0:d={}:alpha=1",
                            secs(placement.fade_in_us)
                        ));
                    }
                    if clip.fade_out_us > 0 {
                        chain.push_str(&format!(
                            ",fade=t=out:st={}:d={}:alpha=1",
                            secs(placement.duration_us - clip.fade_out_us),
                            secs(clip.fade_out_us)
                        ));
                    }
                    // ⏱️ DÉCALAGE SUR LA TIMELINE — indispensable : `overlay` synchronise
                    // ses deux entrées par PTS. Sans ce décalage, le clip placé à 6 s
                    // afficherait sa 6ᵉ seconde dès la première image de sa fenêtre.
                    // Les fondus restent exprimés en temps LOCAL (0 → durée du clip),
                    // donc le décalage est appliqué en dernier.
                    if placement.start_us > 0 {
                        chain.push_str(&format!(",setpts=PTS+{}/TB", secs(placement.start_us)));
                    }
                    chain.push_str(&format!("[c{step}]"));
                    parts.push(chain);

                    let offset_x = (clip.x * project.width as f64 - width as f64 / 2.0).round() as i64;
                    let offset_y =
                        (clip.y * project.height as f64 - height as f64 / 2.0).round() as i64;
                    parts.push(format!(
                        "[v{}][c{}]overlay=x={}:y={}:format=auto:shortest=0:enable='between(t,{},{})'[v{}]",
                        step - 1,
                        step,
                        offset_x,
                        offset_y,
                        secs(placement.start_us),
                        secs(placement.end_us()),
                        step
                    ));
                }
                ClipKind::Text => {
                    text_needed = true;
                    let style = clip
                        .text
                        .as_ref()
                        .ok_or_else(|| format!("clip texte « {} » : style manquant", clip.id))?;
                    let file_name = format!("ctf-text-{:03}.txt", text_assets.len());
                    text_assets.push(TextAsset {
                        file_name: file_name.clone(),
                        content: style.content.clone(),
                    });
                    let color = normalize_color(&style.color)?;
                    let mut options = format!(
                        "fontfile={}:textfile={}:fontsize={:.0}:fontcolor={}:x=(w-text_w)*{:.6}:y=(h-text_h)*{:.6}",
                        FONT_FILE_NAME, file_name, style.size, color, clip.x, clip.y
                    );
                    if let Some(box_color) = &style.background {
                        let box_color = normalize_color(box_color)?;
                        options.push_str(&format!(":box=1:boxcolor={}:boxborderw=16", box_color));
                    }
                    options.push_str(&format!(
                        ":enable='between(t,{},{})'",
                        secs(placement.start_us),
                        secs(placement.end_us())
                    ));
                    parts.push(format!("[v{}]drawtext={}[v{}]", step - 1, options, step));
                }
                ClipKind::Audio => {}
            }
        }
    }

    if text_needed && !font_available {
        return Err(
            "clip texte : aucune police utilisable. Définissez CTF_FONT vers un fichier .ttf.".into(),
        );
    }

    parts.push(format!("[v{}]format=yuv420p[vout]", step));

    Ok(VideoGraph {
        inputs,
        filter: parts.join(";"),
        duration_us: duration,
        text_assets,
        shape_assets,
        has_visual,
    })
}

/// Construit le mixage audio, échantillon par échantillon.
pub fn build_audio_graph(project: &Project) -> Result<AudioGraph, String> {
    project.validate()?;
    let duration = project.timeline_end_us();
    if duration <= 0 {
        return Err("timeline vide".into());
    }

    let media_map = project.media_map();
    let placements = resolve_project(project);
    let mut inputs: Vec<InputSpec> = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    let mut labels: Vec<String> = Vec::new();

    // Une piste muette ne fournit aucun son, mais ses clips ne doivent pas non
    // plus allonger le mixage : la durée vient de `timeline_end_us`.
    for (track_index, track) in project.tracks.iter().enumerate() {
        if track.muted {
            continue;
        }
        let mut clips: Vec<(usize, &Clip)> = track
            .clips
            .iter()
            .enumerate()
            .filter(|(_, c)| match c.kind {
                ClipKind::Audio => true,
                ClipKind::Video => !c.audio_muted,
                _ => false,
            })
            .collect();
        clips.sort_by_key(|(_, clip)| (clip.start_us, clip.id.clone()));

        for (clip_index, clip) in clips {
            let media = media_for(&media_map, clip)?;
            if !media.has_audio {
                continue;
            }
            // ⚠️ Le placement tient compte d'une éventuelle transition en fondu
            // enchaîné : la fenêtre ET le point d'entrée source sont décalés du
            // même `d`. Sans ce mirroir, l'audio du clip entrant arriverait `d`
            // trop tard par rapport à son image.
            let placement = placements[track_index][clip_index];
            // Une entrée par clip : le même fichier peut fournir le son de plusieurs
            // clips, et un flux d'entrée ne se consomme qu'une fois dans un graphe.
            inputs.push(InputSpec {
                path: PathBuf::from(&media.path),
                kind: InputKind::Audio,
                loop_duration_us: 0,
                fps: project.fps,
            });
            let index = inputs.len() - 1;

            let volume = (track.volume * clip.volume).clamp(0.0, 4.0);
            let mut chain = format!(
                "[{index}:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS,aresample={}:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={:.6}",
                secs(placement.source_start_us),
                secs(placement.duration_us),
                AUDIO_SAMPLE_RATE,
                volume
            );
            let fade_in = placement.fade_in_us.max(clip.fade_in_us);
            if fade_in > 0 {
                chain.push_str(&format!(",afade=t=in:st=0:d={}", secs(fade_in)));
            }
            if clip.fade_out_us > 0 {
                chain.push_str(&format!(
                    ",afade=t=out:st={}:d={}",
                    secs(placement.duration_us - clip.fade_out_us),
                    secs(clip.fade_out_us)
                ));
            }
            let delay = us_to_samples(placement.start_us);
            if delay > 0 {
                chain.push_str(&format!(",adelay={delay}S|{delay}S"));
            }
            chain.push_str(&format!(
                ",atrim=end={},asetpts=PTS-STARTPTS[a{}]",
                secs(duration),
                labels.len()
            ));
            parts.push(chain);
            labels.push(format!("[a{}]", labels.len()));
        }
    }

    if labels.is_empty() {
        return Ok(AudioGraph {
            inputs,
            filter: String::new(),
            duration_us: duration,
            clip_count: 0,
        });
    }

    let mixed = {
        // 🛏️ LIT DE SILENCE — garantit la durée, sans dépendre de `apad`.
        // `apad=whole_dur` s'est révélé NON DÉTERMINISTE avec `amix` : selon la
        // course entre les entrées, le WAV sortait tantôt à 14 s, tantôt à 13 s
        // (reproduit 1 fois sur 3). Un `anullsrc` de la durée exacte de la
        // timeline est une entrée comme les autres : `amix=duration=longest` ne
        // peut plus s'arrêter avant la fin, et `atrim` fige la longueur.
        format!(
            "anullsrc=r={AUDIO_SAMPLE_RATE}:cl=stereo:d={},atrim=duration={},asetpts=PTS-STARTPTS[abed];{}[abed]amix=inputs={}:duration=longest:dropout_transition=0:normalize=0[aout]",
            secs(duration),
            secs(duration),
            labels.concat(),
            labels.len() + 1
        )
    };
    parts.push(mixed);
    parts.push(format!(
        "[aout]atrim=end={},asetpts=PTS-STARTPTS[aoutpad]",
        secs(duration)
    ));

    Ok(AudioGraph {
        inputs,
        filter: parts.join(";"),
        duration_us: duration,
        clip_count: labels.len(),
    })
}

fn media_for<'a>(media_map: &HashMap<&str, &'a Media>, clip: &Clip) -> Result<&'a Media, String> {
    let id = clip
        .media
        .as_deref()
        .ok_or_else(|| format!("clip « {} » : média non référencé", clip.id))?;
    media_map
        .get(id)
        .copied()
        .ok_or_else(|| format!("clip « {} » : média inconnu ({id})", clip.id))
}

/// Dimensions de dessin : le média est ajusté au canevas (contain), puis mis à
/// l'échelle du clip. Les dimensions sont forcées paires (exigence yuv420p).
pub fn fit_dimensions(media: &Media, project: &Project, clip: &Clip) -> (u32, u32) {
    let canvas_w = project.width.max(2) as f64;
    let canvas_h = project.height.max(2) as f64;
    let (media_w, media_h) = if media.width > 0 && media.height > 0 {
        (media.width as f64, media.height as f64)
    } else {
        (canvas_w, canvas_h)
    };
    let source_ratio = media_w / media_h;
    let canvas_ratio = canvas_w / canvas_h;
    let (base_w, base_h) = if source_ratio > canvas_ratio {
        (canvas_w, canvas_w / source_ratio)
    } else {
        (canvas_h * source_ratio, canvas_h)
    };
    let scale = clip.scale.clamp(0.05, 20.0);
    let width = (base_w * scale).round().max(2.0) as u32;
    let height = (base_h * scale).round().max(2.0) as u32;
    (width - width % 2, height - height % 2)
}

/// Taille en pixels d'une forme : fraction du canevas × échelle du clip.
/// Toujours paire (exigence yuv420p) et au moins 2 px.
pub fn shape_pixel_size(canvas: u32, scale: f64, fraction: f64) -> u32 {
    let value = (canvas as f64 * fraction.clamp(0.01, 2.0) * scale.clamp(0.05, 20.0)).round();
    let even = (value.max(2.0) as u32) & !1;
    even.max(2)
}

/// Chaîne de filtres d'effets, à insérer après le redimensionnement.
///
/// Chaque effet est borné par `amount` (0 → 1) et n'ajoute qu'un filtre : aucun
/// effet ne peut changer la durée, donc aucun ne peut décaler l'image ou le son.
pub fn effect_chain(effects: &[Effect], width: u32, height: u32) -> String {
    let mut chain = String::new();
    for effect in effects {
        let amount = effect.amount.clamp(0.0, 1.0);
        let filter = match effect.name.as_str() {
            "blur" => format!("gblur=sigma={:.2}", 0.4 + amount * 22.0),
            "sharpen" => format!("unsharp=5:5:{:.2}", amount * 2.0),
            "vignette" => format!("vignette=angle={:.4}", 0.3 + amount * 0.7),
            "grain" => format!("noise=alls={}:allf=t", (amount * 40.0).round() as u32),
            "invert" => "negate".to_string(),
            "mirror" => "hflip".to_string(),
            "flip" => "vflip".to_string(),
            "grayscale" => "hue=s=0".to_string(),
            "sepia" => "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131".to_string(),
            "pixelate" => {
                let step = 2 + (amount * 30.0).round() as u32;
                let small_w = (width / step).max(2);
                let small_h = (height / step).max(2);
                format!(
                    "scale={small_w}:{small_h}:flags=neighbor,scale={width}:{height}:flags=neighbor"
                )
            }
            "warm" => format!("colorbalance=rs={:.3}:gs=0:bs={:.3}", amount * 0.35, -amount * 0.35),
            "cool" => format!("colorbalance=rs={:.3}:gs=0:bs={:.3}", -amount * 0.35, amount * 0.35),
            "brightness" => format!("eq=brightness={:.3}", (amount - 0.5) * 0.6),
            // Nom inconnu : ignoré. Un projet écrit par une version plus récente
            // s'exporte donc quand même, sans casser le graphe.
            _ => continue,
        };
        chain.push(',');
        chain.push_str(&filter);
    }
    chain
}

/// Expression `geq` qui dessine la forme (canal alpha uniquement).
///
/// Un seul jeu de formules couvre les trois cas : `radius = 0` donne un
/// rectangle net, `radius = min(w,h)/2` une ellipse, entre les deux un
/// rectangle arrondi.
pub fn shape_alpha_expression(kind: ShapeKind, width: u32, height: u32, radius: u32) -> String {
    let radius = match kind {
        // Le rayon vient du clip : 0 = rectangle net, > 0 = coins arrondis.
        ShapeKind::Rect => radius.min(width.min(height) / 2),
        // Une ellipse, c'est un rectangle dont l'arrondi vaut la demi-petite
        // dimension : le même jeu de formules suffit.
        ShapeKind::Ellipse => width.min(height) / 2,
    };

    if radius == 0 {
        // Rectangle net : toute la surface est opaque, inutile de payer `geq`.
        return "255".to_string();
    }

    let radius = radius.max(1) as f64;
    format!(
        "if(lte(pow(max(0,max({r}-X,X-({w}-1-{r}))),2)+pow(max(0,max({r}-Y,Y-({h}-1-{r}))),2),{r2}),255,0)",
        r = radius,
        w = width,
        h = height,
        r2 = radius * radius
    )
}


pub fn normalize_color(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("couleur vide".into());
    }
    if let Some(hex) = trimmed.strip_prefix('#') {
        if (hex.len() == 6 || hex.len() == 8) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(format!("0x{}", hex.to_ascii_uppercase()));
        }
        return Err(format!("couleur hexadécimale invalide : {value}"));
    }
    if let Some(hex) = trimmed.strip_prefix("0x") {
        if (hex.len() == 6 || hex.len() == 8) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(format!("0x{}", hex.to_ascii_uppercase()));
        }
        return Err(format!("couleur hexadécimale invalide : {value}"));
    }
    if trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
        return Ok(trimmed.to_string());
    }
    Err(format!("couleur non reconnue : {value}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ClipKind, ExportSettings, MediaKind, TextStyle, Track, TrackKind};

    fn media(id: &str, kind: MediaKind, w: u32, h: u32, has_audio: bool) -> Media {
        Media {
            id: id.into(),
            name: format!("{id}.mp4"),
            kind,
            path: format!("C:/media/{id}.mp4"),
            duration_us: 10_000_000,
            width: w,
            height: h,
            fps: Some(Fps::new(30, 1)),
            has_audio,
            sample_rate: 48_000,
            channels: 2,
            size_bytes: 1,
        }
    }

    fn clip(id: &str, kind: ClipKind, media: Option<&str>, start: i64, dur: i64) -> Clip {
        Clip {
            id: id.into(),
            kind,
            name: id.into(),
            media: media.map(str::to_string),
            start_us: start,
            duration_us: dur,
            source_start_us: 0,
            volume: 1.0,
            fade_in_us: 0,
            fade_out_us: 0,
            scale: 1.0,
            x: 0.5,
            y: 0.5,
            opacity: 1.0,
            audio_muted: false,
            text: None,
            shape: None,
            effects: Vec::new(),
            transition: None,
            rotation: 0.0,
        }
    }

    fn project() -> Project {
        Project {
            version: 1,
            name: "test".into(),
            width: 1280,
            height: 720,
            fps: Fps::new(30, 1),
            background: "#000000".into(),
            tracks: vec![
                Track {
                    id: "v1".into(),
                    kind: TrackKind::Video,
                    name: "VIDEO 1".into(),
                    muted: false,
                    volume: 1.0,
                    clips: vec![
                        clip("c1", ClipKind::Video, Some("m1"), 0, 6_000_000),
                        clip("c2", ClipKind::Image, Some("m2"), 6_000_000, 3_000_000),
                    ],
                },
                Track {
                    id: "a1".into(),
                    kind: TrackKind::Audio,
                    name: "AUDIO 1".into(),
                    muted: false,
                    volume: 1.0,
                    clips: vec![clip("c3", ClipKind::Audio, Some("m3"), 0, 13_000_000)],
                },
            ],
            media: vec![
                media("m1", MediaKind::Video, 1920, 1080, true),
                media("m2", MediaKind::Image, 800, 600, false),
                media("m3", MediaKind::Audio, 0, 0, true),
            ],
            export: ExportSettings::default(),
        }
    }

    #[test]
    fn video_compose_deux_clips() {
        let graph = build_video_graph(&project(), false).unwrap();
        assert_eq!(graph.duration_us, 13_000_000);
        assert!(graph.has_visual);
        assert!(graph.filter.contains("trim=start=0.000000:duration=6.000000"));
        assert!(graph.filter.contains("scale=1280:720"));
        assert!(graph.filter.contains("overlay=x=0:y=0"));
        assert!(graph.filter.contains("[vout]"));
        assert_eq!(graph.inputs.len(), 2);
    }

    #[test]
    fn image_est_bouclee_et_ajustee() {
        let graph = build_video_graph(&project(), false).unwrap();
        let image = &graph.inputs[1];
        assert_eq!(image.kind, InputKind::Image);
        assert_eq!(image.loop_duration_us, 3_000_000);
        assert!(graph.filter.contains("scale=960:720"));
    }

    #[test]
    fn texte_demande_une_police() {
        let mut p = project();
        let mut text_clip = clip("t1", ClipKind::Text, None, 6_500_000, 2_000_000);
        text_clip.text = Some(TextStyle {
            content: "TITRE".into(),
            size: 140.0,
            color: "#FFFFFF".into(),
            background: None,
        });
        p.tracks[0].clips.push(text_clip);
        assert!(build_video_graph(&p, false).is_err());
        let graph = build_video_graph(&p, true).unwrap();
        assert!(graph.filter.contains("drawtext="));
        assert_eq!(graph.text_assets.len(), 1);
        assert_eq!(graph.text_assets[0].content, "TITRE");
    }

    #[test]
    fn audio_mix_echantillon_exact() {
        let graph = build_audio_graph(&project()).unwrap();
        assert_eq!(graph.clip_count, 2); // audio + piste son de la vidéo
        assert!(graph.filter.contains("adelay=0S") == false);
        assert!(graph.filter.contains("anullsrc=r=48000:cl=stereo"));
        assert!(graph.filter.contains("amix=inputs=3"));
        assert!(graph.filter.contains("normalize=0"));
        assert!(graph.filter.contains("aoutpad"));
    }

    #[test]
    fn audio_delay_en_echantillons() {
        let mut p = project();
        p.tracks[1].clips[0].start_us = 6_000_000;
        let graph = build_audio_graph(&p).unwrap();
        assert!(graph.filter.contains("adelay=288000S|288000S"));
    }

    #[test]
    fn ajustement_portrait() {
        let mut p = project();
        let portrait = media("m9", MediaKind::Video, 1080, 1920, true);
        p.media.push(portrait.clone());
        let c = clip("c9", ClipKind::Video, Some("m9"), 0, 1_000_000);
        assert_eq!(fit_dimensions(&portrait, &p, &c), (404, 720));
    }

    #[test]
    fn couleurs() {
        assert_eq!(normalize_color("#00ff00").unwrap(), "0x00FF00");
        assert_eq!(normalize_color("black").unwrap(), "black");
        assert!(normalize_color("#12345").is_err());
        assert!(normalize_color("url(x)").is_err());
    }
}
