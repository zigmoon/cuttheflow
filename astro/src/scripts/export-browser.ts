/**
 * Export 100 % navigateur (MP4 / WebM / MP3), sans moteur Rust.
 *
 * Utilisé quand l'application est servie en statique : le fichier produit reste
 * identique d'une machine à l'autre, car tout est calculé — pas de capture
 * temps réel. Le rendu des images vient de `render.ts`, donc l'export encode
 * exactement ce que l'aperçu montre.
 *
 *   vidéo  : WebCodecs VideoEncoder → H.264 (MP4 via mp4box.js) ou VP9 (WebM)
 *   audio  : OfflineAudioContext (mixage déterministe) → AAC (MP4) / Opus (WebM)
 *            ou lamejs (MP3)
 */

import { mediaUrl } from './api';
import { FrameRenderer } from './render';
import type { Clip, ExportFormat, Project } from './state';
import { clipSpeed, keyframesFor, mediaById, sourceTimeAt, timelineEnd, valueAt } from './state';
import { muxWebM } from './webm-muxer.js';

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;

export interface BrowserExportOptions {
  project: Project;
  format: ExportFormat;
  width: number;
  height: number;
  /** Cadence d'export (30, 29.97…). */
  fps: number;
  /** Réglage de qualité : agit sur le débit (le CRF n'existe pas ici). */
  quality?: 'high' | 'medium' | 'fast';
  onProgress: (stage: string, percent: number) => void;
  signal?: AbortSignal;
}

export interface BrowserExportResult {
  blob: Blob;
  format: ExportFormat;
  width: number;
  height: number;
  frames: number;
  duration_us: number;
  size_bytes: number;
  audio_gain: number;
  /** `false` : le fichier ne contient aucune piste son (aucune piste mixable). */
  has_audio: boolean;
  /** Clips dont la piste son n'a pas pu être décodée (0 = tout est là). */
  audio_skipped: number;
}

interface EncodedChunk {
  data: Uint8Array;
  timestamp: number;
  duration: number;
  isKey: boolean;
}

/** `decoderConfig.description` arrive en ArrayBuffer ou en vue typée. */
function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value as ArrayBufferView)) {
    const view = value as ArrayBufferView;
    return (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  return new Uint8Array(value as ArrayLike<number>).slice().buffer as ArrayBuffer;
}

function bitrateFor(width: number, height: number, fps: number): number {
  const pixels = width * height;
  let base = 5_000_000;
  if (pixels >= 3840 * 2160) base = 30_000_000;
  else if (pixels >= 2560 * 1440) base = 20_000_000;
  else if (pixels >= 1920 * 1080) base = 16_000_000;
  else if (pixels >= 1280 * 720) base = 8_000_000;
  return Math.round(base * Math.min(1.5, fps / 30));
}

async function pickVideoConfig(
  format: ExportFormat,
  width: number,
  height: number,
  fps: number,
  quality: 'high' | 'medium' | 'fast' = 'medium',
): Promise<VideoEncoderConfig> {
  const factor = quality === 'high' ? 1.4 : quality === 'fast' ? 0.65 : 1;
  const bitrate = Math.round(bitrateFor(width, height, fps) * factor);
  const candidates =
    format === 'webm'
      ? ['vp09.00.10.08', 'vp8']
      : ['avc1.640028', 'avc1.4D4028', 'avc1.42E028', 'avc1.42E01F'];
  for (const codec of candidates) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return config;
    } catch {
      // codec inconnu de ce navigateur : on essaie le suivant
    }
  }
  throw new Error(
    `Aucun encodeur vidéo utilisable (${format.toUpperCase()}) dans ce navigateur. Utilisez Chrome ou Edge à jour.`,
  );
}

/* ── Sources média ─────────────────────────────────────────────────────── */

class MediaSources {
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();
  private files = new Map<string, Blob>();

  private elementFor(clip: Clip): HTMLVideoElement | null {
    const media = clip.media;
    if (!media) return null;
    let element = this.videos.get(clip.id);
    if (!element) {
      element = document.createElement('video');
      element.src = mediaUrl(media);
      element.preload = 'auto';
      element.muted = true;
      element.playsInline = true;
      element.crossOrigin = 'anonymous';
      this.videos.set(clip.id, element);
    }
    return element;
  }

  private imageElement(clip: Clip): HTMLImageElement | null {
    if (!clip.media) return null;
    let element = this.images.get(clip.id);
    if (!element) {
      element = new Image();
      element.src = mediaUrl(clip.media);
      this.images.set(clip.id, element);
    }
    return element;
  }

  async prepare(project: Project): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (clip.type === 'video') {
          const element = this.elementFor(clip);
          if (!element) continue;
          waits.push(
            new Promise<void>((resolve, reject) => {
              if (element.readyState >= 2) return resolve();
              const done = () => {
                cleanup();
                resolve();
              };
              const fail = () => {
                cleanup();
                reject(new Error(`vidéo illisible : ${clip.name}`));
              };
              const cleanup = () => {
                element.removeEventListener('loadeddata', done);
                element.removeEventListener('error', fail);
              };
              element.addEventListener('loadeddata', done, { once: true });
              element.addEventListener('error', fail, { once: true });
              setTimeout(done, 20_000);
            }),
          );
        } else if (clip.type === 'image') {
          const element = this.imageElement(clip);
          if (!element) continue;
          waits.push(
            new Promise<void>((resolve) => {
              if (element.complete && element.naturalWidth) return resolve();
              element.addEventListener('load', () => resolve(), { once: true });
              element.addEventListener('error', () => resolve(), { once: true });
            }),
          );
        }
      }
    }
    await Promise.all(waits);
  }

  async seek(clip: Clip, seconds: number): Promise<void> {
    const element = this.elementFor(clip);
    if (!element || element.readyState < 2) return;
    const target = Math.max(0, Math.min(seconds, Math.max(0, element.duration - 0.001)));
    if (Math.abs(element.currentTime - target) < 0.004) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        element.removeEventListener('seeked', done);
        resolve();
      };
      element.addEventListener('seeked', done, { once: true });
      try {
        element.currentTime = target;
      } catch {
        done();
        return;
      }
      // Certains navigateurs ne renvoient pas `seeked` sur une valeur inchangée.
      setTimeout(done, 2500);
    });
  }

  lookup(clip: Clip): { source: CanvasImageSource; width: number; height: number } | null {
    if (clip.type === 'video') {
      const element = this.videos.get(clip.id);
      if (!element || element.readyState < 2 || !element.videoWidth) return null;
      return { source: element, width: element.videoWidth, height: element.videoHeight };
    }
    if (clip.type === 'image') {
      const element = this.images.get(clip.id);
      if (!element || !element.complete || !element.naturalWidth) return null;
      return { source: element, width: element.naturalWidth, height: element.naturalHeight };
    }
    return null;
  }

  /** Blob d'un média, pour le décodage audio. */
  async file(mediaId: string): Promise<Blob | null> {
    const known = this.files.get(mediaId);
    if (known) return known;
    try {
      const response = await fetch(mediaUrl(mediaId));
      if (!response.ok) return null;
      const blob = await response.blob();
      this.files.set(mediaId, blob);
      return blob;
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const element of this.videos.values()) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
    this.videos.clear();
    this.images.clear();
    this.files.clear();
  }
}

/* ── Mixage audio déterministe ──────────────────────────────────────────── */

/**
 * Décode un fichier en AudioBuffer.
 *
 * `decodeAudioData` suffit pour WAV/MP3/OGG/WebM. Certains conteneurs MP4/MOV
 * sont refusés alors que la piste est lisible : on démuxe alors avec MP4Box et
 * on décode avec WebCodecs — sans jamais passer par une horloge temps réel.
 *
 * ⚠️ Le repli MP4Box n'est tenté que sur un vrai MP4 : MP4Box n'appelle jamais
 * `onReady` sur un WebM, et l'attente serait alors infinie (export figé à
 * « Mixing audio… »). Un média sans piste audio n'a rien à décoder : `null`.
 */
async function decodeBlob(blob: Blob, context: BaseAudioContext): Promise<AudioBuffer | null> {
  let buffer: ArrayBuffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch {
    return null;
  }
  try {
    // `decodeAudioData` détache le buffer : on en garde une copie pour le repli.
    return await context.decodeAudioData(buffer.slice(0));
  } catch {
    if (!looksLikeMp4(buffer)) return null;
    return demuxMp4Audio(blob, context);
  }
}

/** Vrai si les octets 4..8 valent `ftyp` (en-tête de tout fichier ISO-BMFF). */
function looksLikeMp4(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const head = new Uint8Array(buffer, 4, 4);
  return head[0] === 0x66 && head[1] === 0x74 && head[2] === 0x79 && head[3] === 0x70;
}

interface DemuxedSample {
  data: Uint8Array;
  timestamp: number;
  duration: number;
}

async function demuxMp4Audio(blob: Blob, context: BaseAudioContext): Promise<AudioBuffer | null> {
  const MP4Box = (window as unknown as { MP4Box?: any }).MP4Box;
  const Decoder = (window as unknown as { AudioDecoder?: typeof AudioDecoder }).AudioDecoder;
  if (!MP4Box || !Decoder) return null;

  try {
    const buffer = await blob.arrayBuffer();
    const file = MP4Box.createFile();
    const samples: DemuxedSample[] = [];
    let track: any = null;
    let description: Uint8Array | null = null;

    const findAsc = (node: any, depth = 0): Uint8Array | null => {
      if (!node || depth > 6) return null;
      if (node.tag === 5 && node.data) return new Uint8Array(node.data);
      for (const child of node.descs || node.descriptors || []) {
        const found = findAsc(child, depth + 1);
        if (found) return found;
      }
      return null;
    };

    file.onSamples = (_id: number, _user: unknown, chunk: any[]) => {
      for (const sample of chunk) {
        const data = new Uint8Array(sample.data.byteLength);
        data.set(new Uint8Array(sample.data));
        samples.push({
          data,
          timestamp: Math.round((sample.cts * 1_000_000) / sample.timescale),
          duration: Math.round((sample.duration * 1_000_000) / sample.timescale),
        });
      }
    };

    await new Promise<void>((resolve) => {
      // Filet de sécurité : un MP4 tronqué peut ne jamais déclencher `onReady`.
      const timeout = window.setTimeout(resolve, 8000);
      file.onReady = (info: any) => {
        track = (info.audioTracks || [])[0] ?? null;
        if (!track) return resolve();
        const trak = file.getTrackById(track.id);
        for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
          if (entry.esds) {
            description = findAsc(entry.esds.esd ?? entry.esds);
            break;
          }
        }
        file.setExtractionOptions(track.id, null, { nbSamples: 100000 });
        file.start();
        window.setTimeout(() => { window.clearTimeout(timeout); resolve(); }, 2500);
      };
      (buffer as ArrayBuffer & { fileStart?: number }).fileStart = 0;
      file.appendBuffer(buffer);
      file.flush();
    });
    if (!track || !samples.length) return null;

    const blocks: Array<{ planes: Float32Array[]; frames: number }> = [];
    let total = 0;
    let failure: Error | null = null;
    const decoder = new Decoder({
      output: (data: AudioData) => {
        const frames = data.numberOfFrames;
        const channels = data.numberOfChannels;
        const planes: Float32Array[] = [];
        for (let channel = 0; channel < channels; channel += 1) {
          const plane = new Float32Array(frames);
          data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          planes.push(plane);
        }
        blocks.push({ planes, frames });
        total += frames;
        data.close();
      },
      error: (error: Error) => {
        failure = error;
      },
    } as AudioDecoderInit);

    decoder.configure({
      codec: track.codec?.startsWith('mp4a') ? track.codec : 'mp4a.40.2',
      sampleRate: track.audio?.sample_rate ?? SAMPLE_RATE,
      numberOfChannels: track.audio?.channel_count ?? CHANNELS,
      ...(description ? { description } : {}),
    } as AudioDecoderConfig);

    for (const sample of samples) {
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: sample.timestamp,
          duration: sample.duration,
          data: sample.data,
        }),
      );
    }
    await decoder.flush();
    decoder.close();
    if (failure || !total) return null;

    const rate = track.audio?.sample_rate ?? SAMPLE_RATE;
    const channelCount = blocks[0]?.planes.length || 1;
    const output = context.createBuffer(channelCount, total, rate);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const target = output.getChannelData(channel);
      let offset = 0;
      for (const block of blocks) {
        const plane = block.planes[channel];
        if (plane) target.set(plane, offset);
        offset += block.frames;
      }
    }
    return output;
  } catch {
    return null;
  }
}

async function renderAudio(
  project: Project,
  renderer: FrameRenderer,
  durationUs: number,
  sources: MediaSources,
  signal?: AbortSignal,
): Promise<{ buffer: AudioBuffer | null; skipped: number }> {
  const frames = Math.max(1, Math.ceil((durationUs / 1_000_000) * SAMPLE_RATE));
  const context = new OfflineAudioContext(CHANNELS, frames, SAMPLE_RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  let used = 0;
  let skipped = 0;

  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      // Le décodage audio peut être long (MP4 volumineux) : on rend la main
      // entre deux clips pour que « Cancel » interrompe vraiment l'export.
      if (signal?.aborted) return { buffer: null, skipped };
      const wanted =
        clip.type === 'audio' || (clip.type === 'video' && !clip.audio_muted);
      if (!wanted || !clip.media) continue;
      const media = mediaById(project, clip.media);
      if (!media) continue;

      let buffer = decoded.get(media.id);
      if (buffer === undefined) {
        buffer = null;
        const blob = await sources.file(media.id);
        if (blob) buffer = await decodeBlob(blob, context);
        decoded.set(media.id, buffer);
      }
      if (!buffer) {
        skipped += 1;
        continue;
      }

      const placement = renderer.placementOf(clip);
      const when = placement.start_us / 1_000_000;
      const speed = clipSpeed(clip);
      const offset = sourceTimeAt(clip, 0) / 1_000_000;
      const length = placement.duration_us / 1_000_000;
      if (when >= durationUs / 1_000_000) continue;

      const source = context.createBufferSource();
      source.buffer = buffer;
      // 0.0625–16 : plage acceptée par la Web Audio API.
      source.playbackRate.value = Math.min(16, Math.max(0.0625, speed));
      const gain = context.createGain();
      const base = Math.min(1, Math.max(0, track.volume));
      const fadeIn = placement.fade_in_us / 1_000_000;
      const fadeOut = clip.fade_out_us / 1_000_000;
      const end = Math.min(when + length, durationUs / 1_000_000);

      const envelope = (localSec: number): number => {
        const localUs = localSec * 1_000_000;
        let value = base * Math.max(0, valueAt(clip, 'volume', localUs));
        if (placement.fade_in_us > 0 && localUs < placement.fade_in_us) {
          value *= Math.max(0, localUs / placement.fade_in_us);
        }
        const remaining = placement.duration_us - localUs;
        if (clip.fade_out_us > 0 && remaining < clip.fade_out_us) {
          value *= Math.max(0, remaining / clip.fade_out_us);
        }
        return Math.min(1, Math.max(0, value));
      };

      if (keyframesFor(clip, 'volume').length > 0) {
        // Courbe animée : on échantillonne à 100 Hz (les rampes linéaires de la
        // Web Audio ne savent pas suivre une interpolation à easing).
        const step = 0.01;
        for (let t = 0; t < length; t += step) gain.gain.setValueAtTime(envelope(t), when + t);
        gain.gain.setValueAtTime(envelope(length), when + length);
      } else {
        const volume = Math.min(1, Math.max(0, base * valueAt(clip, 'volume', 0)));
        gain.gain.setValueAtTime(fadeIn > 0 ? 0 : volume, when);
        if (fadeIn > 0) gain.gain.linearRampToValueAtTime(volume, when + fadeIn);
        if (fadeOut > 0 && end - fadeOut > when) {
          gain.gain.setValueAtTime(volume, end - fadeOut);
          gain.gain.linearRampToValueAtTime(0, end);
        }
      }
      source.connect(gain).connect(context.destination);
      try {
        // `duration` est comptée dans le temps de la source : à 2×, une fenêtre
        // de 2 s consomme 4 s de fichier.
        source.start(when, offset, Math.max(0.001, length * speed));
      } catch {
        continue;
      }
      used += 1;
    }
  }

  // Aucune piste n'a pu être mixée : on remonte quand même le nombre de clips
  // ignorés, sinon l'export vidéo paraît normal alors qu'il est muet.
  if (!used) return { buffer: null, skipped };
  const rendered = await context.startRendering();
  return { buffer: rendered, skipped };
}

/* ── MP4 (mp4box.js) ───────────────────────────────────────────────────── */

interface Mp4BoxLike {
  createFile: () => {
    addTrack: (options: Record<string, unknown>) => number;
    addSample: (trackId: number, buffer: ArrayBuffer & { fileStart?: number }, options: Record<string, unknown>) => void;
    getBuffer: () => ArrayBuffer;
  };
}

function createEsdsBox(audioSpecificConfig: ArrayBuffer, bitrate = 192_000): unknown {
  const asc = Array.from(new Uint8Array(audioSpecificConfig));
  const descriptor = (tag: number, payload: number[]): number[] => {
    const lengthBytes = [payload.length & 0x7f];
    let rest = payload.length >> 7;
    while (rest > 0) {
      lengthBytes.unshift((rest & 0x7f) | 0x80);
      rest >>= 7;
    }
    return [tag, ...lengthBytes, ...payload];
  };

  const bufferSizeDB = 6144;
  const decoderConfig = [
    0x40,
    0x15,
    (bufferSizeDB >> 16) & 0xff,
    (bufferSizeDB >> 8) & 0xff,
    bufferSizeDB & 0xff,
    (bitrate >>> 24) & 0xff,
    (bitrate >>> 16) & 0xff,
    (bitrate >>> 8) & 0xff,
    bitrate & 0xff,
    (bitrate >>> 24) & 0xff,
    (bitrate >>> 16) & 0xff,
    (bitrate >>> 8) & 0xff,
    bitrate & 0xff,
    ...descriptor(0x05, asc),
  ];
  const esDescriptor = descriptor(0x03, [
    0x00,
    0x01,
    0x00,
    ...descriptor(0x04, decoderConfig),
    ...descriptor(0x06, [0x02]),
  ]);
  const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, ...esDescriptor]);
  return {
    type: 'esds',
    size: 8 + data.length,
    data,
    write(stream: {
      writeUint32: (value: number) => void;
      writeString: (value: string, _?: null, size?: number) => void;
      writeUint8Array: (value: Uint8Array) => void;
    }) {
      const self = this as { size: number; data: Uint8Array; type: string };
      self.size = 8 + self.data.length;
      stream.writeUint32(self.size);
      stream.writeString(self.type, null, 4);
      stream.writeUint8Array(self.data);
    },
  };
}

function muxMp4(
  videoChunks: EncodedChunk[],
  codec: string,
  description: ArrayBuffer | null,
  width: number,
  height: number,
  fps: number,
  audioChunks: EncodedChunk[],
  aacDescription: ArrayBuffer | null,
): Blob {
  const MP4Box = (window as unknown as { MP4Box?: Mp4BoxLike }).MP4Box;
  if (!MP4Box) throw new Error('mp4box.js absent — vérifiez /vendor/mp4box.all.min.js');
  if (!description) throw new Error('configuration H.264 manquante — MP4 impossible');

  const file = MP4Box.createFile();
  const TIMESCALE = 90_000;
  const ticksAt = (n: number): number => Math.round((n * TIMESCALE) / fps);
  const videoTrack = file.addTrack({
    timescale: TIMESCALE,
    width,
    height,
    nb_samples: videoChunks.length,
    codec,
    avcDecoderConfigRecord: description,
  });

  videoChunks.forEach((chunk, index) => {
    const buffer = new ArrayBuffer(chunk.data.byteLength);
    new Uint8Array(buffer).set(chunk.data);
    (buffer as ArrayBuffer & { fileStart?: number }).fileStart = 0;
    const t0 = ticksAt(index);
    file.addSample(videoTrack, buffer as ArrayBuffer & { fileStart?: number }, {
      duration: Math.max(1, ticksAt(index + 1) - t0),
      is_sync: chunk.isKey,
      cts: t0,
      dts: t0,
    });
  });

  if (audioChunks.length && aacDescription) {
    const audioTrack = file.addTrack({
      timescale: SAMPLE_RATE,
      type: 'mp4a',
      hdlr: 'soun',
      nb_samples: audioChunks.length,
      codec: 'mp4a.40.2',
      channel_count: CHANNELS,
      samplerate: SAMPLE_RATE,
      samplesize: 16,
      description: createEsdsBox(aacDescription),
    });
    for (const chunk of audioChunks) {
      const buffer = new ArrayBuffer(chunk.data.byteLength);
      new Uint8Array(buffer).set(chunk.data);
      (buffer as ArrayBuffer & { fileStart?: number }).fileStart = 0;
      const cts = Math.round((chunk.timestamp * SAMPLE_RATE) / 1_000_000);
      file.addSample(audioTrack, buffer as ArrayBuffer & { fileStart?: number }, {
        duration: Math.max(1, Math.round((chunk.duration * SAMPLE_RATE) / 1_000_000)),
        is_sync: true,
        cts,
        dts: cts,
      });
    }
  }

  return new Blob([file.getBuffer()], { type: 'video/mp4' });
}

/* ── MP3 (lamejs) ──────────────────────────────────────────────────────── */

interface LameLike {
  Mp3Encoder: new (channels: number, sampleRate: number, bitrate: number) => {
    encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
    flush: () => Int8Array;
  };
}

function encodeMp3(buffer: AudioBuffer): Blob {
  const lame = (window as unknown as { lamejs?: LameLike }).lamejs;
  if (!lame) throw new Error('lamejs absent — vérifiez /vendor/lamejs.min.js');
  const encoder = new lame.Mp3Encoder(2, buffer.sampleRate, 192);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const parts: Uint8Array[] = [];
  const block = 1152;
  const leftInt = new Int16Array(block);
  const rightInt = new Int16Array(block);
  for (let offset = 0; offset < left.length; offset += block) {
    const count = Math.min(block, left.length - offset);
    for (let i = 0; i < count; i += 1) {
      leftInt[i] = Math.max(-1, Math.min(1, left[offset + i])) * 32767;
      rightInt[i] = Math.max(-1, Math.min(1, right[offset + i])) * 32767;
    }
    const chunk = encoder.encodeBuffer(
      count === block ? leftInt : leftInt.subarray(0, count),
      count === block ? rightInt : rightInt.subarray(0, count),
    );
    if (chunk.length) parts.push(new Uint8Array(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

/* ── Pipeline ──────────────────────────────────────────────────────────── */

export async function exportInBrowser(options: BrowserExportOptions): Promise<BrowserExportResult> {
  const { project, format, width, height, fps, onProgress } = options;
  const durationUs = timelineEnd(project);
  if (durationUs <= 0) throw new Error('timeline vide');
  const alive = () => {
    if (options.signal?.aborted) throw new Error('export annulé');
  };

  // Le projet d'export porte la résolution choisie : `render.ts` s'adapte.
  const exportProject: Project = { ...project, width, height };
  const renderer = new FrameRenderer(exportProject);
  const sources = new MediaSources();
  let audioGain = 1;

  try {
    onProgress('audio', 1);
    alive();
    await sources.prepare(exportProject);

    // ── Audio ───────────────────────────────────────────────────────────
    onProgress('audio', 5);
    const mix = await renderAudio(exportProject, renderer, durationUs, sources, options.signal);
    alive();

    const audioBuffer: AudioBuffer | null = mix.buffer;
    const audioSkipped = mix.skipped;
    if (audioBuffer) {
      // Écêtage : on atténue le mix s'il dépasse 0 dBFS, jamais l'inverse.
      let peak = 0;
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
        const data = audioBuffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
      }
      if (peak > 0.99) {
        audioGain = 0.99 / peak;
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
          const data = audioBuffer.getChannelData(channel);
          for (let i = 0; i < data.length; i += 1) data[i] *= audioGain;
        }
      }
    }

    onProgress('audio', 14);
    alive();

    if (format === 'mp3') {
      if (!audioBuffer) throw new Error('aucune piste audio : rien à encoder en MP3');
      onProgress('mux', 80);
      const blob = encodeMp3(audioBuffer);
      onProgress('done', 100);
      return {
        blob,
        format,
        width: 0,
        height: 0,
        frames: 0,
        duration_us: durationUs,
        size_bytes: blob.size,
        audio_gain: audioGain,
        has_audio: true,
        audio_skipped: audioSkipped,
      };
    }

    // ── Audio encodé ────────────────────────────────────────────────────
    const audioChunks: EncodedChunk[] = [];
    let aacDescription: ArrayBuffer | null = null;
    let opusHead: ArrayBuffer | null = null;

    if (audioBuffer && typeof AudioEncoder !== 'undefined') {
      const audioCodec = format === 'webm' ? 'opus' : 'mp4a.40.2';
      const audioConfig: AudioEncoderConfig = {
        codec: audioCodec,
        numberOfChannels: CHANNELS,
        sampleRate: SAMPLE_RATE,
        bitrate: format === 'webm' ? 128_000 : 192_000,
      };
      try {
        const support = await AudioEncoder.isConfigSupported(audioConfig);
        if (support.supported) {
          let failure: Error | null = null;
          const encoder = new AudioEncoder({
            output: (chunk, metadata) => {
              const data = new Uint8Array(chunk.byteLength);
              chunk.copyTo(data);
              audioChunks.push({
                data,
                timestamp: chunk.timestamp,
                duration: chunk.duration ?? 0,
                isKey: true,
              });
              const description = metadata?.decoderConfig?.description;
              if (description) {
                if (format === 'webm' && !opusHead) opusHead = toArrayBuffer(description);
                else if (format === 'mp4' && !aacDescription) {
                  aacDescription = toArrayBuffer(description);
                }
              }
            },
            error: (error) => {
              failure = error instanceof Error ? error : new Error(String(error));
            },
          });
          encoder.configure(audioConfig);

          const left = audioBuffer.getChannelData(0);
          const right =
            audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
          const total = left.length;
          const frameSize = 1024;
          for (let offset = 0; offset < total; offset += frameSize) {
            alive();
            const count = Math.min(frameSize, total - offset);
            const planar = new Float32Array(CHANNELS * frameSize);
            planar.set(left.subarray(offset, offset + count), 0);
            planar.set(right.subarray(offset, offset + count), frameSize);
            const data = new AudioData({
              format: 'f32-planar',
              sampleRate: SAMPLE_RATE,
              numberOfFrames: count,
              numberOfChannels: CHANNELS,
              timestamp: Math.round((offset / SAMPLE_RATE) * 1_000_000),
              data: planar.buffer,
            });
            encoder.encode(data);
            data.close();
            if (encoder.encodeQueueSize > 16) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          await encoder.flush();
          encoder.close();
          if (failure) throw failure;
        }
      } catch {
        // Le son ne doit jamais faire échouer l'image : on repart sans audio.
        audioChunks.length = 0;
        aacDescription = null;
        opusHead = null;
      }
    }
    alive();

    // ── Vidéo ───────────────────────────────────────────────────────────
    const config = await pickVideoConfig(format, width, height, fps, options.quality);
    const codec = config.codec;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas 2D indisponible');

    const videoChunks: EncodedChunk[] = [];
    let avcDescription: ArrayBuffer | null = null;
    let encoderError: Error | null = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        videoChunks.push({
          data,
          timestamp: chunk.timestamp,
          duration: chunk.duration ?? 0,
          isKey: chunk.type === 'key',
        });
        const description = metadata?.decoderConfig?.description;
        if (description && !avcDescription) avcDescription = toArrayBuffer(description);
      },
      error: (error) => {
        encoderError = error instanceof Error ? error : new Error(String(error));
      },
    });
    videoEncoder.configure(config);

    const totalFrames = Math.max(1, Math.round((durationUs / 1_000_000) * fps));
    const frameDuration = Math.round(1_000_000 / fps);
    const keyEvery = Math.max(1, Math.round(fps * 2));
    const lookup = (clip: Clip) => sources.lookup(clip);

    for (let index = 0; index < totalFrames; index += 1) {
      alive();
      if (encoderError) throw encoderError;
      const timeUs = Math.round((index * 1_000_000) / fps);

      // Recale chaque vidéo active sur sa position exacte dans sa source.
      const seeks: Promise<void>[] = [];
      for (const track of exportProject.tracks) {
        if (track.muted) continue;
        for (const clip of track.clips) {
          if (clip.type !== 'video' || !renderer.isActive(clip, timeUs)) continue;
          const placement = renderer.placementOf(clip);
          const seconds = sourceTimeAt(clip, timeUs - placement.start_us) / 1_000_000;
          seeks.push(sources.seek(clip, seconds));
        }
      }
      if (seeks.length) await Promise.all(seeks);

      renderer.drawFrame(ctx, timeUs, lookup);
      const frame = new VideoFrame(canvas, {
        timestamp: timeUs,
        duration: frameDuration,
      });
      videoEncoder.encode(frame, { keyFrame: index % keyEvery === 0 });
      frame.close();

      if (videoEncoder.encodeQueueSize > 8) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (index % 3 === 0) {
        onProgress('video', 15 + (index / totalFrames) * 78);
      }
    }

    onProgress('video', 93);
    await videoEncoder.flush();
    videoEncoder.close();
    if (encoderError) throw encoderError;
    alive();

    // ── Muxage ──────────────────────────────────────────────────────────
    onProgress('mux', 96);
    let blob: Blob;
    if (format === 'webm') {
      blob = muxWebM({
        width,
        height,
        fps,
        durationMs: Math.round(durationUs / 1000),
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        videoChunks,
        audioChunks,
        codecPrivate: null,
        opusHead,
      });
    } else {
      blob = muxMp4(
        videoChunks,
        codec,
        avcDescription,
        width,
        height,
        fps,
        audioChunks,
        aacDescription,
      );
    }

    if (blob.size < 1024) throw new Error(`fichier vide (${blob.size} octets)`);
    onProgress('done', 100);
    return {
      blob,
      format,
      width,
      height,
      frames: totalFrames,
      duration_us: durationUs,
      size_bytes: blob.size,
      audio_gain: audioGain,
      has_audio: audioChunks.length > 0,
      audio_skipped: audioSkipped,
    };
  } finally {
    sources.dispose();
  }
}

