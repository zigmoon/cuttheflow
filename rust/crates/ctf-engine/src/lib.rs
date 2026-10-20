//! CUT THE FLOW — moteur d'export natif.
//!
//! Le moteur n'encode rien lui-même : il construit deux graphes (audio puis
//! vidéo) et les confie à ffmpeg. Ce qui garantit la synchronisation :
//!
//! 1. le mixage audio est rendu **avant** la vidéo, dans un WAV flottant qui
//!    commence à l'échantillon 0 ;
//! 2. chaque clip vidéo est décalé sur la timeline par `setpts` **avant** son
//!    `overlay` (sinon le clip afficherait sa propre 6ᵉ seconde à t = 6 s) ;
//! 3. la cadence de sortie est forcée (`fps=` + `-r`), donc le nombre d'images
//!    ne dépend ni de la machine ni de la vitesse de décodage ;
//! 4. la durée est imposée par `-t` et l'audio est complété par `apad`, donc
//!    les deux flux ont exactement la même durée.
//!
//! Mesures de référence : voir `tools/regression` (29/29 vérifications sur la
//! version web). Le vérificateur de la version Rust rejoue les mêmes repères
//! de fréquence et la même fidélité image par image.

#![forbid(unsafe_code)]

mod export;
mod ffmpeg;
mod font;
mod wav;

pub use export::{export, ExportOptions, ExportResult, Progress};
pub use ffmpeg::{hidden, Ffmpeg, FfmpegInfo};
pub use font::default_font;
