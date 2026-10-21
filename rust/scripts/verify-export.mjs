#!/usr/bin/env node
/**
 * Banc de régression de la version Rust.
 * =====================================
 *
 * Il rejoue EXACTEMENT le montage du banc de la v1 (`tools/regression`) :
 *
 *   VIDEO 3 : a.mp4 0→6 s · img.png 6→9 s · b.mp4 9→13 s
 *   VIDEO 1 : texte « TITRE » 6,5→8,5 s
 *   AUDIO   : music.wav 0→13 s · beep.wav 6→9 s
 *
 * puis vérifie les fichiers produits avec ffmpeg/ffprobe :
 *   • nombre d'images et durée ;
 *   • synchronisation son/image par fréquences repères (880/1500/1200 Hz) ;
 *   • aucune image noire aux coupes ;
 *   • présence du texte blanc et de l'image magenta ;
 *   • fidélité image par image de la première séquence vs a.mp4 ;
 *   • cohérence des trois formats entre eux (MP4 / WebM / MP3).
 *
 * Usage :
 *   node verify-export.mjs --bin ../target/release/cuttheflow --media ../v1/tools/regression/media
 *   node verify-export.mjs --bin ... --quick        (MP4 seul)
 *
 * Sortie : code 0 seulement si toutes les vérifications passent.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const QUICK = args.includes('--quick');
const BIN = path.resolve(argValue('bin', path.join(SCRIPT_DIR, '..', 'target', 'release', process.platform === 'win32' ? 'cuttheflow.exe' : 'cuttheflow')));
// Les médias du banc v1 vivent dans `v1/tools/regression/media` depuis que
// l'éditeur navigateur a rejoint ce dépôt ; l'ancien emplacement reste accepté
// pour ne pas casser un clone de transition.
const MEDIA = path.resolve(
  argValue(
    'media',
    (() => {
      const repo = path.join(SCRIPT_DIR, '..', '..');
      const candidates = [
        path.join(repo, 'v1', 'tools', 'regression', 'media'),
        path.join(repo, 'tools', 'regression', 'media'),
      ];
      return candidates.find((dir) => existsSync(dir)) ?? candidates[1];
    })(),
  ),
);
const OUT = path.resolve(argValue('out', path.join(SCRIPT_DIR, '..', 'target', 'verify')));
const FORMATS = QUICK ? ['mp4'] : (argValue('formats', 'mp4,webm,mp3').split(','));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`   ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ───────────────────────────── ffmpeg ─────────────────────────────
function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { encoding: 'utf8', maxBuffer: 1 << 30, ...options });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  return result;
}

function probe(file) {
  const result = run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (result.status !== 0) throw new Error(`ffprobe ${file}: ${result.stderr.slice(0, 300)}`);
  return JSON.parse(result.stdout);
}

function countFrames(file) {
  const result = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'default=nw=1:nk=1', file]);
  return result.status === 0 ? Number(result.stdout.trim()) || 0 : 0;
}

function mediaSummary(file) {
  const json = probe(file);
  const video = json.streams.find((s) => s.codec_type === 'video');
  const audio = json.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(json.format.duration || 0);
  return {
    duration,
    frames: video ? Number(video.nb_frames || 0) || countFrames(file) : 0,
    width: video?.width || 0,
    height: video?.height || 0,
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    // WebM n'écrit pas de durée par piste : la durée du conteneur fait foi.
    audioDuration: audio ? Number(audio.duration || 0) || duration : 0,
    sampleRate: audio ? Number(audio.sample_rate || 0) : 0,
  };
}

function decodePcm(file, sampleRate = 48000) {
  const result = run(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'], { encoding: 'buffer' });
  if (result.status !== 0) throw new Error(`ffmpeg decode ${file}: ${result.stderr.toString().slice(0, 300)}`);
  const buffer = result.stdout;
  const samples = new Float32Array(buffer.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768;
  return samples;
}

function goertzel(samples, offset, length, sampleRate, frequency) {
  const k = Math.round((length * frequency) / sampleRate);
  const w = (2 * Math.PI * k) / length;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < length; i++) {
    s0 = samples[offset + i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / length;
}

/** Plages où une fréquence repère est présente (Goertzel par fenêtres de 20 ms). */
function freqRanges(samples, sampleRate, frequency, ratio = 0.25, windowSeconds = 0.02) {
  const window = Math.round(windowSeconds * sampleRate);
  const magnitudes = [];
  for (let offset = 0; offset + window <= samples.length; offset += window) {
    magnitudes.push({ t: offset / sampleRate, m: goertzel(samples, offset, window, sampleRate, frequency) });
  }
  if (!magnitudes.length) return [];
  const peak = Math.max(...magnitudes.map((x) => x.m));
  const threshold = peak * ratio;
  const ranges = [];
  let start = null;
  for (const point of magnitudes) {
    const on = point.m >= threshold;
    if (on && start === null) start = point.t;
    else if (!on && start !== null) {
      if (point.t - start > 0.15) ranges.push([start, point.t]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, magnitudes[magnitudes.length - 1].t]);
  return ranges;
}

const nearest = (ranges, expected) => {
  if (!ranges.length) return null;
  return ranges.reduce((best, range) => Math.abs(range[0] - expected) < Math.abs(best[0] - expected) ? range : best);
};

const maxLuma = (file, time, crop) => {
  const filters = (crop ? `crop=${crop},` : '') + 'format=gray';
  const result = run(FFMPEG, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', filters, '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  if (!result.stdout.length) return -1;
  let max = 0;
  for (const value of result.stdout) max = Math.max(max, value);
  return max;
};

const meanLuma = (file, time) => {
  const result = run(FFMPEG, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  return result.stdout.length ? result.stdout[0] : -1;
};

const pixelAt = (file, time, x, y) => {
  const result = run(FFMPEG, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  if (result.stdout.length < 3) return null;
  return [result.stdout[0], result.stdout[1], result.stdout[2]];
};

function frameGraySequence(file, start, duration) {
  const result = run(FFMPEG, ['-v', 'error', '-ss', String(start), '-i', file, '-t', String(duration), '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  return Array.from(result.stdout);
}

// ───────────────────────────── Montage ─────────────────────────────
function buildProject() {
  const known = {
    'a.mp4': { id: 'm1', kind: 'video' },
    'b.mp4': { id: 'm2', kind: 'video' },
    'img.png': { id: 'm3', kind: 'image' },
    'music.wav': { id: 'm4', kind: 'audio' },
    'beep.wav': { id: 'm5', kind: 'audio' },
  };
  const media = [];
  for (const [name, meta] of Object.entries(known)) {
    const file = path.join(MEDIA, name);
    const result = run(BIN, ['probe', file]);
    if (result.status !== 0) throw new Error(`probe ${name}: ${result.stderr}`);
    const info = JSON.parse(result.stdout);
    media.push({ ...info, id: meta.id, kind: meta.kind, path: file });
  }
  return {
    version: 1,
    name: 'Banc de régression Rust',
    width: 1280,
    height: 720,
    fps: { num: 30, den: 1 },
    background: '#000000',
    media,
    tracks: [
      {
        id: 'v1', kind: 'video', name: 'VIDEO 1', volume: 1,
        clips: [{
          id: 't1', type: 'text', name: 'TITRE', start_us: 6_500_000, duration_us: 2_000_000,
          volume: 1, scale: 1, x: 0.5, y: 0.5, opacity: 1,
          text: { content: 'TITRE', size: 140, color: '#FFFFFF' },
        }],
      },
      {
        id: 'v3', kind: 'video', name: 'VIDEO 3', volume: 1,
        clips: [
          { id: 'c1', type: 'video', media: 'm1', start_us: 0, duration_us: 6_000_000, volume: 1, scale: 1, x: 0.5, y: 0.5, opacity: 1 },
          { id: 'c2', type: 'image', media: 'm3', start_us: 6_000_000, duration_us: 3_000_000, volume: 1, scale: 1, x: 0.5, y: 0.5, opacity: 1 },
          { id: 'c3', type: 'video', media: 'm2', start_us: 9_000_000, duration_us: 4_000_000, volume: 1, scale: 1, x: 0.5, y: 0.5, opacity: 1 },
        ],
      },
      {
        id: 'a1', kind: 'audio', name: 'AUDIO 1', volume: 1,
        clips: [
          { id: 'a1c', type: 'audio', media: 'm4', start_us: 0, duration_us: 13_000_000, volume: 1 },
          { id: 'a2c', type: 'audio', media: 'm5', start_us: 6_000_000, duration_us: 3_000_000, volume: 1 },
        ],
      },
    ],
    export: { format: 'mp4', crf: 18, preset: 'medium' },
  };
}

function exportFormat(projectFile, format, output) {
  const crf = format === 'webm' ? '30' : '18';
  const result = run(BIN, ['export', projectFile, '--out', output, '--format', format, '--crf', crf], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`export ${format}: ${result.stderr.slice(-800)}`);
  return JSON.parse(result.stdout);
}

// ───────────────────────────── Vérifications ─────────────────────────────
const EXPECTED_FRAMES = 390;
const EXPECTED_DURATION = 13.0;
const MARKERS = [
  { frequency: 880, start: 2, end: 4, label: 'a.mp4 (880 Hz)' },
  { frequency: 1500, start: 6, end: 9, label: 'beep.wav (1500 Hz)' },
  { frequency: 1200, start: 9, end: 13, label: 'b.mp4 (1200 Hz)' },
];

function verifyAudio(label, file, reference) {
  const samples = decodePcm(file);
  const rangesByFrequency = new Map();
  for (const marker of MARKERS) {
    const ranges = freqRanges(samples, 48000, marker.frequency);
    rangesByFrequency.set(marker.frequency, ranges);
    const range = nearest(ranges, marker.start);
    if (!range) {
      check(`${label} : ${marker.label} présent`, false, 'aucune plage détectée');
      continue;
    }
    check(
      `${label} : ${marker.label} commence à ${marker.start} s (±40 ms)`,
      Math.abs(range[0] - marker.start) <= 0.04,
      `${range[0].toFixed(3)} s`,
    );
    if (marker.end < 13) {
      check(
        `${label} : ${marker.label} finit à ${marker.end} s (±40 ms)`,
        Math.abs(range[1] - marker.end) <= 0.04,
        `${range[1].toFixed(3)} s`,
      );
    }
    if (reference) {
      const expected = reference.get(marker.frequency);
      const referenceRange = expected && nearest(expected, marker.start);
      if (referenceRange) {
        const delta = Math.round((range[0] - referenceRange[0]) * 1000);
        check(`${label} : ${marker.label} aligné sur le MP4 (±20 ms)`, Math.abs(delta) <= 20, `${delta} ms`);
      }
    }
  }
  return rangesByFrequency;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`Binaire : ${BIN}`);
  console.log(`Médias  : ${MEDIA}`);
  console.log(`Sortie  : ${OUT}\n`);

  const project = buildProject();
  const projectFile = path.join(OUT, 'project.json');
  writeFileSync(projectFile, JSON.stringify(project, null, 2));

  const outputs = {};
  for (const format of FORMATS) {
    console.log(`▶ Export ${format.toUpperCase()}…`);
    const file = path.join(OUT, `montage.${format}`);
    const result = exportFormat(projectFile, format, file);
    outputs[format] = { file, result };
    console.log(`   ${(result.size_bytes / 1024 / 1024).toFixed(2)} Mo · ${result.elapsed_ms} ms · ${result.frames} images`);
  }

  const videoFormats = FORMATS.filter((format) => format === 'mp4' || format === 'webm');

  for (const format of videoFormats) {
    const { file } = outputs[format];
    const label = format.toUpperCase();
    console.log(`\n▶ Analyse ${label}`);
    const summary = mediaSummary(file);

    check(`${label} : ${EXPECTED_FRAMES} images`, summary.frames === EXPECTED_FRAMES, `${summary.frames}`);
    check(`${label} : durée ≈ 13 s`, Math.abs(summary.duration - EXPECTED_DURATION) <= 0.1, `${summary.duration.toFixed(3)} s`);
    check(`${label} : 1280×720`, summary.width === 1280 && summary.height === 720, `${summary.width}×${summary.height}`);
    check(`${label} : codec vidéo attendu`, format === 'mp4' ? summary.videoCodec === 'h264' : summary.videoCodec === 'vp9', `${summary.videoCodec}`);
    check(`${label} : codec audio attendu`, format === 'mp4' ? summary.audioCodec === 'aac' : summary.audioCodec === 'opus', `${summary.audioCodec}`);
    check(`${label} : audio 48 kHz`, summary.sampleRate === 48000, `${summary.sampleRate}`);
    check(`${label} : durée audio ≈ 13 s`, Math.abs(summary.audioDuration - EXPECTED_DURATION) <= 0.15, `${summary.audioDuration.toFixed(3)} s`);

    const luminances = [5.9, 6.0, 8.9, 9.0].map((t) => ({ t, luma: meanLuma(file, t) }));
    const minLuma = Math.min(...luminances.map((x) => x.luma));
    check(`${label} : aucune image noire aux coupes`, minLuma >= 20, `min ${minLuma}/255`);

    const center = maxLuma(file, 7.5, 'iw*0.6:ih*0.3');
    const outside = maxLuma(file, 6.1, 'iw*0.6:ih*0.3');
    check(`${label} : texte blanc visible à 7,5 s`, center >= 200 && center > outside + 40, `${center}/255 vs ${outside}/255`);

    const magenta = pixelAt(file, 7.0, 40, 40);
    if (magenta) {
      check(`${label} : image magenta affichée (6–9 s)`, magenta[0] > 100 && magenta[2] > 60 && magenta[1] < 60, `[${magenta.join(',')}]`);
    }

    const reference = frameGraySequence(path.join(MEDIA, 'a.mp4'), 0, 5.9);
    const produced = frameGraySequence(file, 0, 5.9);
    const common = Math.min(reference.length, produced.length);
    let worst = 0;
    let differences = 0;
    for (let i = 0; i < common; i++) {
      const delta = Math.abs(reference[i] - produced[i]);
      worst = Math.max(worst, delta);
      if (delta > 2) differences++;
    }
    check(
      `${label} : séquence identique à a.mp4 (écart ≤ 2/255)`,
      differences === 0 && common >= 170,
      `${differences} image(s) différente(s) sur ${common} (écart max ${worst})`,
    );
  }

  let referenceRanges = null;
  if (outputs.mp4) {
    console.log('\n▶ Analyse audio MP4');
    referenceRanges = verifyAudio('MP4', outputs.mp4.file, null);
  }
  for (const format of FORMATS.filter((value) => value !== 'mp4')) {
    console.log(`\n▶ Analyse audio ${format.toUpperCase()}`);
    verifyAudio(format.toUpperCase(), outputs[format].file, referenceRanges);
  }
  if (outputs.mp3) {
    const summary = mediaSummary(outputs.mp3.file);
    check('MP3 : audio 48 kHz', summary.sampleRate === 48000, `${summary.sampleRate}`);
    check('MP3 : durée ≈ 13 s', Math.abs(summary.duration - EXPECTED_DURATION) <= 0.15, `${summary.duration.toFixed(3)} s`);
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n══════════════ BILAN ══════════════`);
  console.log(`${passed}/${results.length} vérifications réussies`);
  if (passed !== results.length) {
    console.log('\nÉchecs :');
    for (const result of results.filter((item) => !item.ok)) {
      console.log(`  ❌ ${result.name} — ${result.detail}`);
    }
    process.exit(1);
  }
  console.log(`Rapport écrit dans ${path.join(OUT, 'report.json')}`);
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.result])) }, null, 2));
}

main();
