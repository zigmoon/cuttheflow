//! Sondage ffprobe — transforme le JSON de `ffprobe` en `Media`.
//!
//! Le parseur est volontairement tolérant : selon les conteneurs, la durée est
//! dans `format.duration`, dans la piste vidéo ou dans la piste audio, et la
//! cadence peut être `avg_frame_rate` ou `r_frame_rate`. Une valeur `N/A` ne
//! doit jamais faire échouer un import.

use serde_json::Value;

use crate::model::{Media, MediaKind};
use crate::time::{Fps, Micros};

const IMAGE_CODECS: &[&str] = &[
    "png", "mjpeg", "jpeg", "bmp", "webp", "gif", "tiff", "tif", "avif", "heic",
];

/// Analyse la sortie de `ffprobe -print_format json -show_format -show_streams`.
pub fn parse_probe(json: &str, id: &str, name: &str, path: &str, size_bytes: u64) -> Result<Media, String> {
    let root: Value = serde_json::from_str(json).map_err(|e| format!("ffprobe : JSON illisible ({e})"))?;

    let streams = root
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| "ffprobe : aucune piste dans la réponse".to_string())?;

    let format = root.get("format");
    let format_name = format
        .and_then(|f| f.get("format_name"))
        .and_then(Value::as_str)
        .unwrap_or("");

    let video_stream = streams.iter().find(|s| {
        s.get("codec_type").and_then(Value::as_str) == Some("video")
            && s.pointer("/disposition/attached_pic").and_then(Value::as_i64) != Some(1)
    });
    let audio_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio"));

    let is_image = match video_stream {
        Some(stream) => {
            let codec = stream.get("codec_name").and_then(Value::as_str).unwrap_or("");
            IMAGE_CODECS.contains(&codec)
                && (format_name.contains("image2")
                    || format_name.contains("_pipe")
                    || stream.get("nb_frames").and_then(Value::as_str) == Some("1")
                    || audio_stream.is_none() && duration_seconds(&root).unwrap_or(0.0) <= 0.0)
        }
        None => false,
    };

    if video_stream.is_none() && audio_stream.is_none() {
        return Err(format!("{name} : aucune piste audio ni vidéo décodable"));
    }

    let (mut width, mut height) = match video_stream {
        Some(s) => (
            number_u32(s.get("width")),
            number_u32(s.get("height")),
        ),
        None => (0, 0),
    };

    // Une vidéo de téléphone est souvent stockée à l'horizontale avec une matrice
    // de rotation. ffmpeg applique cette rotation au décodage : on applique donc
    // la même permutation aux dimensions de planification.
    if rotation_degrees(video_stream) % 180 != 0 && width > 0 && height > 0 {
        std::mem::swap(&mut width, &mut height);
    }

    let fps = video_stream.and_then(|s| {
        s.get("avg_frame_rate")
            .and_then(Value::as_str)
            .and_then(parse_ratio)
            .or_else(|| s.get("r_frame_rate").and_then(Value::as_str).and_then(parse_ratio))
    });

    let duration_us = duration_seconds(&root)
        .map(|s| (s * 1_000_000.0).round() as Micros)
        .filter(|d| *d > 0)
        .unwrap_or(if is_image { 5_000_000 } else { 0 });

    let kind = if is_image {
        MediaKind::Image
    } else if video_stream.is_some() {
        MediaKind::Video
    } else {
        MediaKind::Audio
    };

    let (sample_rate, channels) = match audio_stream {
        Some(s) => (
            number_u32(s.get("sample_rate")),
            number_u32(s.get("channels")),
        ),
        None => (0, 0),
    };

    Ok(Media {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        path: path.to_string(),
        duration_us,
        width,
        height,
        fps,
        has_audio: audio_stream.is_some(),
        sample_rate,
        channels,
        size_bytes,
    })
}

fn duration_seconds(root: &Value) -> Option<f64> {
    if let Some(value) = root.pointer("/format/duration") {
        let parsed = match value {
            Value::String(text) => parse_f64(text),
            other => other.as_f64().filter(|v| v.is_finite() && *v >= 0.0),
        };
        if let Some(parsed) = parsed {
            return Some(parsed);
        }
    }
    for stream in root.get("streams").and_then(Value::as_array)? {
        for key in ["duration", "duration_ts"] {
            if let Some(value) = stream.get(key) {
                let parsed = match value {
                    Value::String(s) => parse_f64(s),
                    other => other.as_f64().filter(|v| v.is_finite() && *v >= 0.0),
                };
                if let Some(parsed) = parsed {
                    if key == "duration_ts" {
                        let tb = stream
                            .get("time_base")
                            .and_then(Value::as_str)
                            .and_then(parse_time_base);
                        if let Some(tb) = tb {
                            return Some(parsed * tb);
                        }
                    } else {
                        return Some(parsed);
                    }
                }
            }
        }
    }
    None
}

fn parse_f64(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
        return None;
    }
    trimmed.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0)
}

fn parse_time_base(value: &str) -> Option<f64> {
    let (num, den) = value.split_once('/')?;
    let num = num.parse::<f64>().ok()?;
    let den = den.parse::<f64>().ok()?;
    if den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

fn parse_ratio(value: &str) -> Option<Fps> {
    if value.trim().is_empty() || value == "0/0" {
        return None;
    }
    let (num, den) = value.split_once('/')?;
    let num = num.parse::<u32>().ok()?;
    let den = den.parse::<u32>().ok()?;
    if num == 0 || den == 0 {
        return None;
    }
    Some(Fps::new(num, den))
}

fn number_u32(value: Option<&Value>) -> u32 {
    match value {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0) as u32,
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn rotation_degrees(video_stream: Option<&Value>) -> i64 {
    if let Some(stream) = video_stream {
        if let Some(list) = stream.get("side_data_list").and_then(Value::as_array) {
            for item in list {
                if let Some(rotation) = item.get("rotation").and_then(Value::as_f64) {
                    return rotation.round() as i64;
                }
            }
        }
        if let Some(rotate) = stream.pointer("/tags/rotate").and_then(Value::as_str) {
            if let Ok(value) = rotate.parse::<f64>() {
                return value.round() as i64;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIDEO_JSON: &str = r#"{
      "streams": [
        {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
         "avg_frame_rate":"30000/1001","r_frame_rate":"30000/1001","duration":"6.006000"},
        {"codec_type":"audio","codec_name":"aac","sample_rate":"48000","channels":2}
      ],
      "format": {"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"6.006000"}
    }"#;

    const AUDIO_JSON: &str = r#"{
      "streams": [{"codec_type":"audio","codec_name":"pcm_s16le","sample_rate":"44100","channels":1}],
      "format": {"format_name":"wav","duration":"N/A"}
    }"#;

    const IMAGE_JSON: &str = r#"{
      "streams": [{"codec_type":"video","codec_name":"png","width":800,"height":600,
                   "avg_frame_rate":"0/0","r_frame_rate":"25/1","nb_frames":"1"}],
      "format": {"format_name":"png_pipe","duration":"N/A"}
    }"#;

    const ROTATED_JSON: &str = r#"{
      "streams": [{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
                   "avg_frame_rate":"30/1","side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]}],
      "format": {"format_name":"mov","duration":"2.0"}
    }"#;

    #[test]
    fn video_297() {
        let media = parse_probe(VIDEO_JSON, "m1", "a.mp4", "/a.mp4", 10).unwrap();
        assert_eq!(media.kind, MediaKind::Video);
        assert_eq!(media.width, 1920);
        assert_eq!(media.height, 1080);
        assert_eq!(media.fps, Some(Fps::new(30_000, 1001)));
        assert!(media.has_audio);
        assert_eq!(media.duration_us, 6_006_000);
    }

    #[test]
    fn audio_sans_duree() {
        let media = parse_probe(AUDIO_JSON, "m2", "a.wav", "/a.wav", 10).unwrap();
        assert_eq!(media.kind, MediaKind::Audio);
        assert_eq!(media.sample_rate, 44_100);
        assert!(media.has_audio);
        assert_eq!(media.duration_us, 0);
    }

    #[test]
    fn image_detectee() {
        let media = parse_probe(IMAGE_JSON, "m3", "a.png", "/a.png", 10).unwrap();
        assert_eq!(media.kind, MediaKind::Image);
        assert_eq!(media.duration_us, 5_000_000);
    }

    #[test]
    fn rotation_permute_les_dimensions() {
        let media = parse_probe(ROTATED_JSON, "m4", "p.mp4", "/p.mp4", 10).unwrap();
        assert_eq!((media.width, media.height), (1080, 1920));
    }

    #[test]
    fn json_invalide() {
        assert!(parse_probe("{}", "x", "x", "/x", 0).is_err());
    }
}
