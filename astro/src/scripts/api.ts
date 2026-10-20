/** Accès à l'API du moteur Rust (mêmes origines en production). */

import type { ExportFormat, Media, Project } from './state';

const params = new URLSearchParams(location.search);
const devPort = location.port === '4321' || location.port === '4322';
export const API_BASE =
  params.get('api') || (devPort ? 'http://127.0.0.1:7317' : '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
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

export async function health(): Promise<{
  ok: boolean;
  version: string;
  ffmpeg: string;
  font: string | null;
  media: number;
}> {
  return parse(await fetch(apiUrl('/api/health')));
}

export async function listMedia(): Promise<Media[]> {
  const payload = await parse<{ media: Media[] }>(await fetch(apiUrl('/api/media')));
  return payload.media || [];
}

export function importMedia(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Media> {
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

export async function deleteMedia(id: string): Promise<void> {
  await parse(await fetch(apiUrl(`/api/media/${encodeURIComponent(id)}`), { method: 'DELETE' }));
}

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

export function mediaUrl(id: string): string {
  return apiUrl(`/api/media/${encodeURIComponent(id)}`);
}

export function thumbnailUrl(id: string): string {
  return apiUrl(`/api/media/${encodeURIComponent(id)}/thumbnail`);
}

export function waveformUrl(id: string, points = 900): string {
  return apiUrl(`/api/media/${encodeURIComponent(id)}/waveform?points=${points}`);
}
