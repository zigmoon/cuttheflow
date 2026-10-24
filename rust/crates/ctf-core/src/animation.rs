//! Animation par keyframes, traduite en expressions ffmpeg.
//!
//! Le rendu navigateur évalue les clés image par image dans `valueAt()`
//! (`astro/src/scripts/state.ts`). Le moteur doit produire **exactement** la même
//! courbe, sinon un projet changerait d'aspect selon le moteur qui l'exporte.
//! Ce module reproduit donc la même règle, mais sous forme d'expression lue par
//! ffmpeg à chaque image.
//!
//! Trois règles à ne pas perdre de vue :
//! * `time_us` est **local au clip** (0 = début de la fenêtre) ;
//! * hors de la plage des clés, on tient la première / dernière valeur, sans
//!   extrapolation ;
//! * à instant égal, la dernière clé écrite gagne (comme la `Map` de `state.ts`).

use crate::model::Clip;
use crate::time::Micros;

/// Propriétés animables. Toute autre valeur est ignorée silencieusement.
pub const ANIMATED_PROPS: [&str; 6] = ["opacity", "scale", "x", "y", "rotation", "volume"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Easing {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
}

#[derive(Debug, Clone, Copy)]
pub struct Key {
    pub time_us: Micros,
    pub value: f64,
    pub easing: Easing,
}

fn parse_easing(value: Option<&serde_json::Value>) -> Easing {
    match value.and_then(|v| v.as_str()).unwrap_or("linear") {
        "ease-in" => Easing::EaseIn,
        "ease-out" => Easing::EaseOut,
        "ease-in-out" => Easing::EaseInOut,
        _ => Easing::Linear,
    }
}

/// Clés d'une propriété, triées et dédoublonnées par instant (la dernière gagne).
pub fn keys_for(clip: &Clip, prop: &str) -> Vec<Key> {
    let mut keys: Vec<Key> = clip
        .keyframes
        .iter()
        .filter(|value| value.get("prop").and_then(|p| p.as_str()) == Some(prop))
        .filter_map(|value| {
            Some(Key {
                time_us: value.get("time_us")?.as_i64()?,
                value: value.get("value")?.as_f64()?,
                easing: parse_easing(value.get("easing")),
            })
        })
        .collect();

    if keys.len() < 2 {
        return keys;
    }
    // Dédoublonnage par instant arrondi, la dernière clé écrite gagne.
    keys.reverse();
    let mut seen: Vec<Micros> = Vec::new();
    keys.retain(|key| {
        let at = key.time_us;
        if seen.contains(&at) {
            false
        } else {
            seen.push(at);
            true
        }
    });
    keys.reverse();
    keys.sort_by_key(|key| key.time_us);
    keys
}

pub fn has_keyframes(clip: &Clip, prop: &str) -> bool {
    !keys_for(clip, prop).is_empty()
}

fn ease_expression(ratio: &str, easing: Easing) -> String {
    match easing {
        Easing::Linear => format!("({ratio})"),
        Easing::EaseIn => format!("({ratio})*({ratio})"),
        Easing::EaseOut => format!("1-(1-({ratio}))*(1-({ratio}))"),
        Easing::EaseInOut => format!(
            "if(lt(({ratio}),0.5),2*({ratio})*({ratio}),1-pow(-2*({ratio})+2,2)/2)"
        ),
    }
}

/// Expression ffmpeg de la propriété, dans la variable `time_var` (secondes).
///
/// Renvoie `None` quand la propriété n'a aucune clé : l'appelant garde alors la
/// valeur statique du clip, qui est exactement ce que ferait `valueAt`.
pub fn expression(clip: &Clip, prop: &str, time_var: &str) -> Option<String> {
    let keys = keys_for(clip, prop);
    if keys.is_empty() {
        return None;
    }
    if keys.len() == 1 {
        return Some(format!("{:.6}", keys[0].value));
    }

    let t = time_var;
    let mut acc = format!("{:.6}", keys[keys.len() - 1].value);
    for index in (0..keys.len() - 1).rev() {
        let from = keys[index];
        let to = keys[index + 1];
        let ta = from.time_us as f64 / 1_000_000.0;
        let tb = to.time_us as f64 / 1_000_000.0;
        // Instant identique : aucun intervalle à interpoler (évite une division
        // par zéro, que ffmpeg transformerait en image noire).
        if (tb - ta).abs() < 1e-9 {
            continue;
        }
        let ratio = format!("clip(({t}-{ta:.6})/{:.6},0,1)", tb - ta);
        let eased = ease_expression(&ratio, from.easing);
        let segment = format!("{:.6}+({:.6}-{:.6})*{eased}", from.value, to.value, from.value);
        acc = format!("if(lt({t},{tb:.6}),{segment},({acc}))");
    }
    let first = keys[0];
    let t0 = first.time_us as f64 / 1_000_000.0;
    Some(format!("if(lte({t},{t0:.6}),{:.6},({acc}))", first.value))
}

/// Valeur à un instant local, sans passer par ffmpeg (tests et diagnostics).
pub fn value_at(clip: &Clip, prop: &str, local_us: Micros) -> f64 {
    let keys = keys_for(clip, prop);
    if keys.is_empty() {
        return 0.0;
    }
    if local_us <= keys[0].time_us {
        return keys[0].value;
    }
    let last = keys[keys.len() - 1];
    if local_us >= last.time_us {
        return last.value;
    }
    for index in 0..keys.len() - 1 {
        let from = keys[index];
        let to = keys[index + 1];
        if local_us >= from.time_us && local_us <= to.time_us {
            let span = (to.time_us - from.time_us) as f64;
            let ratio = if span > 0.0 {
                (local_us - from.time_us) as f64 / span
            } else {
                0.0
            };
            let eased = match from.easing {
                Easing::Linear => ratio,
                Easing::EaseIn => ratio * ratio,
                Easing::EaseOut => 1.0 - (1.0 - ratio) * (1.0 - ratio),
                Easing::EaseInOut => {
                    if ratio < 0.5 {
                        2.0 * ratio * ratio
                    } else {
                        1.0 - ((-2.0 * ratio + 2.0).powi(2)) / 2.0
                    }
                }
            };
            return from.value + (to.value - from.value) * eased;
        }
    }
    last.value
}

/// Extrêmes d'une propriété sur ses clés (pour dimensionner une boîte englobante).
pub fn range(clip: &Clip, prop: &str) -> Option<(f64, f64)> {
    let keys = keys_for(clip, prop);
    if keys.is_empty() {
        return None;
    }
    let mut low = f64::MAX;
    let mut high = f64::MIN;
    for key in &keys {
        low = low.min(key.value);
        high = high.max(key.value);
    }
    Some((low, high))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Clip, ClipKind};

    fn clip_with(keys: &str) -> Clip {
        let mut clip = Clip {
            id: "c1".into(),
            kind: ClipKind::Video,
            name: "c1".into(),
            media: Some("m1".into()),
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
        };
        clip.keyframes = serde_json::from_str(&format!("[{keys}]")).unwrap();
        clip
    }

    #[test]
    fn sans_cle_pas_d_expression() {
        let clip = clip_with("");
        assert!(expression(&clip, "opacity", "t").is_none());
        assert!(!has_keyframes(&clip, "opacity"));
    }

    #[test]
    fn une_seule_cle_donne_une_constante() {
        let clip = clip_with(r#"{"prop":"opacity","time_us":0,"value":0.25}"#);
        assert_eq!(expression(&clip, "opacity", "t").unwrap(), "0.250000");
        assert_eq!(value_at(&clip, "opacity", 999_999), 0.25);
    }

    #[test]
    fn interpolation_identique_au_rendu_navigateur() {
        // 1 -> 0 sur 2 s, linéaire : mêmes valeurs que `valueAt` côté TypeScript.
        let clip = clip_with(
            r#"{"prop":"opacity","time_us":0,"value":1,"easing":"linear"},
               {"prop":"opacity","time_us":2000000,"value":0,"easing":"linear"}"#,
        );
        assert!((value_at(&clip, "opacity", 0) - 1.0).abs() < 1e-9);
        assert!((value_at(&clip, "opacity", 1_000_000) - 0.5).abs() < 1e-9);
        assert!((value_at(&clip, "opacity", 2_000_000) - 0.0).abs() < 1e-9);
        // Hors plage : on tient la valeur, on n'extrapole pas.
        assert!((value_at(&clip, "opacity", 5_000_000) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn courbes_d_assouplissement() {
        let clip = clip_with(
            r#"{"prop":"scale","time_us":0,"value":1,"easing":"ease-in"},
               {"prop":"scale","time_us":1000000,"value":2,"easing":"ease-in"}"#,
        );
        // ease-in = x*x : à mi-course (0.5) on est à 1 + 1*0.25 = 1.25
        assert!((value_at(&clip, "scale", 500_000) - 1.25).abs() < 1e-9);

        let out = clip_with(
            r#"{"prop":"scale","time_us":0,"value":1,"easing":"ease-out"},
               {"prop":"scale","time_us":1000000,"value":2,"easing":"ease-out"}"#,
        );
        // ease-out = 1-(1-x)^2 : à mi-course 0.75 -> 1.75
        assert!((value_at(&out, "scale", 500_000) - 1.75).abs() < 1e-9);
    }

    #[test]
    fn dedoublonnage_la_derniere_cle_gagne() {
        let clip = clip_with(
            r#"{"prop":"opacity","time_us":0,"value":0.2},
               {"prop":"opacity","time_us":0,"value":0.8},
               {"prop":"opacity","time_us":1000000,"value":0}"#,
        );
        let keys = keys_for(&clip, "opacity");
        assert_eq!(keys.len(), 2);
        assert!((keys[0].value - 0.8).abs() < 1e-9);
    }

    #[test]
    fn proprietes_ignorees() {
        let clip = clip_with(r#"{"prop":"inconnue","time_us":0,"value":1}"#);
        assert!(!has_keyframes(&clip, "opacity"));
        assert!(range(&clip, "opacity").is_none());
    }

    #[test]
    fn plage_pour_boite_englobante() {
        let clip = clip_with(
            r#"{"prop":"rotation","time_us":0,"value":-30},
               {"prop":"rotation","time_us":1000000,"value":45}"#,
        );
        let (low, high) = range(&clip, "rotation").unwrap();
        assert!((low + 30.0).abs() < 1e-9);
        assert!((high - 45.0).abs() < 1e-9);
    }
}
