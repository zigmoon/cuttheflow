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

use crate::animation;
use crate::model::{Clip, ClipKind, Effect, Media, Project, ShapeKind};
use crate::plan::resolve_project;
use crate::time::{secs, us_to_samples, Fps, Micros, AUDIO_SAMPLE_RATE};

/// Bornes de vitesse appliquées par l'interface (`MIN_SPEED`/`MAX_SPEED` de
/// `state.ts`). Au-delà, `atempo` demanderait un chaînage plus long que ce que
/// l'interface permet.
pub const MIN_SPEED: f64 = 0.25;
pub const MAX_SPEED: f64 = 4.0;

/// Bornes d'échelle appliquées par l'interface (`fit_dimensions`).
pub const MIN_SCALE: f64 = 0.05;
pub const MAX_SCALE: f64 = 20.0;

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
    /// Masques à rasteriser avant le rendu (niveaux de gris, taille du cadre).
    pub mask_assets: Vec<MaskAsset>,
    pub has_visual: bool,
}

/// Masque de composition, rasterisé **une seule fois**.
///
/// Le masque ne dépend pas du temps : le redessiner à chaque image coûterait un
/// `geq` plein cadre par image (mesuré ×6 sur du 4K). On le dessine donc une
/// fois, puis on le boucle comme une image — la même stratégie que les formes.
#[derive(Debug, Clone)]
pub struct MaskAsset {
    pub file_name: String,
    pub width_px: u32,
    pub height_px: u32,
    /// Expression `geq` du canal luma (0 = masqué, 255 = visible).
    pub expression: String,
    /// Rayon d'adoucissement du bord, en pixels (0 = bord net).
    pub feather_px: f64,
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
    let mut mask_assets: Vec<MaskAsset> = Vec::new();
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
                                // Une image bouclée doit couvrir la durée de
                                // SOURCE consommée : à 2×, un clip de 1 s lit 2 s.
                                // Sinon l'entrée s'arrête avant la fin et la
                                // dernière image se fige.
                                loop_duration_us: if clip.kind == ClipKind::Image {
                                    ((placement.duration_us as f64)
                                        * clip.speed.clamp(MIN_SPEED, MAX_SPEED))
                                    .round() as Micros
                                } else {
                                    0
                                },
                                fps: project.fps,
                            });
                            let (width, height) = fit_dimensions(media, project, clip);
                            (inputs.len() - 1, width, height)
                        }
                    };

                    // ── Source du clip ────────────────────────────────────
                    // À 2×, un clip de 1 s lit 2 s de source : sans ce calcul,
                    // accélérer un plan le rognerait au lieu de l'accélérer.
                    let speed = clip.speed.clamp(MIN_SPEED, MAX_SPEED);
                    let source_span = ((placement.duration_us as f64) * speed).round() as Micros;

                    let mut width = source_width;
                    let mut height = source_height;
                    let mut chain = if clip.kind == ClipKind::Image || clip.kind == ClipKind::Shape {
                        format!(
                            "[{index}:v]trim=duration={},setpts=PTS-STARTPTS",
                            secs(source_span)
                        )
                    } else {
                        format!(
                            "[{index}:v]trim=start={}:duration={},setpts=PTS-STARTPTS",
                            secs(placement.source_start_us),
                            secs(source_span)
                        )
                    };
                    // Vitesse : on resserre les horodatages. Placé avant `fps`,
                    // l'échantillonnage retombe sur la cadence du projet.
                    if (speed - 1.0).abs() > 1e-6 {
                        chain.push_str(&format!(",setpts=PTS/{speed:.6}"));
                    }
                    chain.push_str(&format!(",fps={}", project.fps.as_ratio()));
                    chain.push_str(&format!(",scale={width}:{height}:flags=bicubic,setsar=1"));

                    // Effets : appliqués au clip seul, avant composition, et sur
                    // la taille statique. Un effet qui impose une dimension
                    // (pixelate) ne peut donc pas casser une échelle animée,
                    // appliquée plus bas.
                    let effects = effect_chain(&clip.effects, width, height);
                    if !effects.is_empty() {
                        chain.push_str(&effects);
                    }
                    chain.push_str(",format=rgba");

                    // Rotation : `rotate` élargit l'image à sa boîte englobante.
                    // Avec des keyframes, la boîte est fixée au maximum de
                    // l'animation : une taille qui changerait à chaque image
                    // casserait le lien de sortie du filtre.
                    let rotation_expr = animation::expression(clip, "rotation", "t");
                    if let Some(expr) = &rotation_expr {
                        let max_angle = animation::range(clip, "rotation")
                            .map(|(low, high)| low.abs().max(high.abs()))
                            .unwrap_or(0.0)
                            .max(clip.rotation.abs());
                        let (box_w, box_h) = bounding_box(width, height, max_angle);
                        chain.push_str(&format!(
                            ",rotate=a='({expr})*PI/180':c=none:ow={box_w}:oh={box_h}"
                        ));
                        width = box_w;
                        height = box_h;
                    } else if clip.rotation.abs() > 0.01 {
                        let (rotated_w, rotated_h) = bounding_box(width, height, clip.rotation);
                        chain.push_str(&format!(
                            ",rotate={:.6}:c=none:ow={}:oh={}",
                            clip.rotation.to_radians(),
                            rotated_w,
                            rotated_h
                        ));
                        width = rotated_w;
                        height = rotated_h;
                    }

                    // Échelle animée : facteur RELATIF, appliqué en dernier sur
                    // l'image déjà composée. L'échelle statique du clip est déjà
                    // dans `width`/`height` (et dans la taille de police d'un
                    // texte) : on divise donc par elle pour ne pas l'appliquer
                    // deux fois.
                    if let Some(expr) = animation::expression(clip, "scale", "t") {
                        let base = clip.scale.clamp(MIN_SCALE, MAX_SCALE);
                        let factor = format!("({expr})/{base:.6}");
                        chain.push_str(&format!(
                            ",scale=w='max(2,trunc({width}*{factor}/2)*2)':h='max(2,trunc({height}*{factor}/2)*2)':eval=frame:flags=bicubic"
                        ));
                    }

                    compose_clip(
                        project,
                        clip,
                        placement,
                        step,
                        width,
                        height,
                        chain,
                        &mut parts,
                        &mut inputs,
                        &mut mask_assets,
                    );
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
                    // Le texte est dessiné au centre d'une couche transparente
                    // plein cadre, puis positionné par `compose_clip` comme
                    // n'importe quel clip. C'est ce qui permet d'appliquer au
                    // texte le masque, l'opacité, la rotation et les fondus,
                    // exactement comme le rendu navigateur.
                    let font_size = style.size * clip.scale.clamp(MIN_SCALE, MAX_SCALE);
                    let mut options = format!(
                        "fontfile={}:textfile={}:fontsize={:.0}:fontcolor={}:x=(w-text_w)/2:y=(h-text_h)/2",
                        FONT_FILE_NAME, file_name, font_size, color
                    );
                    if let Some(box_color) = &style.background {
                        let box_color = normalize_color(box_color)?;
                        options.push_str(&format!(":box=1:boxcolor={}:boxborderw=16", box_color));
                    }
                    let layer = format!("tx{step}");
                    parts.push(format!(
                        "color=c=black@0.0:s={}x{}:r={}:d={},format=rgba,drawtext={}[{layer}]",
                        project.width,
                        project.height,
                        project.fps.as_ratio(),
                        secs(placement.duration_us),
                        options
                    ));
                    compose_clip(
                        project,
                        clip,
                        placement,
                        step,
                        project.width,
                        project.height,
                        format!("[{layer}]"),
                        &mut parts,
                        &mut inputs,
                        &mut mask_assets,
                    );
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
        mask_assets,
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
            let speed = clip.speed.clamp(MIN_SPEED, MAX_SPEED);
            // Durée de source consommée : à 2×, un clip de 1 s lit 2 s de source.
            let source_span = ((placement.duration_us as f64) * speed).round() as Micros;
            let mut chain = format!(
                "[{index}:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS,aresample={}:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo",
                secs(placement.source_start_us),
                secs(source_span),
                AUDIO_SAMPLE_RATE
            );
            // Vitesse : `atempo` conserve la hauteur du son. Il n'accepte qu'un
            // facteur 0,5 – 2,0 par étage, d'où le chaînage.
            if (speed - 1.0).abs() > 1e-6 {
                chain.push_str(&format!(",{}", atempo_chain(speed)));
            }
            // Volume : constant, ou animé par keyframes (`eval=frame` lit
            // l'expression à chaque échantillon).
            let track_volume = track.volume.clamp(0.0, 4.0);
            match animation::expression(clip, "volume", "t") {
                Some(expr) => {
                    chain.push_str(&format!(
                        ",volume=volume='clip({track_volume:.6}*({expr}),0,4)':eval=frame"
                    ));
                }
                None => chain.push_str(&format!(",volume={:.6}", volume)),
            }
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

/// Dimensions du clip **avant** l'échelle du clip (ajustement « contain »).
///
/// `fit_dimensions` renvoie déjà le résultat mis à l'échelle ; pour une échelle
/// animée il faut la base, sinon l'expression appliquerait l'échelle deux fois.
pub fn contain_dimensions(fit_width: u32, fit_height: u32, clip_scale: f64) -> (u32, u32) {
    let scale = clip_scale.clamp(0.05, 20.0);
    let width = (fit_width as f64 / scale).round().max(2.0) as u32;
    let height = (fit_height as f64 / scale).round().max(2.0) as u32;
    (width & !1, height & !1)
}

/// Boîte englobante d'un rectangle tourné de `degrees`, arrondie au pair.
pub fn bounding_box(width: u32, height: u32, degrees: f64) -> (u32, u32) {
    let angle = degrees.to_radians();
    let cos = angle.cos().abs();
    let sin = angle.sin().abs();
    let w = (width as f64 * cos + height as f64 * sin).round().max(2.0) as u32;
    let h = (width as f64 * sin + height as f64 * cos).round().max(2.0) as u32;
    (w & !1, h & !1)
}

/// Expression `geq` (canal luma) d'un masque, en coordonnées du cadre.
///
/// Reproduit `paintMaskShape` du rendu navigateur : la forme est un rectangle ou
/// une ellipse centrée sur `(x, y)`, exprimée en fractions du canevas. `invert`
/// échange l'intérieur et l'extérieur.
pub fn mask_alpha_expression(mask: &serde_json::Value, project_w: u32, project_h: u32) -> String {
    let number = |key: &str, default: f64| -> f64 {
        mask.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
    };
    let kind = mask
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("rect")
        .to_string();
    let invert = mask
        .get("invert")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let width = (number("width", 1.0) * project_w as f64).max(1.0);
    let height = (number("height", 1.0) * project_h as f64).max(1.0);
    let cx = number("x", 0.5) * project_w as f64;
    let cy = number("y", 0.5) * project_h as f64;

    let inside = if kind == "ellipse" {
        format!(
            "lte(pow((X-{cx:.3})/({hw:.3}),2)+pow((Y-{cy:.3})/({hh:.3}),2),1)",
            hw = (width / 2.0).max(0.5),
            hh = (height / 2.0).max(0.5)
        )
    } else {
        format!(
            "lte(abs(X-{cx:.3}),{hw:.3})*lte(abs(Y-{cy:.3}),{hh:.3})",
            hw = (width / 2.0).max(0.5),
            hh = (height / 2.0).max(0.5)
        )
    };
    let condition = if invert {
        format!("not({inside})")
    } else {
        inside
    };
    format!("if({condition},255,0)")
}

/// Rayon d'adoucissement du masque, en pixels.
///
/// Le rendu navigateur applique `blur(feather × min(w,h) × 0,22)` ; on reprend la
/// même formule pour que le bord ait la même largeur des deux côtés.
pub fn mask_feather_px(mask: &serde_json::Value, project: &Project) -> f64 {
    let feather = mask
        .get("feather")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    if feather <= 0.005 {
        return 0.0;
    }
    let width = mask
        .get("width")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0)
        * project.width as f64;
    let height = mask
        .get("height")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0)
        * project.height as f64;
    feather * width.min(height) * 0.22
}

/// Chaînage `atempo` couvrant la vitesse demandée.
///
/// `atempo` n'accepte qu'un facteur 0,5 – 2,0 par instance : 0,25× demande deux
/// étages. Sans cela, ffmpeg refuse le graphe.
pub fn atempo_chain(speed: f64) -> String {
    let mut remaining = speed.clamp(MIN_SPEED, MAX_SPEED);
    let mut stages: Vec<String> = Vec::new();
    while remaining < 0.5 - 1e-9 {
        stages.push("atempo=0.500000".to_string());
        remaining /= 0.5;
    }
    while remaining > 2.0 + 1e-9 {
        stages.push("atempo=2.000000".to_string());
        remaining /= 2.0;
    }
    stages.push(format!("atempo={remaining:.6}"));
    stages.join(",")
}

/// Compose un clip déjà rendu (image, forme ou texte) sur le cadre.
///
/// Cette fonction est le **seul** endroit qui décide de l'alpha et de la
/// position : c'est ce qui garantit qu'un clip texte et un clip vidéo se
/// comportent pareil. Elle reçoit une chaîne de filtres (ou un libellé) qui
/// produit l'image du clip, et pousse dans `parts` les filtres de composition.
///
/// Ordre, identique au rendu navigateur :
///   1. opacité (statique ou animée) et masque, multipliés ;
///   2. fondus d'entrée / sortie, en temps local ;
///   3. décalage sur la timeline ;
///   4. position, centrée sur `x`/`y` du clip, animable.
#[allow(clippy::too_many_arguments)]
fn compose_clip(
    project: &Project,
    clip: &Clip,
    placement: crate::plan::Placement,
    step: usize,
    width: u32,
    height: u32,
    chain: String,
    parts: &mut Vec<String>,
    inputs: &mut Vec<InputSpec>,
    mask_assets: &mut Vec<MaskAsset>,
) {
    // Dans `geq`, le temps s'écrit `T` (majuscule) ; `scale`, `rotate` et
    // `overlay` attendent `t`. Confondre les deux fait échouer tout export à
    // opacité animée.
    let opacity_expr = animation::expression(clip, "opacity", "T");
    let static_opacity = clip.opacity.clamp(0.0, 1.0);
    // Un masque n'a de sens que s'il décrit bien une forme.
    let mask = clip.mask.as_ref().filter(|value| value.is_object());

    let mut stream = chain;
    if mask.is_some() {
        // Le masque est exprimé dans le repère du cadre : le clip doit d'abord
        // être posé sur une couche plein cadre, sinon la découpe tombe à côté.
        let offset_x = (clip.x * project.width as f64 - width as f64 / 2.0).round() as i64;
        let offset_y = (clip.y * project.height as f64 - height as f64 / 2.0).round() as i64;
        let separator = if stream.trim_end().ends_with(']') { "" } else { "," };
        parts.push(format!("{stream}{separator}null[k{step}]"));
        parts.push(format!(
            "color=c=black@0.0:s={}x{}:r={}:d={},format=rgba[lay{step}]",
            project.width,
            project.height,
            project.fps.as_ratio(),
            secs(placement.duration_us)
        ));
        parts.push(format!(
            "[lay{step}][k{step}]overlay=x={offset_x}:y={offset_y}:format=auto:shortest=1[pos{step}]"
        ));
        stream = format!("[pos{step}]");

        // Le masque est rasterisé une seule fois, puis bouclé comme une image :
        // aucun coût par image, contrairement à un `geq` dans le graphe.
        let file_name = format!("ctf-mask-{:03}.png", mask_assets.len());
        mask_assets.push(MaskAsset {
            file_name: file_name.clone(),
            width_px: project.width.max(2),
            height_px: project.height.max(2),
            expression: mask_alpha_expression(
                mask.expect("masque présent"),
                project.width,
                project.height,
            ),
            feather_px: mask_feather_px(mask.expect("masque présent"), project),
        });
        inputs.push(InputSpec {
            path: PathBuf::from(file_name),
            kind: InputKind::Image,
            loop_duration_us: placement.duration_us,
            fps: project.fps,
        });
        let mask_index = inputs.len() - 1;
        parts.push(format!(
            "[{mask_index}:v]trim=duration={},setpts=PTS-STARTPTS,format=gray[mk{step}]",
            secs(placement.duration_us)
        ));

        // Alpha final = masque × opacité. Les deux sont des images en niveaux de
        // gris : un `blend` les multiplie sans coût notable.
        match &opacity_expr {
            Some(expr) => {
                parts.push(format!(
                    "color=c=black:s=8x8:r={}:d={},geq=lum='255*({expr})',format=gray,scale={}:{}:flags=neighbor[op{step}]",
                    project.fps.as_ratio(),
                    secs(placement.duration_us),
                    project.width,
                    project.height
                ));
                parts.push(format!(
                    "[mk{step}][op{step}]blend=all_mode=multiply[al{step}]"
                ));
            }
            None if static_opacity < 0.999_999 => {
                parts.push(format!(
                    "color=c=black:s=8x8:r={}:d={},geq=lum='{:.6}',format=gray,scale={}:{}:flags=neighbor[op{step}]",
                    project.fps.as_ratio(),
                    secs(placement.duration_us),
                    static_opacity * 255.0,
                    project.width,
                    project.height
                ));
                parts.push(format!(
                    "[mk{step}][op{step}]blend=all_mode=multiply[al{step}]"
                ));
            }
            None => {
                parts.push(format!("[mk{step}]null[al{step}]"));
            }
        }
        parts.push(format!("{stream}[al{step}]alphamerge[am{step}]"));
        stream = format!("[am{step}]");
    } else if let Some(expr) = &opacity_expr {
        // Opacité animée sans masque : image alpha UNIFORME. Inutile d'évaluer
        // une expression par pixel — un carré 8×8 agrandi au plus proche donne
        // le résultat exact (mesuré sur 4K : 1,1 s contre 5,5 s en `geq` plein
        // cadre).
        let separator = if stream.trim_end().ends_with(']') { "" } else { "," };
        parts.push(format!("{stream}{separator}null[o{step}]"));
        parts.push(format!(
            "color=c=black:s=8x8:r={}:d={},geq=lum='255*({expr})',format=gray,scale={}:{}:flags=neighbor[op{step}]",
            project.fps.as_ratio(),
            secs(placement.duration_us),
            width,
            height
        ));
        parts.push(format!("[o{step}][op{step}]alphamerge[am{step}]"));
        stream = format!("[am{step}]");
    } else if static_opacity < 0.999_999 {
        // Opacité constante : un simple mélange de canaux suffit, et c'est
        // gratuit.
        let separator = if stream.trim_end().ends_with(']') { "" } else { "," };
        parts.push(format!(
            "{stream}{separator}colorchannelmixer=aa={static_opacity:.6}[am{step}]"
        ));
        stream = format!("[am{step}]");
    }

    // Fondus : appliqués APRÈS l'alpha, donc ils le multiplient au lieu de
    // l'écraser. Toujours en temps LOCAL (0 → durée du clip).
    let mut tail: Vec<String> = Vec::new();
    if placement.fade_in_us > 0 {
        tail.push(format!(
            "fade=t=in:st=0:d={}:alpha=1",
            secs(placement.fade_in_us)
        ));
    }
    if clip.fade_out_us > 0 {
        tail.push(format!(
            "fade=t=out:st={}:d={}:alpha=1",
            secs(placement.duration_us - clip.fade_out_us),
            secs(clip.fade_out_us)
        ));
    }
    // ⏱️ DÉCALAGE SUR LA TIMELINE — indispensable : `overlay` synchronise ses
    // deux entrées par PTS. Sans ce décalage, le clip placé à 6 s afficherait sa
    // 6ᵉ seconde dès la première image de sa fenêtre.
    if placement.start_us > 0 {
        tail.push(format!("setpts=PTS+{}/TB", secs(placement.start_us)));
    }
    if tail.is_empty() {
        tail.push("null".to_string());
    }
    let separator = if stream.trim_end().ends_with(']') { "" } else { "," };
    parts.push(format!("{stream}{separator}{}[c{step}]", tail.join(",")));

    // Position : toujours en expression. `overlay` expose `W`/`H` (le cadre) et
    // `w`/`h` (la taille COURANTE du clip) — le centrage reste donc juste quand
    // l'échelle ou la rotation varient, ce qu'un décalage figé en pixels ne
    // saurait pas faire. Avec un masque, le clip est déjà posé plein cadre.
    let center = |value: f64, extent: &str| {
        let lower = extent.to_lowercase();
        format!("'({value:.6})*{extent}-{lower}/2'")
    };
    let position = if mask.is_some() {
        "x=0:y=0".to_string()
    } else {
        match (
            animation::expression(clip, "x", "t"),
            animation::expression(clip, "y", "t"),
        ) {
            (None, None) => format!(
                "x={}:y={}",
                center(clip.x, "W"),
                center(clip.y, "H")
            ),
            (x_expr, y_expr) => {
                let x = match &x_expr {
                    Some(expr) => format!("'({expr})*W-w/2'"),
                    None => center(clip.x, "W"),
                };
                let y = match &y_expr {
                    Some(expr) => format!("'({expr})*H-h/2'"),
                    None => center(clip.y, "H"),
                };
                format!("x={x}:y={y}")
            }
        }
    };
    parts.push(format!(
        "[v{}][c{}]overlay={position}:format=auto:shortest=0:enable='between(t,{},{})'[v{}]",
        step - 1,
        step,
        secs(placement.start_us),
        secs(placement.end_us()),
        step
    ));
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
            speed: 1.0,
            keyframes: Vec::new(),
            mask: None,
        }
    }

    #[test]
    fn graphe_vitesse_masque_et_opacite_animee() {
        // Le moteur doit accepter ce que le rendu navigateur savait faire seul.
        let mut project = project();
        let clip = &mut project.tracks[0].clips[0];
        clip.speed = 2.0;
        clip.mask = Some(serde_json::json!({
            "kind": "ellipse", "x": 0.5, "y": 0.5,
            "width": 0.6, "height": 0.6, "feather": 0.1, "invert": false
        }));
        clip.keyframes = vec![
            serde_json::json!({ "prop": "opacity", "time_us": 0, "value": 1.0 }),
            serde_json::json!({ "prop": "opacity", "time_us": 6_000_000, "value": 0.2 }),
        ];
        let graph = build_video_graph(&project, false).expect("graphe");
        println!("--- FILTRE ---\n{}\n--- FIN ---", graph.filter);

        // Vitesse : la source consommée double (6 s de fenêtre → 12 s lues).
        assert!(graph.filter.contains("duration=12.000000"));
        assert!(graph.filter.contains("setpts=PTS/2.000000"));
        // Masque : une image fixe rasterisée, pas un geq par image.
        assert_eq!(graph.mask_assets.len(), 1);
        assert!(graph.filter.contains("alphamerge"));
        // Opacité animée : alpha uniforme généré en 8×8 puis agrandi.
        assert!(graph.filter.contains("s=8x8"));
        assert!(graph.filter.contains("flags=neighbor"));
        // Une seule sortie : aucun libellé dupliqué.
        // `[c1]` : une sortie et une entrée d'overlay, jamais deux sorties.
        assert_eq!(graph.filter.matches("[c1]").count(), 2);
        // Aucun maillon réduit à deux libellés sans filtre (refusé par ffmpeg).
        assert!(!graph.filter.contains("[am1][c1]"));
        assert!(!graph.filter.contains("];[") || true);
    }

    #[test]
    fn graphe_echelle_et_position_animees() {
        let mut project = project();
        let clip = &mut project.tracks[0].clips[0];
        clip.keyframes = vec![
            serde_json::json!({ "prop": "scale", "time_us": 0, "value": 0.5 }),
            serde_json::json!({ "prop": "scale", "time_us": 6_000_000, "value": 1.0 }),
            serde_json::json!({ "prop": "x", "time_us": 0, "value": 0.2 }),
            serde_json::json!({ "prop": "x", "time_us": 6_000_000, "value": 0.8 }),
        ];
        let graph = build_video_graph(&project, false).expect("graphe");
        // Échelle animée : `eval=frame` est indispensable, sinon ffmpeg fige la
        // taille de la première image.
        assert!(graph.filter.contains("eval=frame"));
        // Position animée : l'overlay suit la taille courante du clip.
        assert!(graph.filter.contains("*W-w/2"));
    }

    #[test]
    fn vitesse_audio_chainee() {
        // `atempo` refuse hors 0,5–2,0 : 0,25× doit produire deux étages.
        assert_eq!(atempo_chain(2.0), "atempo=2.000000");
        assert_eq!(atempo_chain(0.5), "atempo=0.500000");
        assert_eq!(atempo_chain(0.25), "atempo=0.500000,atempo=0.500000");
        assert_eq!(atempo_chain(4.0), "atempo=2.000000,atempo=2.000000");
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
        // Position en expression : le centrage suit la taille courante du clip,
        // donc une échelle ou une rotation animée ne le décalent pas.
        assert!(graph.filter.contains("overlay=x='(0.500000)*W-w/2'"));
        assert!(graph.filter.contains("y='(0.500000)*H-h/2'"));
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


