/**
 * Médias locaux — import et stockage 100 % navigateur.
 *
 * L'application existe en deux modes :
 *   • **moteur** — un binaire Rust répond sur `/api/*` : import, sondage et
 *     export sont délégués à ffmpeg, donc identiques sur toutes les machines ;
 *   • **local** — aucun moteur (hébergement statique) : le fichier ne quitte
 *     jamais la machine, il est sondé par les éléments média du navigateur et
 *     conservé dans IndexedDB pour survivre à un rechargement.
 *
 * IndexedDB est le seul stockage qui accepte des Blob de plusieurs centaines de
 * Mo ; localStorage est limité à quelques Mo et ne sait pas stocker de binaire.
 */

import type { Media, MediaKind } from './state';

const DB_NAME = 'ctf2-local';
const DB_VERSION = 1;
const STORE = 'media';

export interface LocalEntry {
  id: string;
  name: string;
  file: Blob;
  thumb: string | null;
  /** Métadonnées déjà sondées : un rechargement n'a pas à re-décoder le fichier. */
  media: Media;
}

const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff', 'aif'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif'];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible'));
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'));
  });
}

export async function putEntry(entry: LocalEntry): Promise<void> {
  const db = await openDb();
  await wrap(tx(db, 'readwrite').put(entry));
}

export async function getEntry(id: string): Promise<LocalEntry | undefined> {
  const db = await openDb();
  return wrap<LocalEntry | undefined>(tx(db, 'readonly').get(id));
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await openDb();
  await wrap(tx(db, 'readwrite').delete(id));
  const url = urls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(id);
  }
}

export async function allEntries(): Promise<LocalEntry[]> {
  const db = await openDb();
  return wrap<LocalEntry[]>(tx(db, 'readonly').getAll());
}

/**
 * Un `File` sorti d'un `<input type="file">` n'est pas une copie : le
 * navigateur garde une référence au chemin d'origine. Stocké tel quel dans
 * IndexedDB, il devient illisible (`NotFoundError`) dès que l'utilisateur
 * déplace ou supprime le fichier source — le média survit dans la
 * médiathèque mais ne se décode plus. On persiste donc une copie des octets,
 * la seule forme que le navigateur conserve réellement.
 */
export async function durableCopy(file: Blob): Promise<Blob> {
  if (!(file instanceof File)) return file;
  const bytes = await file.arrayBuffer();
  return new Blob([bytes], { type: file.type });
}

/** Vrai si les octets sont réellement présents (et non une référence morte). */
export async function isReadable(blob: Blob): Promise<boolean> {
  try {
    await blob.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/* ── URL d'objet, une seule par média (les révoquer en boucle fuit) ──────── */

const urls = new Map<string, string>();

export async function objectUrl(id: string): Promise<string | null> {
  const known = urls.get(id);
  if (known) return known;
  const entry = await getEntry(id);
  if (!entry) return null;
  const url = URL.createObjectURL(entry.file);
  urls.set(id, url);
  return url;
}

/* ── Sondage sans moteur ───────────────────────────────────────────────── */

export function kindFromName(name: string): MediaKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return 'video';
}

function once(element: HTMLElement, event: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('média illisible (délai dépassé)'));
    }, timeoutMs);
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('média illisible par le navigateur'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener('error', fail);
    };
    element.addEventListener(event, done, { once: true });
    element.addEventListener('error', fail, { once: true });
  });
}

async function probeImage(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  const ready = once(image, 'load');
  image.src = url;
  try {
    await ready;
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function probeVideo(file: Blob): Promise<{ durationUs: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  const ready = once(video, 'loadedmetadata');
  video.src = url;
  try {
    await ready;
    return {
      durationUs: Math.round((Number.isFinite(video.duration) ? video.duration : 0) * 1_000_000),
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

async function probeAudio(file: Blob): Promise<{ durationUs: number; sampleRate: number; channels: number }> {
  const url = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  const ready = once(audio, 'loadedmetadata');
  audio.src = url;
  let durationUs = 0;
  let sampleRate = 48_000;
  let channels = 2;
  try {
    await ready;
    durationUs = Math.round((Number.isFinite(audio.duration) ? audio.duration : 0) * 1_000_000);
  } finally {
    URL.revokeObjectURL(url);
    audio.removeAttribute('src');
    audio.load();
  }
  // Le taux d'échantillonnage et le nombre de canaux ne sont pas exposés par
  // `<audio>` : on décode réellement le fichier, sauf s'il est énorme (le
  // décodage tiendrait alors toute la piste en mémoire).
  if (file.size <= 80 * 1024 * 1024) {
    try {
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      sampleRate = buffer.sampleRate;
      channels = buffer.numberOfChannels;
      if (!durationUs) durationUs = Math.round(buffer.duration * 1_000_000);
      await context.close();
    } catch {
      // format non décodable par le navigateur : on garde les valeurs par défaut
    }
  }
  return { durationUs, sampleRate, channels };
}

/** Vignette JPEG (première image utile) — remplace `/api/media/:id/thumbnail`. */
export async function makeThumbnail(file: Blob, width = 320): Promise<string | null> {
  try {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const ready = once(video, 'loadeddata');
    video.src = url;
    try {
      await ready;
      const target = Number.isFinite(video.duration) && video.duration > 1 ? 0.5 : 0;
      if (target > 0) {
        const seeked = once(video, 'seeked');
        video.currentTime = target;
        await seeked.catch(() => undefined);
      }
      const scale = Math.min(1, width / (video.videoWidth || width));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((video.videoWidth || width) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || width) * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.75);
    } finally {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    }
  } catch {
    return null;
  }
}

/** Construit les métadonnées d'un fichier choisi par l'utilisateur. */
export async function probeLocal(file: File, id: string): Promise<Media> {
  const kind = kindFromName(file.name);
  const base: Media = {
    id,
    name: file.name,
    kind,
    path: '',
    duration_us: 0,
    width: 0,
    height: 0,
    fps: null,
    has_audio: kind !== 'image',
    sample_rate: 0,
    channels: 0,
    size_bytes: file.size,
  };

  if (kind === 'image') {
    const { width, height } = await probeImage(file);
    return { ...base, width, height, duration_us: 5_000_000, has_audio: false };
  }
  if (kind === 'audio') {
    const { durationUs, sampleRate, channels } = await probeAudio(file);
    return { ...base, duration_us: durationUs, sample_rate: sampleRate, channels };
  }
  const { durationUs, width, height } = await probeVideo(file);
  if (!durationUs) throw new Error(`${file.name} : durée illisible`);
  return { ...base, duration_us: durationUs, width, height };
}
