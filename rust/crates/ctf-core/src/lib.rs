//! CUT THE FLOW — noyau de la version 2.
//!
//! Ce crate ne lance **aucun** processus : il ne décrit que la timeline et le
//! graphe de filtres ffmpeg qui en découle. C'est ce qui rend le moteur
//! testable sans ffmpeg et vérifiable par des tests unitaires.
//!
//! Unités :
//! * le temps de la timeline est un entier de **microsecondes** (`i64`) ;
//! * l'audio est échantillonné à **48 000 Hz** ;
//! * la cadence est un rationnel (`30000/1001` pour le 29,97).
//!
//! L'audio et la vidéo sont planifiés séparément, puis réunis par ffmpeg :
//! le mixage audio est un fichier PCM flottant qui commence à t = 0, et la
//! composition vidéo commence à l'image 0. Aucun des deux ne dépend d'une
//! horloge murale : le résultat est identique sur toutes les machines.

#![forbid(unsafe_code)]

pub mod animation;
pub mod graph;
pub mod model;
pub mod plan;
pub mod probe;
pub mod time;

pub use graph::{AudioGraph, InputSpec, ShapeAsset, VideoGraph};
pub use model::{
    Clip, ClipKind, Effect, ExportFormat, Media, Project, ShapeKind, ShapeStyle, TextStyle,
    Track, TrackKind, Transition, TransitionKind,
};
pub use plan::{resolve_project, Placement};
pub use time::{Fps, Micros, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE};
