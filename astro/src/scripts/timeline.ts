/**
 * Timeline : rendu DOM et interactions (déplacement, rognage, playhead).
 *
 * Aucune donnée n'est dupliquée ici : la vérité reste `host.project`, en
 * microsecondes. Le zoom n'est qu'une projection pixels/seconde — il ne change
 * donc jamais un temps de montage.
 */

import type { Clip, Media, Project, Track } from './state';
import { t } from './i18n';
import {
  MIN_CLIP_US,
  US,
  clamp,
  clipEnd,
  formatTimecode,
  mediaById,
  quantize,
  timelineEnd,
} from './state';

export interface TimelineHost {
  readonly project: Project;
  timeUs: number;
  selectedClipId: string | null;
  zoom: number;
  snapEnabled: boolean;
  setTime: (timeUs: number) => void;
  selectClip: (clipId: string | null) => void;
  /** Après une mutation : preview + propriétés + sauvegarde. */
  afterEdit: () => void;
  /** Pendant un glissement : preview seulement (pas de reconstruction DOM). */
  duringEdit: () => void;
  addMediaToTrack: (mediaId: string, trackId: string, startUs: number) => void;
  toggleTrackMute: (trackId: string) => void;
  setTrackVolume: (trackId: string, volume: number) => void;
  toast: (message: string, kind?: 'info' | 'ok' | 'error') => void;
}

const ROW_HEIGHT = 64;
const EDGE = 8;

export class TimelineView {
  private host: TimelineHost;
  private headers: HTMLElement;
  private tracks: HTMLElement;
  private ruler: HTMLElement;
  private content: HTMLElement;
  private playhead: HTMLElement;
  private scroll: HTMLElement;
  private drag: DragState | null = null;

  constructor(
    host: TimelineHost,
    elements: {
      headers: HTMLElement;
      tracks: HTMLElement;
      ruler: HTMLElement;
      content: HTMLElement;
      playhead: HTMLElement;
      scroll: HTMLElement;
    },
  ) {
    this.host = host;
    this.headers = elements.headers;
    this.tracks = elements.tracks;
    this.ruler = elements.ruler;
    this.content = elements.content;
    this.playhead = elements.playhead;
    this.scroll = elements.scroll;
    this.bind();
    this.render();
  }

  get zoom(): number {
    return this.host.zoom;
  }

  private contentWidth(): number {
    const end = Math.max(timelineEnd(this.host.project), 20 * US);
    return Math.max(600, (end / US + 8) * this.zoom);
  }

  render(): void {
    this.content.style.width = `${this.contentWidth()}px`;
    this.renderRuler();
    this.renderHeaders();
    this.renderTracks();
    this.renderPlayhead();
  }

  private renderRuler(): void {
    const step = this.tickStep();
    const width = this.contentWidth();
    const count = Math.ceil(width / (step * this.zoom));
    const parts: string[] = [];
    for (let index = 0; index <= count; index += 1) {
      const time = index * step;
      parts.push(
        `<div class="tick" style="left:${time * this.zoom}px"><span>${formatTimecode(time * US)}</span></div>`,
      );
    }
    this.ruler.innerHTML = parts.join('');
  }

  private tickStep(): number {
    const zoom = this.zoom;
    if (zoom >= 320) return 0.25;
    if (zoom >= 160) return 0.5;
    if (zoom >= 80) return 1;
    if (zoom >= 40) return 2;
    if (zoom >= 20) return 5;
    return 10;
  }

  private renderHeaders(): void {
    const parts: string[] = ['<div class="header-spacer"></div>'];
    for (const track of this.host.project.tracks) {
      parts.push(`
        <div class="track-header ${track.kind}" data-track-id="${track.id}" data-kind="${track.kind}">
          <div class="track-title">
            <span class="track-kind" aria-hidden="true">
              <svg viewBox="0 0 24 24"><use href="#i-${track.kind === 'video' ? 'film' : 'music'}"></use></svg>
            </span>
            <span>${escapeHtml(track.name)}</span>
          </div>
          <div class="track-tools">
            <button class="track-mute ${track.muted ? 'is-on' : ''}" data-action="mute"
                    title="${escapeHtml(t(track.muted ? 'tl.unmute' : 'tl.mute'))}"
                    aria-label="${escapeHtml(t(track.muted ? 'tl.unmute' : 'tl.mute'))}">
              <svg viewBox="0 0 24 24"><use href="#i-${track.muted ? 'mute' : 'sound'}"></use></svg>
            </button>
            <input class="track-volume" type="range" min="0" max="200" value="${Math.round(
              track.volume * 100,
            )}" title="${escapeHtml(
              t('tl.trackVolume', { n: Math.round(track.volume * 100) }),
            )}" aria-label="${escapeHtml(t('tl.trackVolumeLabel'))}" />
          </div>
        </div>
      `);
    }
    this.headers.innerHTML = parts.join('');
  }

  private renderTracks(): void {
    const project = this.host.project;
    const parts: string[] = [];
    for (const track of project.tracks) {
      parts.push(
        `<div class="track-row ${track.kind}" data-track-id="${track.id}" style="height:${ROW_HEIGHT}px">`,
      );
      for (const clip of track.clips) {
        parts.push(this.clipHtml(project, track, clip));
      }
      parts.push('</div>');
    }
    this.tracks.innerHTML = parts.join('');
  }

  private clipHtml(project: Project, track: Track, clip: Clip): string {
    const left = (clip.start_us / US) * this.zoom;
    const width = Math.max(14, (clip.duration_us / US) * this.zoom);
    const selected = clip.id === this.host.selectedClipId ? 'selected' : '';
    const media = mediaById(project, clip.media);
    const label =
      clip.type === 'text'
        ? clip.text?.content || t('tl.textFallback')
        : clip.name || media?.name || clip.type;
    const meta =
      clip.type === 'text'
        ? t('tl.metaText')
        : clip.type === 'shape'
          ? clip.shape?.kind === 'ellipse'
            ? t('tl.metaEllipse')
            : t('tl.metaShape')
          : `${formatTimecode(clip.duration_us)}${media?.width ? ` · ${media.width}×${media.height}` : ''}`;

    const effectCount = clip.effects?.length ?? 0;
    const badges: string[] = [];
    if (effectCount > 0) {
      badges.push(
        `<span class="clip-badge" title="${escapeHtml(t('tl.badgeEffects', { n: effectCount }))}">FX${
          effectCount > 1 ? effectCount : ''
        }</span>`,
      );
    }
    if (clip.transition) {
      badges.push(
        `<span class="clip-badge" title="${escapeHtml(
          clip.transition.kind === 'dissolve'
            ? t('tl.badgeTransitionDissolve')
            : t('tl.badgeTransitionFade'),
        )}"><svg viewBox="0 0 24 24"><use href="#i-transition"></use></svg></span>`,
      );
    }
    if (clip.type === 'video' && clip.audio_muted) {
      badges.push(
        `<span class="clip-badge" title="${escapeHtml(
          t('tl.badgeMuted'),
        )}"><svg viewBox="0 0 24 24"><use href="#i-mute"></use></svg></span>`,
      );
    }

    return `
      <div class="clip ${clip.type} ${selected}" data-clip-id="${clip.id}" data-track-id="${track.id}"
           style="left:${left}px;width:${width}px" title="${escapeHtml(label)}">
        <div class="clip-trim left"></div>
        <div class="clip-body">
          <span class="clip-name">${escapeHtml(label)}</span>
          <span class="clip-meta">${escapeHtml(meta)}</span>
        </div>
        <div class="clip-badges">${badges.join('')}</div>
        <div class="clip-trim right"></div>
      </div>
    `;
  }

  renderPlayhead(): void {
    this.playhead.style.left = `${(this.host.timeUs / US) * this.zoom}px`;
  }

  updateClipElement(clip: Clip): void {
    const element = this.tracks.querySelector<HTMLElement>(
      `.clip[data-clip-id="${cssEscape(clip.id)}"]`,
    );
    if (!element) return;
    element.style.left = `${(clip.start_us / US) * this.zoom}px`;
    element.style.width = `${Math.max(14, (clip.duration_us / US) * this.zoom)}px`;
    const meta = element.querySelector('.clip-meta');
    if (meta && clip.type !== 'text' && clip.type !== 'shape') {
      meta.textContent = formatTimecode(clip.duration_us);
    }
  }

  /** Centre la vue sur le playhead si nécessaire. */
  ensureVisible(): void {
    const x = (this.host.timeUs / US) * this.zoom;
    const left = this.scroll.scrollLeft;
    const width = this.scroll.clientWidth;
    if (x < left + 40) this.scroll.scrollLeft = Math.max(0, x - 120);
    else if (x > left + width - 40) this.scroll.scrollLeft = x - width + 160;
  }

  private timeFromEvent(event: PointerEvent | DragEvent, row?: HTMLElement): number {
    const bounds = (row ?? this.content).getBoundingClientRect();
    return Math.max(0, (event.clientX - bounds.left) / this.zoom) * US;
  }

  private bind(): void {
    this.ruler.addEventListener('pointerdown', (event) => {
      this.host.setTime(this.timeFromEvent(event));
      const move = (moveEvent: PointerEvent) => this.host.setTime(this.timeFromEvent(moveEvent));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    this.tracks.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      const clipElement = target.closest<HTMLElement>('.clip');
      const row = target.closest<HTMLElement>('.track-row');
      if (!row) return;
      if (!clipElement) {
        this.host.selectClip(null);
        this.host.setTime(this.timeFromEvent(event, row));
        return;
      }
      const clipId = clipElement.dataset.clipId;
      if (!clipId) return;
      const found = this.findClip(clipId);
      if (!found) return;
      this.host.selectClip(clipId);

      const rect = clipElement.getBoundingClientRect();
      let mode: DragMode = 'move';
      if (target.classList.contains('clip-trim')) {
        mode = target.classList.contains('left') ? 'trim-left' : 'trim-right';
      } else if (event.clientX - rect.left <= EDGE) {
        mode = 'trim-left';
      } else if (rect.right - event.clientX <= EDGE) {
        mode = 'trim-right';
      }

      this.drag = {
        mode,
        clip: found.clip,
        track: found.track,
        startX: event.clientX,
        originalStart: found.clip.start_us,
        originalDuration: found.clip.duration_us,
        originalSource: found.clip.source_start_us,
        moved: false,
        snapPoints: this.snapPoints(found.clip.id),
      };
      clipElement.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    this.tracks.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const drag = this.drag;
      const deltaUs = ((event.clientX - drag.startX) / this.zoom) * US;
      if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
      const media = mediaById(this.host.project, drag.clip.media);
      const maxDuration = this.maxDuration(drag.clip, media);

      if (drag.mode === 'move') {
        let start = Math.max(0, drag.originalStart + deltaUs);
        if (this.host.snapEnabled) {
          const snapped = this.snap(start, drag.originalDuration, drag.snapPoints);
          if (snapped !== null) start = snapped;
        }
        drag.clip.start_us = Math.max(0, quantize(start));
      } else if (drag.mode === 'trim-left') {
        const mediaType = drag.clip.type === 'video' || drag.clip.type === 'audio';
        const minDelta = mediaType
          ? Math.max(-drag.originalStart, -drag.originalSource)
          : -drag.originalStart;
        const maxDelta = drag.originalDuration - MIN_CLIP_US;
        let bounded = clamp(deltaUs, minDelta, maxDelta);
        if (this.host.snapEnabled) {
          const snapped = this.snap(drag.originalStart + bounded, 0, drag.snapPoints);
          if (snapped !== null) bounded = clamp(snapped - drag.originalStart, minDelta, maxDelta);
        }
        drag.clip.start_us = Math.max(0, quantize(drag.originalStart + bounded));
        drag.clip.duration_us = Math.max(MIN_CLIP_US, quantize(drag.originalDuration - bounded));
        drag.clip.source_start_us = Math.max(0, quantize(drag.originalSource + bounded));
      } else {
        let bounded = clamp(
          deltaUs,
          MIN_CLIP_US - drag.originalDuration,
          maxDuration - drag.originalDuration,
        );
        if (this.host.snapEnabled) {
          const candidateEnd = drag.originalStart + drag.originalDuration + bounded;
          const snapped = this.snap(candidateEnd, 0, drag.snapPoints);
          if (snapped !== null) {
            bounded = clamp(
              snapped - drag.originalStart - drag.originalDuration,
              MIN_CLIP_US - drag.originalDuration,
              maxDuration - drag.originalDuration,
            );
          }
        }
        drag.clip.duration_us = Math.max(
          MIN_CLIP_US,
          quantize(Math.min(drag.originalDuration + bounded, maxDuration)),
        );
      }

      this.updateClipElement(drag.clip);
      this.host.duringEdit();
    });

    const finish = () => {
      if (!this.drag) return;
      const drag = this.drag;
      this.drag = null;
      drag.track.clips.sort((a, b) => a.start_us - b.start_us);
      if (drag.moved) this.host.afterEdit();
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);

    this.headers.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const header = target.closest<HTMLElement>('.track-header');
      if (!header) return;
      const trackId = header.dataset.trackId;
      if (trackId && target.closest('[data-action="mute"]')) this.host.toggleTrackMute(trackId);
    });
    this.headers.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      if (!target.classList.contains('track-volume')) return;
      const header = target.closest<HTMLElement>('.track-header');
      const trackId = header?.dataset.trackId;
      if (trackId) this.host.setTrackVolume(trackId, Number(target.value) / 100);
    });

    this.tracks.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('application/x-ctf-media')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const row = (event.target as HTMLElement).closest<HTMLElement>('.track-row');
      this.tracks
        .querySelectorAll('.track-row.drop')
        .forEach((element) => element.classList.remove('drop'));
      row?.classList.add('drop');
    });
    this.tracks.addEventListener('dragleave', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('.track-row');
      row?.classList.remove('drop');
    });
    this.tracks.addEventListener('drop', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('.track-row');
      const trackId = row?.dataset.trackId;
      const mediaId = event.dataTransfer?.getData('application/x-ctf-media');
      if (!row || !trackId || !mediaId) return;
      event.preventDefault();
      row.classList.remove('drop');
      this.host.addMediaToTrack(mediaId, trackId, this.timeFromEvent(event, row));
    });
  }

  private snapPoints(excludeClipId: string): number[] {
    const points = [0, this.host.timeUs];
    for (const track of this.host.project.tracks) {
      for (const clip of track.clips) {
        if (clip.id === excludeClipId) continue;
        points.push(clip.start_us, clipEnd(clip));
      }
    }
    return points;
  }

  private snap(value: number, duration: number, points: number[]): number | null {
    const threshold = (EDGE / this.zoom) * US;
    let best: number | null = null;
    let bestDistance = threshold;
    for (const point of points) {
      const head = Math.abs(value - point);
      if (head < bestDistance) {
        bestDistance = head;
        best = point;
      }
      const tail = Math.abs(value + duration - point);
      if (tail < bestDistance) {
        bestDistance = tail;
        best = point - duration;
      }
    }
    return best;
  }

  private maxDuration(clip: Clip, media: Media | undefined): number {
    if (clip.type === 'video' || clip.type === 'audio') {
      const source = media?.duration_us || clip.source_start_us + clip.duration_us;
      return Math.max(MIN_CLIP_US, source - clip.source_start_us);
    }
    return 600 * US;
  }

  private findClip(clipId: string): { clip: Clip; track: Track } | null {
    for (const track of this.host.project.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (clip) return { clip, track };
    }
    return null;
  }
}

interface DragState {
  mode: DragMode;
  clip: Clip;
  track: Track;
  startX: number;
  originalStart: number;
  originalDuration: number;
  originalSource: number;
  moved: boolean;
  snapPoints: number[];
}

type DragMode = 'move' | 'trim-left' | 'trim-right';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
