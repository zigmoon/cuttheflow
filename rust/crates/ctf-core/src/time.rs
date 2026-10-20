//! Temps, cadences et conversions — sans aucune perte d'arrondi cumulée.

use serde::{Deserialize, Serialize};

/// Temps de timeline, en microsecondes.
pub type Micros = i64;

/// Fréquence d'échantillonnage du mixage audio (identique aux moteurs web).
pub const AUDIO_SAMPLE_RATE: u32 = 48_000;
/// Nombre de canaux du mixage (stéréo).
pub const AUDIO_CHANNELS: u32 = 2;

const US_PER_SEC: i64 = 1_000_000;

/// Cadence rationnelle. `Fps::new(30, 1)` = 30 i/s ; `Fps::new(30_000, 1001)` = 29,97.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fps {
    pub num: u32,
    pub den: u32,
}

impl Default for Fps {
    fn default() -> Self {
        Self { num: 30, den: 1 }
    }
}

impl Fps {
    pub const fn new(num: u32, den: u32) -> Self {
        Self { num, den }
    }

    /// Valide la cadence (numérateur non nul, dénominateur non nul, plage usuelle).
    pub fn validate(self) -> Result<Self, String> {
        if self.num == 0 || self.den == 0 {
            return Err("cadence invalide : numérateur et dénominateur doivent être non nuls".into());
        }
        if self.den > 1001 {
            return Err(format!("cadence invalide : {}/{}", self.num, self.den));
        }
        let value = self.as_f64();
        if !(1.0..=240.0).contains(&value) {
            return Err(format!("cadence hors limites : {value:.3} i/s"));
        }
        Ok(self)
    }

    pub fn as_f64(self) -> f64 {
        self.num as f64 / self.den as f64
    }

    /// Représentation ffmpeg (`30000/1001`).
    pub fn as_ratio(self) -> String {
        format!("{}/{}", self.num, self.den)
    }

    /// Durée d'une image en microsecondes (flottante : 33333,33… à 30 i/s).
    pub fn frame_duration_us(self) -> f64 {
        US_PER_SEC as f64 * self.den as f64 / self.num as f64
    }

    /// Index de l'image qui contient `us` (arrondi vers le bas, jamais négatif).
    pub fn frame_index_at(self, us: Micros) -> i64 {
        if us <= 0 {
            return 0;
        }
        ((us as i128 * self.num as i128) / (self.den as i128 * US_PER_SEC as i128)) as i64
    }

    /// Début de l'image `index`, arrondi au microsecond près.
    pub fn frame_start_us(self, index: i64) -> Micros {
        if index <= 0 {
            return 0;
        }
        (index as i128 * self.den as i128 * US_PER_SEC as i128 / self.num as i128) as Micros
    }

    /// Nombre d'images nécessaires pour couvrir `duration_us` (arrondi supérieur).
    pub fn frame_count(self, duration_us: Micros) -> i64 {
        if duration_us <= 0 {
            return 0;
        }
        let num = duration_us as i128 * self.num as i128;
        let den = self.den as i128 * US_PER_SEC as i128;
        ((num + den - 1) / den) as i64
    }
}

/// Convertit un temps de timeline en échantillons à 48 kHz (arrondi au plus proche).
pub fn us_to_samples(us: Micros) -> i64 {
    if us <= 0 {
        return 0;
    }
    ((us as i128 * AUDIO_SAMPLE_RATE as i128 + US_PER_SEC as i128 / 2) / US_PER_SEC as i128) as i64
}

/// Convertit un nombre d'échantillons à 48 kHz en microsecondes (arrondi au plus proche).
pub fn samples_to_us(samples: i64) -> Micros {
    if samples <= 0 {
        return 0;
    }
    ((samples as i128 * US_PER_SEC as i128 + AUDIO_SAMPLE_RATE as i128 / 2)
        / AUDIO_SAMPLE_RATE as i128) as Micros
}

/// Formate un temps pour ffmpeg : secondes avec 6 décimales (précision µs).
pub fn secs(us: Micros) -> String {
    format!("{:.6}", us as f64 / US_PER_SEC as f64)
}

/// Formate un temps pour l'affichage utilisateur (`01:02.345`).
pub fn format_timecode(us: Micros) -> String {
    let clamped = us.max(0);
    let total_ms = (clamped + 500) / 1000;
    let ms = total_ms % 1000;
    let total_s = total_ms / 1000;
    let s = total_s % 60;
    let m = (total_s / 60) % 60;
    let h = total_s / 3600;
    if h > 0 {
        format!("{h:02}:{m:02}:{s:02}.{ms:03}")
    } else {
        format!("{m:02}:{s:02}.{ms:03}")
    }
}

/// Durée d'une image en microsecondes pour une cadence donnée, arrondie.
pub fn frame_duration_us_rounded(fps: Fps) -> Micros {
    (fps.frame_duration_us()).round() as Micros
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cadence_30_images() {
        let fps = Fps::new(30, 1);
        assert_eq!(fps.frame_count(13_000_000), 390);
        assert_eq!(fps.frame_start_us(390), 13_000_000);
        assert_eq!(fps.frame_index_at(12_999_999), 389);
        assert_eq!(fps.frame_index_at(13_000_000), 390);
    }

    #[test]
    fn cadence_2997_ne_derive_pas() {
        let fps = Fps::new(30_000, 1001);
        let total = 600_000_000; // 10 minutes
        let frames = fps.frame_count(total);
        let last = fps.frame_start_us(frames - 1);
        assert!(last <= total);
        assert!(total - last <= 34_000);
    }

    #[test]
    fn echantillons_aller_retour() {
        assert_eq!(us_to_samples(1_000_000), 48_000);
        assert_eq!(us_to_samples(13_000_000), 624_000);
        assert_eq!(samples_to_us(48_000), 1_000_000);
    }

    #[test]
    fn duree_image_30() {
        let fps = Fps::new(30, 1);
        assert!((fps.frame_duration_us() - 33_333.333).abs() < 0.01);
        assert_eq!(frame_duration_us_rounded(fps), 33_333);
    }

    #[test]
    fn timecode() {
        assert_eq!(format_timecode(0), "00:00.000");
        assert_eq!(format_timecode(61_500_000), "01:01.500");
        assert_eq!(format_timecode(3_661_000_000), "01:01:01.000");
    }
}
