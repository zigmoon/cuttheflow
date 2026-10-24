//! Modèle de projet — la seule source de vérité de la timeline.
//!
//! Le format est versionné et volontairement plat : les clips portent leurs
//! propres réglages (volume, fondus, échelle, position) pour qu'un projet
//! s'ouvre à l'identique sans dépendre d'un état d'interface.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::time::{Fps, Micros};

/// Durée maximale acceptée pour une timeline (3 heures, comme la v1).
pub const MAX_TIMELINE_US: Micros = 3 * 60 * 60 * 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipKind {
    Video,
    Image,
    Audio,
    Text,
    Shape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Mp4,
    Webm,
    Mp3,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Mp4 => "mp4",
            ExportFormat::Webm => "webm",
            ExportFormat::Mp3 => "mp3",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            ExportFormat::Mp4 => "video/mp4",
            ExportFormat::Webm => "video/webm",
            ExportFormat::Mp3 => "audio/mpeg",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "mp4" => Ok(ExportFormat::Mp4),
            "webm" => Ok(ExportFormat::Webm),
            "mp3" => Ok(ExportFormat::Mp3),
            other => Err(format!("format inconnu : {other} (mp4, webm ou mp3)")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSettings {
    #[serde(default = "default_format")]
    pub format: ExportFormat,
    /// CRF x264 (0-51, 18 = très bonne qualité) ou VP9 (0-63, 30 = bonne qualité).
    #[serde(default = "default_crf")]
    pub crf: u8,
    /// `fast`, `medium`, `slow`… (x264) ou `good`/`best` (VP9).
    #[serde(default = "default_preset")]
    pub preset: String,
}

fn default_format() -> ExportFormat {
    ExportFormat::Mp4
}
fn default_crf() -> u8 {
    18
}
fn default_preset() -> String {
    "medium".into()
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            format: ExportFormat::Mp4,
            crf: 18,
            preset: default_preset(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Media {
    pub id: String,
    pub name: String,
    pub kind: MediaKind,
    /// Chemin absolu sur le disque (le serveur le résout depuis son registre).
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub duration_us: Micros,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Cadence réelle de la source (29,97 conserve `30000/1001`).
    #[serde(default)]
    pub fps: Option<Fps>,
    #[serde(default)]
    pub has_audio: bool,
    #[serde(default)]
    pub sample_rate: u32,
    #[serde(default)]
    pub channels: u32,
    #[serde(default)]
    pub size_bytes: u64,
}

impl Media {
    pub fn is_visual(&self) -> bool {
        matches!(self.kind, MediaKind::Video | MediaKind::Image)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextStyle {
    #[serde(default)]
    pub content: String,
    #[serde(default = "default_text_size")]
    pub size: f64,
    #[serde(default = "default_text_color")]
    pub color: String,
    /// Fond optionnel derrière le texte (`#000000` avec opacité gérée par ffmpeg).
    #[serde(default)]
    pub background: Option<String>,
}

fn default_text_size() -> f64 {
    64.0
}
fn default_text_color() -> String {
    "#FFFFFF".into()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShapeKind {
    Rect,
    Ellipse,
}

/// Forme pleine dessinée au-dessus de la timeline.
///
/// `width` et `height` sont des fractions du canevas (0.4 = 40 %), `x`/`y` du
/// clip restent le centre. `radius` est le rayon des coins, en fraction de la
/// petite dimension : 0 = rectangle net, 0.5 = ellipse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeStyle {
    #[serde(default = "default_shape_kind")]
    pub kind: ShapeKind,
    #[serde(default = "default_shape_color")]
    pub color: String,
    #[serde(default = "default_shape_width")]
    pub width: f64,
    #[serde(default = "default_shape_height")]
    pub height: f64,
    #[serde(default)]
    pub radius: f64,
}

fn default_shape_kind() -> ShapeKind {
    ShapeKind::Rect
}
fn default_shape_color() -> String {
    "#1A1A1A".into()
}
fn default_shape_width() -> f64 {
    0.5
}
fn default_shape_height() -> f64 {
    0.4
}

impl Default for ShapeStyle {
    fn default() -> Self {
        Self {
            kind: ShapeKind::Rect,
            color: default_shape_color(),
            width: default_shape_width(),
            height: default_shape_height(),
            radius: 0.0,
        }
    }
}

/// Effet visuel appliqué au clip, avant composition.
///
/// `amount` est normalisé 0 → 1 ; chaque effet décide de son amplitude réelle.
/// Les noms sont ceux exposés par l'interface ; un nom inconnu est ignoré
/// (⇒ un projet plus récent s'ouvre sans casser l'export).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effect {
    pub name: String,
    #[serde(default = "one")]
    pub amount: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransitionKind {
    /// Fondu depuis le fond : aucune fenêtre déplacée, aucun risque de sync.
    Fade,
    /// Fondu enchaîné par recouvrement : consomme `d` de marge de part et
    /// d'autre, du son ET de l'image (jamais l'un sans l'autre).
    Dissolve,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transition {
    #[serde(default = "default_transition_kind")]
    pub kind: TransitionKind,
    #[serde(default = "default_transition_duration")]
    pub duration_us: Micros,
}

fn default_transition_kind() -> TransitionKind {
    TransitionKind::Fade
}
fn default_transition_duration() -> Micros {
    500_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: ClipKind,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub media: Option<String>,
    #[serde(default)]
    pub start_us: Micros,
    pub duration_us: Micros,
    /// Position de départ dans le média source.
    #[serde(default)]
    pub source_start_us: Micros,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in_us: Micros,
    #[serde(default)]
    pub fade_out_us: Micros,
    /// Échelle appliquée après ajustement au canevas (1.0 = contenu entier).
    #[serde(default = "one")]
    pub scale: f64,
    /// Centre du clip, en fraction du canevas (0.5 = centre).
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "half")]
    pub y: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    /// Coupe le son de ce clip sans détacher la piste audio.
    #[serde(default)]
    pub audio_muted: bool,
    #[serde(default)]
    pub text: Option<TextStyle>,
    #[serde(default)]
    pub shape: Option<ShapeStyle>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub transition: Option<Transition>,
    /// Rotation du clip autour de son centre, en degrés.
    #[serde(default)]
    pub rotation: f64,
    /// Vitesse de lecture (1.0 = temps réel). Non rendue par le moteur : le
    /// champ est lu uniquement pour refuser le projet au lieu de produire un
    /// export silencieusement faux.
    #[serde(default = "one")]
    pub speed: f64,
    #[serde(default)]
    pub keyframes: Vec<serde_json::Value>,
    #[serde(default)]
    pub mask: Option<serde_json::Value>,
}

fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}

impl Clip {
    pub fn end_us(&self) -> Micros {
        self.start_us.saturating_add(self.duration_us)
    }

    /// Vrai si le clip utilise une fonction que ffmpeg ne rend pas encore.
    ///
    /// Le moteur natif rend désormais la vitesse, les keyframes (opacité,
    /// échelle, position, rotation, volume) et les masques, **y compris sur les
    /// clips texte et forme** : le texte est composé sur une couche transparente
    /// puis traité comme n'importe quel clip.
    ///
    /// Il ne reste donc plus aucun cas de repli obligatoire. La fonction est
    /// conservée : c'est le point unique où déclarer une future limite, plutôt
    /// que de la laisser produire un fichier faux en silence.
    pub fn needs_browser_render(&self) -> Option<&'static str> {
        None
    }

    pub fn is_visual(&self) -> bool {
        matches!(
            self.kind,
            ClipKind::Video | ClipKind::Image | ClipKind::Text | ClipKind::Shape
        )
    }

    /// Durée de la marge disponible AVANT le point d'entrée dans la source.
    pub fn handle_before_us(&self) -> Micros {
        self.source_start_us.max(0)
    }

    /// Durée de la marge disponible APRÈS le point de sortie.
    pub fn handle_after_us(&self, media_duration_us: Micros) -> Micros {
        if media_duration_us <= 0 {
            return MAX_TIMELINE_US;
        }
        (media_duration_us - (self.source_start_us + self.duration_us)).max(0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    #[serde(default = "default_track_kind")]
    pub kind: TrackKind,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub muted: bool,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub clips: Vec<Clip>,
}

fn default_track_kind() -> TrackKind {
    TrackKind::Video
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_name")]
    pub name: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub fps: Fps,
    #[serde(default = "default_background")]
    pub background: String,
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub media: Vec<Media>,
    #[serde(default)]
    pub export: ExportSettings,
}

fn default_version() -> u32 {
    1
}
fn default_name() -> String {
    "Untitled".into()
}
fn default_background() -> String {
    "#000000".into()
}

impl Project {
    pub fn timeline_end_us(&self) -> Micros {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .map(|c| c.end_us())
            .max()
            .unwrap_or(0)
    }

    /// Fin de la timeline en excluant les pistes muettes (utile pour l'audio seul).
    pub fn audible_end_us(&self) -> Micros {
        self.tracks
            .iter()
            .filter(|t| !t.muted)
            .flat_map(|t| t.clips.iter())
            .filter(|c| matches!(c.kind, ClipKind::Audio) || (c.kind == ClipKind::Video && !c.audio_muted))
            .map(|c| c.end_us())
            .max()
            .unwrap_or(0)
    }

    pub fn media_map(&self) -> HashMap<&str, &Media> {
        self.media.iter().map(|m| (m.id.as_str(), m)).collect()
    }

    pub fn media_by_id(&self, id: &str) -> Option<&Media> {
        self.media.iter().find(|m| m.id == id)
    }

    pub fn clip_count(&self) -> usize {
        self.tracks.iter().map(|t| t.clips.len()).sum()
    }

    /// Valide la structure avant tout rendu. Les erreurs sont destinées à
    /// l'utilisateur : elles expliquent quoi corriger, pas seulement « invalide ».
    pub fn validate(&self) -> Result<(), String> {
        if self.width == 0 || self.height == 0 {
            return Err("résolution invalide (0×0)".into());
        }
        if self.width % 2 != 0 || self.height % 2 != 0 {
            return Err(format!(
                "résolution {}×{} : la largeur et la hauteur doivent être paires (H.264/VP9)",
                self.width, self.height
            ));
        }
        if self.width > 7680 || self.height > 4320 {
            return Err("résolution supérieure à 8K non prise en charge".into());
        }
        self.fps.validate()?;
        if self.tracks.is_empty() {
            return Err("le projet ne contient aucune piste".into());
        }
        if self.clip_count() == 0 {
            return Err("la timeline est vide : ajoutez au moins un clip".into());
        }

        let mut ids = HashSet::new();
        for media in &self.media {
            if media.id.trim().is_empty() {
                return Err("média sans identifiant".into());
            }
            if !ids.insert(media.id.as_str()) {
                return Err(format!("identifiant de média dupliqué : {}", media.id));
            }
        }
        let media_map = self.media_map();

        let mut clip_ids = HashSet::new();
        let mut track_ids = HashSet::new();
        for track in &self.tracks {
            if track.id.trim().is_empty() {
                return Err("piste sans identifiant".into());
            }
            if !track_ids.insert(track.id.as_str()) {
                return Err(format!("identifiant de piste dupliqué : {}", track.id));
            }
            if !(0.0..=2.0).contains(&track.volume) {
                return Err(format!("volume de piste hors limites (0–200 %) : {}", track.volume));
            }
            for clip in &track.clips {
                if clip.id.trim().is_empty() {
                    return Err("clip sans identifiant".into());
                }
                if !clip_ids.insert(clip.id.as_str()) {
                    return Err(format!("identifiant de clip dupliqué : {}", clip.id));
                }
                if clip.duration_us <= 0 {
                    return Err(format!("clip « {} » : durée nulle ou négative", clip_label(clip)));
                }
                if clip.start_us < 0 || clip.source_start_us < 0 {
                    return Err(format!("clip « {} » : temps négatif", clip_label(clip)));
                }
                if clip.end_us() > MAX_TIMELINE_US {
                    return Err("timeline supérieure à 3 heures".into());
                }
                if clip.fade_in_us < 0 || clip.fade_out_us < 0 {
                    return Err(format!("clip « {} » : fondu négatif", clip_label(clip)));
                }
                if clip.fade_in_us + clip.fade_out_us > clip.duration_us {
                    return Err(format!(
                        "clip « {} » : les fondus dépassent la durée du clip",
                        clip_label(clip)
                    ));
                }
                if !(0.0..=2.0).contains(&clip.volume) {
                    return Err(format!(
                        "clip « {} » : volume hors limites (0–200 %)",
                        clip_label(clip)
                    ));
                }
                if !(0.05..=20.0).contains(&clip.scale) {
                    return Err(format!("clip « {} » : échelle hors limites", clip_label(clip)));
                }
                if !(0.0..=1.0).contains(&clip.opacity) {
                    return Err(format!("clip « {} » : opacité hors limites (0–1)", clip_label(clip)));
                }
                if !(-1.0..=2.0).contains(&clip.x) || !(-1.0..=2.0).contains(&clip.y) {
                    return Err(format!("clip « {} » : position hors limites", clip_label(clip)));
                }
                if !(-360.0..=360.0).contains(&clip.rotation) {
                    return Err(format!("clip « {} » : rotation hors limites", clip_label(clip)));
                }
                if clip.effects.len() > 8 {
                    return Err(format!("clip « {} » : trop d'effets (8 maximum)", clip_label(clip)));
                }
                for effect in &clip.effects {
                    if !(0.0..=1.0).contains(&effect.amount) {
                        return Err(format!(
                            "clip « {} » : intensité d'effet hors limites (0–1)",
                            clip_label(clip)
                        ));
                    }
                }
                if let Some(transition) = &clip.transition {
                    if transition.duration_us <= 0
                        || transition.duration_us > clip.duration_us / 2
                    {
                        return Err(format!(
                            "clip « {} » : durée de transition supérieure à la moitié du clip",
                            clip_label(clip)
                        ));
                    }
                }

                if clip.kind == ClipKind::Text {
                    let text = clip
                        .text
                        .as_ref()
                        .ok_or_else(|| format!("clip « {} » : texte manquant", clip_label(clip)))?;
                    if text.content.trim().is_empty() {
                        return Err(format!("clip « {} » : texte vide", clip_label(clip)));
                    }
                    if !(8.0..=512.0).contains(&text.size) {
                        return Err(format!("clip « {} » : taille de texte hors limites", clip_label(clip)));
                    }
                    crate::graph::normalize_color(&text.color)?;
                    continue;
                }

                if clip.kind == ClipKind::Shape {
                    let shape = clip
                        .shape
                        .as_ref()
                        .ok_or_else(|| format!("clip « {} » : forme manquante", clip_label(clip)))?;
                    if !(0.01..=2.0).contains(&shape.width) || !(0.01..=2.0).contains(&shape.height) {
                        return Err(format!("clip « {} » : dimensions de forme hors limites", clip_label(clip)));
                    }
                    if !(0.0..=0.5).contains(&shape.radius) {
                        return Err(format!("clip « {} » : rayon d'arrondi hors limites (0–0,5)", clip_label(clip)));
                    }
                    crate::graph::normalize_color(&shape.color)?;
                    continue;
                }

                let media_id = clip
                    .media
                    .as_deref()
                    .ok_or_else(|| format!("clip « {} » : média non référencé", clip_label(clip)))?;
                let media = media_map
                    .get(media_id)
                    .ok_or_else(|| format!("clip « {} » : média inconnu ({media_id})", clip_label(clip)))?;
                let compatible = match clip.kind {
                    ClipKind::Video => media.kind == MediaKind::Video,
                    ClipKind::Image => media.kind == MediaKind::Image,
                    ClipKind::Audio => media.kind == MediaKind::Audio || media.has_audio,
                    ClipKind::Text | ClipKind::Shape => true,
                };
                if !compatible {
                    return Err(format!(
                        "clip « {} » : type de média incompatible ({:?})",
                        clip_label(clip),
                        media.kind
                    ));
                }
                if media.path.trim().is_empty() {
                    return Err(format!("média « {} » : chemin introuvable", media.name));
                }
                if clip.kind == ClipKind::Audio && !media.has_audio {
                    return Err(format!("média « {} » : aucune piste audio", media.name));
                }
                if clip.kind == ClipKind::Audio && media.kind == MediaKind::Image {
                    return Err(format!("clip « {} » : une image n'a pas de piste audio", clip_label(clip)));
                }
            }
        }
        Ok(())
    }
}

fn clip_label(clip: &Clip) -> &str {
    if clip.name.is_empty() {
        &clip.id
    } else {
        &clip.name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media(id: &str, kind: MediaKind) -> Media {
        Media {
            id: id.into(),
            name: format!("{id}.bin"),
            kind,
            path: format!("/tmp/{id}.bin"),
            duration_us: 10_000_000,
            width: 1920,
            height: 1080,
            fps: Some(Fps::new(30, 1)),
            has_audio: kind == MediaKind::Video,
            sample_rate: 48_000,
            channels: 2,
            size_bytes: 1,
        }
    }

    fn clip(id: &str, kind: ClipKind, media: Option<&str>) -> Clip {
        Clip {
            id: id.into(),
            kind,
            name: id.into(),
            media: media.map(str::to_string),
            start_us: 0,
            duration_us: 2_000_000,
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

    fn project() -> Project {
        Project {
            version: 1,
            name: "test".into(),
            width: 1280,
            height: 720,
            fps: Fps::new(30, 1),
            background: "#000000".into(),
            tracks: vec![Track {
                id: "t1".into(),
                kind: TrackKind::Video,
                name: "VIDEO 1".into(),
                muted: false,
                volume: 1.0,
                clips: vec![clip("c1", ClipKind::Video, Some("m1"))],
            }],
            media: vec![media("m1", MediaKind::Video)],
            export: ExportSettings::default(),
        }
    }

    #[test]
    fn detecte_les_fonctions_non_rendues() {
        let mut c = clip("c1", ClipKind::Video, Some("m1"));
        assert_eq!(c.needs_browser_render(), None);
        // Vitesse, keyframes et masques sont rendus par le moteur.
        c.speed = 2.0;
        assert_eq!(c.needs_browser_render(), None);
        c.speed = 1.0;
        c.keyframes = vec![serde_json::json!({ "prop": "opacity", "time_us": 0, "value": 1.0 })];
        assert_eq!(c.needs_browser_render(), None);
        c.keyframes.clear();
        c.mask = Some(serde_json::json!({ "kind": "rect" }));
        assert_eq!(c.needs_browser_render(), None);

        // Les clips texte passent par la même composition : plus aucun repli.
        let mut text = clip("t1", ClipKind::Text, None);
        text.keyframes =
            vec![serde_json::json!({ "prop": "scale", "time_us": 0, "value": 2.0 })];
        assert_eq!(text.needs_browser_render(), None);
    }

    #[test]
    fn projet_valide() {
        assert!(project().validate().is_ok());    }

    #[test]
    fn refuse_resolution_impaire() {
        let mut p = project();
        p.width = 1279;
        assert!(p.validate().unwrap_err().contains("paires"));
    }

    #[test]
    fn refuse_timeline_vide() {
        let mut p = project();
        p.tracks[0].clips.clear();
        assert!(p.validate().unwrap_err().contains("vide"));
    }

    #[test]
    fn refuse_media_absent() {
        let mut p = project();
        p.tracks[0].clips[0].media = Some("inconnu".into());
        assert!(p.validate().unwrap_err().contains("inconnu"));
    }

    #[test]
    fn refuse_fondus_trop_longs() {
        let mut p = project();
        p.tracks[0].clips[0].fade_in_us = 1_500_000;
        p.tracks[0].clips[0].fade_out_us = 1_000_000;
        assert!(p.validate().unwrap_err().contains("fondus"));
    }

    #[test]
    fn fin_de_timeline() {
        let mut p = project();
        p.tracks[0].clips[0].start_us = 1_000_000;
        p.tracks[0].clips[0].duration_us = 2_500_000;
        assert_eq!(p.timeline_end_us(), 3_500_000);
    }
}
