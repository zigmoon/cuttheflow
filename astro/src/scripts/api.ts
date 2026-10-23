/**
 * Accès aux médias et à l'export — deux modes, une seule interface.
 *
 * **moteur** : un binaire Rust répond sur `<base>/api/*`. L'import est sondé par
 * ffprobe, l'export est rendu par ffmpeg ; le fichier est le même partout.
 *
 * **local** : aucun moteur (site statique). Le fichier choisi ne quitte jamais
 * la machine : il est sondé par les éléments média du navigateur, conservé dans
 * IndexedDB, et l'export est encodé par WebCodecs (voir `export-browser.ts`).
 */

import type { ExportFormat, Media, Project } from './state';
import {
  allEntries,
  deleteEntry,
  getEntry,
  makeThumbnail,
  objectUrl,
  probeLocal,
  putEntry,
} from './local-media';

const params = new URLSearchParams(location.search);
const devPort = location.port === '4321' || location.port === '4322';
/** Base du site, sous-dossier compris (`/CUTTHEFLOW/` en production). */
const BASE = import.meta.env.BASE_URL || '/';
export const API_BASE = params.get('api') || (devPort ? 'http://127.0.0.1:7317' : '');

export type Mode = 'engine' | 'local';

let mode: Mode = 'local';
const localUrls = new Map<string, string>();
const localThumbs = new Map<string, string>();

export function currentMode(): Mode {
  return mode;
}

export function apiUrl(path: string): string {
  if (API_BASE) return `${API_BASE}${path}`;
  return `${BASE.replace(/\/$/, '')}${path}`;
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ||
      `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
}

export interface Health {
  ok: boolean;
  mode: Mode;
  version: string;
  ffmpeg: string;
  font: string | null;
  media: number;
  /** Vrai quand le serveur répond ET que ffmpeg est utilisable. */
  engine: boolean;
  /** Explication à montrer à l'utilisateur quand le moteur est incomplet. */
  reason: string | null;
}

/** Interroge le moteur ; bascule en mode local s'il ne répond pas. */
export async function health(): Promise<Health> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    const response = await fetch(apiUrl('/api/health'), { signal: controller.signal });
    window.clearTimeout(timer);
    if (!response.ok) throw new Error(String(response.status));
    const payload = (await response.json()) as Partial<Health>;
    // Le serveur peut répondre tout en n'ayant pas ffmpeg : il renvoie alors
    // `engine: false`. On respecte ce drapeau, sinon l'interface croirait le
    // moteur disponible et échouerait au premier import.
    const engine = payload.engine !== false;
    mode = engine ? 'engine' : 'local';
    return {
      ok: engine,
      mode,
      version: String(payload.version ?? ''),
      ffmpeg: String(payload.ffmpeg ?? ''),
      font: (payload.font as string | null) ?? null,
      media: Number(payload.media ?? 0),
      engine,
      reason: (payload.reason as string | null) ?? null,
    };
  } catch {
    mode = 'local';
    return { ok: false, mode, version: '', ffmpeg: '', font: null, media: 0, engine: false, reason: null };
  }
}

/* ── Médias ────────────────────────────────────────────────────────────── */

export async function listMedia(): Promise<Media[]> {
  if (mode === 'engine') {
    const payload = await parse<{ media: Media[] }>(await fetch(apiUrl('/api/media')));
    return payload.media || [];
  }
  const entries = await allEntries();
  for (const entry of entries) {
    if (entry.thumb) localThumbs.set(entry.id, entry.thumb);
    if (!localUrls.has(entry.id)) {
      const url = await objectUrl(entry.id);
      if (url) localUrls.set(entry.id, url);
    }
  }
  return entries.map((entry) => entry.media);
}

export function importMedia(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Media> {
  if (mode === 'local') return importLocal(file, onProgress);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', apiUrl(`/api/import?name=${encodeURIComponent(file.name)}`));
    request.responseType = 'text';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress((event.loaded / event.total) * 100);
      }
    };
    request.onerror = () => reject(new Error('moteur Rust injoignable'));
    request.onload = () => {
      let payload: any = null;
      try {
        payload = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300 && payload) {
        resolve(payload as Media);
      } else {
        reject(new Error(payload?.error || `import rejected (${request.status})`));
      }
    };
    request.send(file);
  });
}

async function importLocal(file: File, onProgress?: (percent: number) => void): Promise<Media> {
  const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  onProgress?.(5);
  const media = await probeLocal(file, id);
  onProgress?.(60);
  const thumb = media.kind === 'image' ? null : await makeThumbnail(file);
  onProgress?.(85);
  await putEntry({ id, name: file.name, file, thumb, media });
  const url = await objectUrl(id);
  if (url) localUrls.set(id, url);
  if (thumb) localThumbs.set(id, thumb);
  onProgress?.(100);
  return media;
}

export async function deleteMedia(id: string): Promise<void> {
  forgetWaveform(id);
  if (mode === 'engine') {
    await parse(await fetch(apiUrl(`/api/media/${encodeURIComponent(id)}`), { method: 'DELETE' }));
    return;
  }
  await deleteEntry(id);
  localUrls.delete(id);
  localThumbs.delete(id);
}

export function mediaUrl(id: string): string {
  if (mode === 'local') return localUrls.get(id) ?? '';
  return apiUrl(`/api/media/${encodeURIComponent(id)}`);
}

export function thumbnailUrl(id: string): string {
  if (mode === 'local') return localThumbs.get(id) ?? '';
  return apiUrl(`/api/media/${encodeURIComponent(id)}/thumbnail`);
}

export function waveformUrl(id: string, points = 900): string {
  return apiUrl(`/api/media/${encodeURIComponent(id)}/waveform?points=${points}`);
}

const waveformCache = new Map<string, number[]>();
const waveformJobs = new Map<string, Promise<number[] | null>>();

/** Réduit un AudioBuffer à `points` pics (0..1) sur toute sa durée. */
function reducePeaks(buffer: AudioBuffer, points: number): number[] {
  const length = buffer.length;
  const buckets = Math.max(1, Math.min(points, length));
  const channel = buffer.getChannelData(0);
  const peaks: number[] = [];
  let global = 0;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor((bucket * length) / buckets);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * length) / buckets));
    let peak = 0;
    for (let index = start; index < end && index < length; index += 1) {
      const value = Math.abs(channel[index]);
      if (value > peak) peak = value;
    }
    if (peak > global) global = peak;
    peaks.push(peak);
  }
  return global > 0 ? peaks.map((value) => Math.round((value / global) * 1000) / 1000) : peaks;
}

/**
 * Pics normalisés (0..1) d'un média, répartis uniformément sur sa durée totale.
 * Mise en cache : la timeline redessine souvent, le décodage jamais.
 */
export function waveformPeaks(id: string, points = 900): Promise<number[] | null> {
  const key = `${id}:${points}`;
  const cached = waveformCache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = waveformJobs.get(key);
  if (running) return running;

  const job = (async (): Promise<number[] | null> => {
    try {
      if (mode === 'engine') {
        const response = await fetch(waveformUrl(id, points));
        if (!response.ok) return null;
        const payload = (await response.json()) as { points?: number[] } | null;
        const peaks = payload?.points;
        if (!Array.isArray(peaks) || !peaks.length) return null;
        waveformCache.set(key, peaks);
        return peaks;
      }
      const url = mediaUrl(id);
      if (!url) return null;
      const blob = await (await fetch(url)).blob();
      const bytes = await blob.arrayBuffer();
      const context = new OfflineAudioContext(1, 1, 48_000);
      const buffer = await context.decodeAudioData(bytes);
      const peaks = reducePeaks(buffer, points);
      waveformCache.set(key, peaks);
      return peaks;
    } catch {
      return null;
    } finally {
      waveformJobs.delete(key);
    }
  })();
  waveformJobs.set(key, job);
  return job;
}

/** Oublie les pics d'un média (suppression, ou réimport). */
export function forgetWaveform(id: string): void {
  for (const key of [...waveformCache.keys()]) {
    if (key.startsWith(`${id}:`)) waveformCache.delete(key);
  }
}

/** Recharge un média local précis (au démarrage, avant le premier rendu). */
export async function primeLocal(id: string): Promise<void> {
  if (mode !== 'local' || localUrls.has(id)) return;
  const entry = await getEntry(id);
  if (!entry) return;
  if (entry.thumb) localThumbs.set(id, entry.thumb);
  const url = await objectUrl(id);
  if (url) localUrls.set(id, url);
}

/* ── Export (mode moteur uniquement) ───────────────────────────────────── */

export async function startExport(payload: {
  project: Project;
  format: ExportFormat;
  crf: number;
  preset: string;
}): Promise<string> {
  const response = await fetch(apiUrl('/api/export'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parse<{ job_id: string }>(response);
  return data.job_id;
}

export interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  stage: string;
  message: string;
  error: string | null;
  output: {
    path: string;
    format: string;
    duration_us: number;
    frames: number;
    width: number;
    height: number;
    size_bytes: number;
    video_codec: string | null;
    audio_codec: string | null;
    elapsed_ms: number;
  } | null;
}

export async function jobStatus(id: string): Promise<Job> {
  return parse(await fetch(apiUrl(`/api/jobs/${encodeURIComponent(id)}`)));
}

export async function cancelJob(id: string): Promise<void> {
  await parse(
    await fetch(apiUrl(`/api/jobs/${encodeURIComponent(id)}/cancel`), { method: 'POST' }),
  );
}

export function jobFileUrl(id: string): string {
  return apiUrl(`/api/jobs/${encodeURIComponent(id)}/file`);
}
