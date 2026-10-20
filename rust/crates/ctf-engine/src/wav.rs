//! Lecture d'un WAV PCM flottant pour mesurer le pic du mixage.
//!
//! Le mixage est rendu en `pcm_f32le` : aucun écrêtage avant la mesure, donc le
//! gain final est calculé sur le vrai pic du montage. La normalisation applique
//! exactement la même règle que les moteurs de la v1 : on n'augmente jamais le
//! son, on atténue seulement si le pic dépasse 0,99.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Pic absolu du fichier WAV (0.0 = silence, 1.0 = pleine échelle).
pub fn peak_of_wav(path: &Path) -> Result<f64, String> {
    let mut file = File::open(path).map_err(|e| format!("WAV illisible : {e}"))?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header)
        .map_err(|e| format!("WAV tronqué : {e}"))?;
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
        return Err("le mixage audio n'est pas un fichier WAV".into());
    }

    let mut format = None;
    let mut data_offset = None;
    let mut data_size = 0u64;

    loop {
        let mut chunk_header = [0u8; 8];
        if file.read_exact(&mut chunk_header).is_err() {
            break;
        }
        let id = &chunk_header[0..4];
        let size = u32::from_le_bytes([
            chunk_header[4],
            chunk_header[5],
            chunk_header[6],
            chunk_header[7],
        ]) as u64;
        let position = file
            .stream_position()
            .map_err(|e| format!("WAV : position illisible ({e})"))?;

        if id == b"fmt " {
            let mut fmt = vec![0u8; size.min(64) as usize];
            file.read_exact(&mut fmt)
                .map_err(|e| format!("WAV : en-tête fmt illisible ({e})"))?;
            if fmt.len() >= 16 {
                let audio_format = u16::from_le_bytes([fmt[0], fmt[1]]);
                let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
                let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
                format = Some((audio_format, channels, bits));
            }
        } else if id == b"data" {
            data_offset = Some(position);
            data_size = size;
        }

        let skip = size + (size & 1);
        file.seek(SeekFrom::Start(position + skip))
            .map_err(|e| format!("WAV : saut de bloc impossible ({e})"))?;
        if id == b"data" {
            break;
        }
    }

    let (audio_format, channels, bits) =
        format.ok_or_else(|| "WAV : bloc fmt absent".to_string())?;
    let data_offset = data_offset.ok_or_else(|| "WAV : bloc data absent".to_string())?;
    if channels == 0 {
        return Err("WAV : aucun canal".into());
    }

    file.seek(SeekFrom::Start(data_offset))
        .map_err(|e| format!("WAV : accès aux données impossible ({e})"))?;

    let mut peak = 0.0f64;
    if audio_format == 3 && bits == 32 {
        let mut buffer = vec![0u8; 64 * 1024 - (64 * 1024 % 4)];
        let mut remaining = data_size;
        while remaining >= 4 {
            let to_read = (buffer.len() as u64).min(remaining) as usize;
            let read = file.read(&mut buffer[..to_read]).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            for sample in buffer[..read - read % 4].chunks_exact(4) {
                let value = f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]) as f64;
                if value.is_finite() {
                    let magnitude = value.abs();
                    if magnitude > peak {
                        peak = magnitude;
                    }
                }
            }
            remaining -= read as u64;
        }
    } else if audio_format == 1 && bits == 16 {
        let mut buffer = vec![0u8; 64 * 1024];
        let mut remaining = data_size;
        while remaining >= 2 {
            let to_read = (buffer.len() as u64).min(remaining) as usize;
            let read = file.read(&mut buffer[..to_read]).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            for sample in buffer[..read - read % 2].chunks_exact(2) {
                let value = i16::from_le_bytes([sample[0], sample[1]]) as f64 / 32768.0;
                peak = peak.max(value.abs());
            }
            remaining -= read as u64;
        }
    } else {
        return Err(format!(
            "WAV : format {audio_format} / {bits} bits non pris en charge (attendu f32le)"
        ));
    }

    Ok(peak)
}

/// Gain à appliquer : 1.0 s'il n'y a pas d'écrêtage, sinon 0,99 / pic.
pub fn normalization_gain(peak: f64) -> f64 {
    if peak > 0.99 {
        0.99 / peak
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gain_jamais_amplifie() {
        assert_eq!(normalization_gain(0.5), 1.0);
        assert_eq!(normalization_gain(0.99), 1.0);
        assert!((normalization_gain(1.5) - 0.66).abs() < 1e-9);
    }
}
