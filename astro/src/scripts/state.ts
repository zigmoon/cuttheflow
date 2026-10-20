/**
 * Modèle de projet côté interface — miroir exact des structures Rust
 * (`crates/ctf-core/src/model.rs`). Les temps sont en **microsecondes** et la
 * cadence est un rationnel : rien n'est arrondi à la milliseconde, donc les
 * coupes restent exactes quel que soit le zoom ou la durée.
 */

export interface Fps {
  num: number;
  den: number;
}

export type MediaKind = 'video' | 'audio' | 'image';
export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'shape';
export type TrackKind = 'video' | 'audio';
export type ExportFormat = 'mp4' | 'webm' | 'mp3';
export type ShapeKind = 'rect' | 'ellipse';
export type TransitionKind = 'fade' | 'dissolve';

export interface Media {
  id: string;
  name: string;
  kind: MediaKind;
  path: string;
  duration_us: number;
  width: number;
  height: number;
  fps: Fps | null;
  has_audio: boolean;
  sample_rate: number;
  channels: number;
  size_bytes: number;
}

export interface TextStyle {
  content: string;
  size: number;
  color: string;
  background?: string | null;
}

export interface ShapeStyle {
  kind: ShapeKind;
  color: string;
  /** Fractions du canevas (0.5 = 50 %). */
  width: number;
  height: number;
  /** Arrondi des coins, en fraction de la petite dimension (0 → 0.5). */
  radius: number;
}

export interface Effect {
  name: string;
  /** 0 → 1 */
  amount: number;
}

export interface Transition {
  kind: TransitionKind;
  duration_us: number;
}

export interface Clip {
  id: string;
  type: ClipKind;
  name: string;
  media?: string | null;
  start_us: number;
  duration_us: number;
  source_start_us: number;
  volume: number;
  fade_in_us: number;
  fade_out_us: number;
  scale: number;
  x: number;
  y: number;
  opacity: number;
  audio_muted: boolean;
  text?: TextStyle | null;
  shape?: ShapeStyle | null;
  effects?: Effect[];
  transition?: Transition | null;
  rotation: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  volume: number;
  clips: Clip[];
}

export interface ExportSettings {
  format: ExportFormat;
  crf: number;
  preset: string;
}

export interface Project {
  version: number;
  name: string;
  width: number;
  height: number;
  fps: Fps;
  background: string;
  tracks: Track[];
  media: Media[];
  export: ExportSettings;
}

export const US = 1_000_000;
export const MIN_CLIP_US = 100_000;

let counter = 0;

export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function fps(value: number): Fps {
  if (Math.abs(value - 29.97) < 0.01) return { num: 30000, den: 1001 };
  if (Math.abs(value - 23.976) < 0.01) return { num: 24000, den: 1001 };
  if (Math.abs(value - 59.94) < 0.01) return { num: 60000, den: 1001 };
  return { num: Math.round(value), den: 1 };
}

export function fpsValue(value: Fps | null | undefined): number {
  if (!value || !value.num || !value.den) return 30;
  return value.num / value.den;
}

export function formatTimecode(us: number): string {
  const value = Math.max(0, Math.round(us));
  const totalMs = Math.round(value / 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function quantize(us: number, step = 10_000): number {
  return Math.round(us / step) * step;
}

export function parseSeconds(value: string): number {
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * US)) : 0;
}

export function timelineEnd(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start_us + clip.duration_us);
  }
  return end;
}

export function mediaById(project: Project, id: string | null | undefined): Media | undefined {
  if (!id) return undefined;
  return project.media.find((media) => media.id === id);
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

export function clipEnd(clip: Clip): number {
  return clip.start_us + clip.duration_us;
}

export function activeClip(track: Track, timeUs: number): Clip | undefined {
  let found: Clip | undefined;
  for (const clip of track.clips) {
    if (timeUs >= clip.start_us && timeUs < clipEnd(clip)) found = clip;
  }
  return found;
}

export function trackAcceptsMedia(track: Track, media: Media): boolean {
  if (track.kind === 'audio') return media.kind === 'audio';
  return media.kind === 'video' || media.kind === 'image';
}

export function defaultDuration(media: Media): number {
  if (media.kind === 'image') return 5 * US;
  return Math.max(MIN_CLIP_US, media.duration_us || 5 * US);
}

export function createClip(media: Media, startUs: number): Clip {
  return {
    ...baseClip('c', media.kind, startUs, defaultDuration(media)),
    name: media.name,
    media: media.id,
  };
}

export function createTextClip(startUs: number): Clip {
  return {
    ...baseClip('t', 'text', startUs, 3 * US),
    name: 'Text',
    text: { content: 'YOUR TITLE', size: 96, color: '#FFFFFF', background: null },
  };
}

export function createShapeClip(startUs: number, kind: ShapeKind = 'rect'): Clip {
  return {
    ...baseClip('s', 'shape', startUs, 3 * US),
    name: kind === 'ellipse' ? 'Ellipse' : 'Rectangle',
    shape: {
      kind,
      color: '#F0F0F2',
      width: 0.42,
      height: 0.42,
      radius: kind === 'ellipse' ? 0.5 : 0.06,
    },
  };
}

function baseClip(prefix: string, type: ClipKind, startUs: number, durationUs: number): Clip {
  return {
    id: uid(prefix),
    type,
    name: '',
    media: null,
    start_us: Math.max(0, startUs),
    duration_us: durationUs,
    source_start_us: 0,
    volume: 1,
    fade_in_us: 0,
    fade_out_us: 0,
    scale: 1,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    audio_muted: false,
    text: null,
    shape: null,
    effects: [],
    transition: null,
    rotation: 0,
  };
}

export function createProject(): Project {
  return {
    version: 1,
    name: 'Untitled',
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
    background: '#000000',
    tracks: [
      { id: uid('v'), kind: 'video', name: 'VIDEO 1', muted: false, volume: 1, clips: [] },
      { id: uid('a'), kind: 'audio', name: 'AUDIO 1', muted: false, volume: 1, clips: [] },
    ],
    media: [],
    export: { format: 'mp4', crf: 18, preset: 'medium' },
  };
}

export function firstTrackFor(project: Project, media: Media): Track | undefined {
  return project.tracks.find((track) => trackAcceptsMedia(track, media));
}

/** Place un clip sans chevaucher les clips existants de la piste. */
export function placeClip(track: Track, clip: Clip, preferredStart: number): void {
  let start = Math.max(0, preferredStart);
  const collides = (candidate: number) =>
    track.clips.some(
      (existing) =>
        candidate < clipEnd(existing) && candidate + clip.duration_us > existing.start_us,
    );
  let guard = 0;
  while (collides(start) && guard < 10_000) {
    const blocking = track.clips
      .filter(
        (existing) =>
          start < clipEnd(existing) && start + clip.duration_us > existing.start_us,
      )
      .sort((a, b) => clipEnd(a) - clipEnd(b))[0];
    if (!blocking) break;
    start = clipEnd(blocking);
    guard += 1;
  }
  clip.start_us = quantize(start);
  track.clips.push(clip);
  track.clips.sort((a, b) => a.start_us - b.start_us);
}

export function duplicateClip(clip: Clip): Clip {
  return {
    ...clip,
    id: uid(clip.type.charAt(0)),
    start_us: clip.start_us + clip.duration_us,
    text: clip.text ? { ...clip.text } : null,
    shape: clip.shape ? { ...clip.shape } : null,
    effects: clip.effects ? clip.effects.map((effect) => ({ ...effect })) : [],
    transition: clip.transition ? { ...clip.transition } : null,
  };
}

/** Charge un projet en complétant les champs absents (anciens fichiers, édition manuelle). */
export function normalizeProject(input: unknown): Project {
  const raw = (input ?? {}) as Partial<Project>;
  const project = createProject();
  project.version = 1;
  project.name = typeof raw.name === 'string' && raw.name ? raw.name : project.name;
  project.width = even(Number(raw.width) || project.width);
  project.height = even(Number(raw.height) || project.height);
  if (raw.fps && raw.fps.num && raw.fps.den) project.fps = { num: raw.fps.num, den: raw.fps.den };
  project.background = typeof raw.background === 'string' ? raw.background : project.background;
  project.export = {
    format: ['mp4', 'webm', 'mp3'].includes(String(raw.export?.format))
      ? (raw.export!.format as ExportFormat)
      : 'mp4',
    crf: Number(raw.export?.crf) || 18,
    preset: raw.export?.preset || 'medium',
  };
  project.media = Array.isArray(raw.media)
    ? raw.media.map((media) => ({
        ...media,
        path: '',
        fps: media.fps ?? null,
        has_audio: Boolean(media.has_audio),
        sample_rate: Number(media.sample_rate) || 0,
        channels: Number(media.channels) || 0,
        size_bytes: Number(media.size_bytes) || 0,
      }))
    : [];
  project.tracks = Array.isArray(raw.tracks) && raw.tracks.length
    ? raw.tracks.map((track) => ({
        id: track.id || uid('v'),
        kind: track.kind === 'audio' ? 'audio' : 'video',
        name: track.name || 'PISTE',
        muted: Boolean(track.muted),
        volume: numberOr(track.volume, 1),
        clips: Array.isArray(track.clips) ? track.clips.map((clip) => normalizeClip(clip)) : [],
      }))
    : project.tracks;
  return project;
}

function normalizeClip(raw: Clip): Clip {
  return {
    id: raw.id || uid('c'),
    type: (['video', 'image', 'audio', 'text', 'shape'].includes(raw.type) ? raw.type : 'video') as ClipKind,
    name: raw.name || '',
    media: raw.media ?? null,
    start_us: Math.max(0, Number(raw.start_us) || 0),
    duration_us: Math.max(MIN_CLIP_US, Number(raw.duration_us) || MIN_CLIP_US),
    source_start_us: Math.max(0, Number(raw.source_start_us) || 0),
    volume: numberOr(raw.volume, 1),
    fade_in_us: Math.max(0, Number(raw.fade_in_us) || 0),
    fade_out_us: Math.max(0, Number(raw.fade_out_us) || 0),
    scale: numberOr(raw.scale, 1),
    x: numberOr(raw.x, 0.5),
    y: numberOr(raw.y, 0.5),
    opacity: numberOr(raw.opacity, 1),
    audio_muted: Boolean(raw.audio_muted),
    text: raw.type === 'text'
      ? {
          content: raw.text?.content ?? 'TEXTE',
          size: Number(raw.text?.size) || 96,
          color: raw.text?.color || '#FFFFFF',
          background: raw.text?.background ?? null,
        }
      : null,
    shape: raw.type === 'shape'
      ? {
          kind: raw.shape?.kind === 'ellipse' ? 'ellipse' : 'rect',
          color: raw.shape?.color || '#F0F0F2',
          width: clamp(Number(raw.shape?.width) || 0.42, 0.01, 2),
          height: clamp(Number(raw.shape?.height) || 0.42, 0.01, 2),
          radius: clamp(Number(raw.shape?.radius) || 0, 0, 0.5),
        }
      : null,
    effects: Array.isArray(raw.effects)
      ? raw.effects
          .filter((effect) => effect && typeof effect.name === 'string')
          .slice(0, 8)
          .map((effect) => ({ name: effect.name, amount: clamp(Number(effect.amount) || 0.5, 0, 1) }))
      : [],
    transition: raw.transition && raw.transition.kind
      ? {
          kind: raw.transition.kind === 'dissolve' ? 'dissolve' : 'fade',
          duration_us: Math.max(50_000, Number(raw.transition.duration_us) || 500_000),
        }
      : null,
    rotation: clamp(Number(raw.rotation) || 0, -360, 360),
  };
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

// ── Transitions : même résolution que le plan Rust ────────────────────────

export interface Placement {
  start_us: number;
  source_start_us: number;
  duration_us: number;
  fade_in_us: number;
  dissolve_us: number;
}

/**
 * Rejoue exactement `plan.rs` côté navigateur.
 *
 * Pourquoi dupliquer cette logique : la preview doit montrer ce que l'export
 * produira, y compris le recouvrement d'un fondu enchaîné (fenêtre ET point
 * d'entrée source décalés du même `d`). Sans cela, l'aperçu mentirait pendant
 * la transition.
 */
export function resolvePlacements(project: Project): Map<string, Placement> {
  const out = new Map<string, Placement>();

  for (const track of project.tracks) {
    const sorted = [...track.clips].sort(
      (a, b) => a.start_us - b.start_us || a.id.localeCompare(b.id),
    );
    const placements: Placement[] = sorted.map((clip) => ({
      start_us: clip.start_us,
      source_start_us: clip.source_start_us,
      duration_us: clip.duration_us,
      fade_in_us:
        clip.transition?.kind === 'fade'
          ? Math.min(clip.duration_us, Math.max(clip.fade_in_us, clip.transition.duration_us))
          : Math.min(clip.duration_us, clip.fade_in_us),
      dissolve_us: 0,
    }));

    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      const previous = sorted[index - 1];
      if (!current.transition || current.transition.kind !== 'dissolve') continue;
      if (!isVisual(current) || !isVisual(previous)) continue;
      if (placements[index - 1].start_us + placements[index - 1].duration_us !== placements[index].start_us) {
        continue;
      }

      const previousMedia = mediaById(project, previous.media);
      const handleAfter = previousMedia
        ? Math.max(0, previousMedia.duration_us - (previous.source_start_us + previous.duration_us))
        : Number.MAX_SAFE_INTEGER;

      let d = current.transition.duration_us;
      d = Math.min(d, current.source_start_us);
      d = Math.min(d, handleAfter);
      d = Math.min(d, current.duration_us / 2);
      d = Math.min(d, previous.duration_us / 2);
      d = Math.max(0);

      if (d === 0) {
        placements[index].fade_in_us = Math.max(
          placements[index].fade_in_us,
          Math.min(current.transition.duration_us, current.duration_us / 2),
        );
        continue;
      }

      placements[index].start_us -= d;
      placements[index].source_start_us -= d;
      placements[index].dissolve_us = d;
      placements[index].fade_in_us = Math.max(placements[index].fade_in_us, d);
    }

    sorted.forEach((clip, index) => out.set(clip.id, placements[index]));
  }

  return out;
}

function isVisual(clip: Clip): boolean {
  return clip.type === 'video' || clip.type === 'image' || clip.type === 'text' || clip.type === 'shape';
}

// ── Catalogues partagés par l'interface ───────────────────────────────────

export interface EffectDefinition {
  name: string;
  /** Rendu approximatif de la preview canvas. */
  preview: 'blur' | 'contrast' | 'vignette' | 'brightness' | 'grayscale' | 'sepia' | 'hue' | 'invert' | 'mirror' | 'flip' | 'none';
}

/** Les libellés vivent dans `i18n.ts` (clés `fx.<name>.label` / `.hint`). */
export const EFFECTS: EffectDefinition[] = [
  { name: 'blur', preview: 'blur' },
  { name: 'sharpen', preview: 'contrast' },
  { name: 'vignette', preview: 'vignette' },
  { name: 'grain', preview: 'none' },
  { name: 'brightness', preview: 'brightness' },
  { name: 'grayscale', preview: 'grayscale' },
  { name: 'sepia', preview: 'sepia' },
  { name: 'warm', preview: 'sepia' },
  { name: 'cool', preview: 'hue' },
  { name: 'invert', preview: 'invert' },
  { name: 'mirror', preview: 'mirror' },
  { name: 'flip', preview: 'flip' },
  { name: 'pixelate', preview: 'none' },
];

/** Les libellés vivent dans `i18n.ts` (clés `tr.<kind>.label` / `.hint`). */
export const TRANSITIONS: Array<{ kind: TransitionKind }> = [
  { kind: 'fade' },
  { kind: 'dissolve' },
];
