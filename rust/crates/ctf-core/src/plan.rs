//! Résolution des transitions en positions effectives.
//!
//! Une transition « fondu enchaîné » ne peut pas être dessinée sans que les deux
//! clips se recouvrent. On déplace donc la fenêtre du clip entrant de `d` en
//! arrière, et son point d'entrée source de `d` aussi. La fenêtre est également
//! **allongée de `d`** : son point de sortie ne bouge pas, donc le clip suivant
//! posé au contact d'origine reste collé et aucun trou noir/silencieux
//! n'apparaît. **L'image et le son subissent exactement le même décalage et le
//! même allongement** : c'est la seule façon de garder la synchronisation
//! parfaite (un décalage d'un seul côté produirait un décalage audible de `d`).
//!
//! `d` est borné par les trois ressources réellement disponibles :
//!   • la marge avant du clip entrant (`source_start_us`) ;
//!   • la marge après du clip sortant (durée du média − point de sortie) ;
//!   • la moitié de chaque clip (on ne doit pas avaler un clip entier).
//!
//! Si l'une de ces marges est nulle (cas très courant : des rushes posés bord à
//! bord, sans marge), `d` tombe à zéro et la transition devient un simple fondu
//! depuis le fond — jamais un décalage approximatif.

use crate::model::{Clip, Project, TransitionKind};use crate::time::Micros;

#[derive(Debug, Clone, Copy)]
pub struct Placement {
    pub start_us: Micros,
    pub source_start_us: Micros,
    pub duration_us: Micros,
    /// Fondu (alpha) au début de la fenêtre effective.
    pub fade_in_us: Micros,
    /// Durée du recouvrement avec le clip précédent (0 = aucun).
    pub dissolve_us: Micros,
}

impl Placement {
    pub fn end_us(&self) -> Micros {
        self.start_us + self.duration_us
    }
}

/// Résout les transitions d'une piste. `clips` doit être trié par `start_us`.
pub fn resolve_track(clips: &[Clip], media_durations: &[Micros]) -> Vec<Placement> {
    let media_of = |index: usize| -> Micros {
        media_durations.get(index).copied().unwrap_or(0)
    };

    let mut placements: Vec<Placement> = clips
        .iter()
        .map(|clip| {
            let mut fade_in = clip.fade_in_us;
            if let Some(transition) = &clip.transition {
                if transition.kind == TransitionKind::Fade {
                    fade_in = fade_in.max(transition.duration_us);
                }
            }
            Placement {
                start_us: clip.start_us,
                source_start_us: clip.source_start_us,
                duration_us: clip.duration_us,
                fade_in_us: fade_in.min(clip.duration_us),
                dissolve_us: 0,
            }
        })
        .collect();

    for index in 1..clips.len() {
        let Some(transition) = &clips[index].transition else {
            continue;
        };
        if transition.kind != TransitionKind::Dissolve {
            continue;
        }
        let current = &clips[index];
        let previous = &clips[index - 1];
        if !current.is_visual() || !previous.is_visual() {
            continue;
        }
        if placements[index - 1].end_us() != placements[index].start_us {
            // Les clips ne se touchent pas : il n'y a rien à enchaîner. On ne
            // « rapproche » jamais deux clips pour forcer une transition.
            continue;
        }

        let mut d = transition.duration_us;
        d = d.min(current.source_start_us);
        d = d.min(previous.handle_after_us(media_of(index - 1)));
        d = d.min(current.duration_us / 2);
        d = d.min(previous.duration_us / 2);
        d = d.max(0);

        if d == 0 {
            // Pas de marge : fondu depuis le fond, sans déplacement.
            placements[index].fade_in_us = placements[index]
                .fade_in_us
                .max(transition.duration_us.min(current.duration_us / 2));
            continue;
        }

        placements[index].start_us -= d;
        placements[index].source_start_us -= d;
        // La fenêtre recule de `d` ET s'allonge de `d` : le point de sortie
        // d'origine est conservé. Sans cet allongement, le clip suivant (posé
        // au contact d'origine) laisserait un trou de `d` — image noire et
        // silence — entre les deux clips.
        placements[index].duration_us += d;
        placements[index].dissolve_us = d;
        placements[index].fade_in_us = placements[index].fade_in_us.max(d);
    }

    placements
}

/// Résout toutes les pistes. Le vecteur extérieur suit `project.tracks`, le
/// vecteur intérieur suit `track.clips` (même ordre, sans tri).
pub fn resolve_project(project: &Project) -> Vec<Vec<Placement>> {
    project
        .tracks
        .iter()
        .map(|track| {
            let mut order: Vec<usize> = (0..track.clips.len()).collect();
            order.sort_by(|a, b| {
                track.clips[*a]
                    .start_us
                    .cmp(&track.clips[*b].start_us)
                    .then_with(|| track.clips[*a].id.cmp(&track.clips[*b].id))
            });
            let sorted: Vec<Clip> = order.iter().map(|i| track.clips[*i].clone()).collect();
            let durations: Vec<Micros> = sorted
                .iter()
                .map(|clip| {
                    clip.media
                        .as_deref()
                        .and_then(|id| project.media_by_id(id))
                        .map(|media| media.duration_us)
                        .unwrap_or(0)
                })
                .collect();
            let resolved = resolve_track(&sorted, &durations);

            // On remet les placements dans l'ordre d'origine du tableau.
            let mut out: Vec<Placement> = vec![
                Placement {
                    start_us: 0,
                    source_start_us: 0,
                    duration_us: 0,
                    fade_in_us: 0,
                    dissolve_us: 0,
                };
                sorted.len()
            ];
            for (position, original) in order.iter().enumerate() {
                out[*original] = resolved[position];
            }
            out
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ClipKind, ExportSettings, Media, MediaKind, Track, TrackKind};
    use crate::time::Fps;

    fn media(id: &str, duration_us: Micros) -> Media {
        Media {
            id: id.into(),
            name: format!("{id}.mp4"),
            kind: MediaKind::Video,
            path: format!("/{id}.mp4"),
            duration_us,
            width: 1920,
            height: 1080,
            fps: Some(Fps::new(30, 1)),
            has_audio: true,
            sample_rate: 48_000,
            channels: 2,
            size_bytes: 1,
        }
    }

    fn clip(id: &str, start: Micros, duration: Micros, source: Micros) -> Clip {
        Clip {
            id: id.into(),
            kind: ClipKind::Video,
            name: id.into(),
            media: Some("m".into()),
            start_us: start,
            duration_us: duration,
            source_start_us: source,
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
            effects: vec![],
            transition: None,
            rotation: 0.0,
            speed: 1.0,
            keyframes: Vec::new(),
            mask: None,
        }
    }

    #[test]
    fn sans_transition_rien_ne_bouge() {
        let clips = vec![clip("a", 0, 2_000_000, 0), clip("b", 2_000_000, 2_000_000, 0)];
        let placements = resolve_track(&clips, &[10_000_000, 10_000_000]);
        assert_eq!(placements[0].start_us, 0);
        assert_eq!(placements[1].start_us, 2_000_000);
        assert_eq!(placements[1].dissolve_us, 0);
    }

    #[test]
    fn fondu_simple_ne_deplace_rien() {
        let mut clips = vec![clip("a", 0, 2_000_000, 0), clip("b", 2_000_000, 2_000_000, 0)];
        clips[1].transition = Some(crate::model::Transition {
            kind: TransitionKind::Fade,
            duration_us: 500_000,
        });
        let placements = resolve_track(&clips, &[10_000_000, 10_000_000]);
        assert_eq!(placements[1].start_us, 2_000_000);
        assert_eq!(placements[1].source_start_us, 0);
        assert_eq!(placements[1].fade_in_us, 500_000);
    }

    #[test]
    fn fondu_enchaine_deplace_image_et_source() {
        let mut clips = vec![
            clip("a", 0, 2_000_000, 3_000_000),
            clip("b", 2_000_000, 2_000_000, 3_000_000),
        ];
        clips[1].transition = Some(crate::model::Transition {
            kind: TransitionKind::Dissolve,
            duration_us: 500_000,
        });
        // Les deux médias ont 10 s : marge avant = 3 s, marge après = 5 s.
        let placements = resolve_track(&clips, &[10_000_000, 10_000_000]);
        assert_eq!(placements[1].start_us, 1_500_000);
        assert_eq!(placements[1].source_start_us, 2_500_000);
        assert_eq!(placements[1].duration_us, 2_500_000);
        assert_eq!(placements[1].end_us(), 4_000_000);
        assert_eq!(placements[1].dissolve_us, 500_000);
        assert_eq!(placements[1].fade_in_us, 500_000);
        // L'écart de fenêtre et l'écart de source sont identiques : A/V synchro.
        assert_eq!(
            placements[1].start_us - clips[1].start_us,
            placements[1].source_start_us - clips[1].source_start_us
        );
    }

    #[test]
    fn marge_absente_retombe_sur_un_fondu() {
        let mut clips = vec![clip("a", 0, 2_000_000, 0), clip("b", 2_000_000, 2_000_000, 0)];
        clips[1].transition = Some(crate::model::Transition {
            kind: TransitionKind::Dissolve,
            duration_us: 500_000,
        });
        let placements = resolve_track(&clips, &[10_000_000, 10_000_000]);
        assert_eq!(placements[1].start_us, 2_000_000);
        assert_eq!(placements[1].source_start_us, 0);
        assert_eq!(placements[1].dissolve_us, 0);
        assert_eq!(placements[1].fade_in_us, 500_000);
    }

    #[test]
    fn marge_apres_limitee_par_le_media() {
        let mut clips = vec![
            clip("a", 0, 5_900_000, 0),
            clip("b", 5_900_000, 2_000_000, 4_000_000),
        ];
        clips[1].transition = Some(crate::model::Transition {
            kind: TransitionKind::Dissolve,
            duration_us: 800_000,
        });
        // a : 6 s de média pour 5,9 s utilisées → 0,1 s de marge après.
        let placements = resolve_track(&clips, &[6_000_000, 10_000_000]);
        assert_eq!(placements[1].dissolve_us, 100_000);
        assert_eq!(placements[1].start_us, 5_800_000);
        assert_eq!(placements[1].source_start_us, 3_900_000);
        assert_eq!(placements[1].duration_us, 2_100_000);
        assert_eq!(placements[1].end_us(), 7_900_000);
    }

    #[test]
    fn clips_non_adjacents_ne_sont_pas_rapproches() {
        let mut clips = vec![
            clip("a", 0, 1_000_000, 3_000_000),
            clip("b", 5_000_000, 2_000_000, 3_000_000),
        ];
        clips[1].transition = Some(crate::model::Transition {
            kind: TransitionKind::Dissolve,
            duration_us: 500_000,
        });
        let placements = resolve_track(&clips, &[10_000_000, 10_000_000]);
        assert_eq!(placements[1].start_us, 5_000_000);
        assert_eq!(placements[1].dissolve_us, 0);
    }

    #[test]
    fn ordre_du_projet_preserve() {
        let project = Project {
            version: 1,
            name: "t".into(),
            width: 1280,
            height: 720,
            fps: Fps::new(30, 1),
            background: "#000000".into(),
            media: vec![media("m", 10_000_000)],
            tracks: vec![Track {
                id: "v1".into(),
                kind: TrackKind::Video,
                name: "V".into(),
                muted: false,
                volume: 1.0,
                // Volontairement dans le désordre.
                clips: vec![clip("b", 2_000_000, 2_000_000, 3_000_000), clip("a", 0, 2_000_000, 3_000_000)],
            }],
            export: ExportSettings::default(),
        };
        let placements = resolve_project(&project);
        assert_eq!(placements[0][0].start_us, 2_000_000);
        assert_eq!(placements[0][1].start_us, 0);
    }
}
