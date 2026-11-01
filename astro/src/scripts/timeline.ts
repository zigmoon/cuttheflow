/**
 * Timeline : rendu DOM et interactions (déplacement, rognage, playhead).
 *
 * Aucune donnée n'est dupliquée ici : la vérité reste `host.project`, en
 * microsecondes. Le zoom n'est qu'une projection pixels/seconde — il ne change
 * donc jamais un temps de montage.
 */

import type { Clip, Media, Project, Track } from './state';import { t } from './i18n';
import { waveformPeaks } from './api';
import {
  MIN_CLIP_US,
  US,
  clamp,
  clipEnd,
  clipSpeed,
  defaultDuration,
  formatTimecode,
  hasKeyframes,
  mediaById,
  quantize,
  slotFree,
  timelineEnd,
  trackAcceptsMedia,
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
  addMediaToTrack: (
    mediaId: string,
    trackId: string | null,
    startUs: number,
    options?: { newTrack?: boolean },
  ) => void;
  toggleTrackMute: (trackId: string) => void;
  setTrackVolume: (trackId: string, volume: number) => void;
  /** Zoom molette centré sur un instant : `offsetPx` = position du curseur dans la vue. */
  zoomTimeline: (factor: number, anchorUs: number, offsetPx: number) => void;
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
  private scrub: HTMLElement | null;
  private scrubFill: HTMLElement | null;
  private scrubKnob: HTMLElement | null;
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
      scrub?: HTMLElement | null;
      scrubFill?: HTMLElement | null;
      scrubKnob?: HTMLElement | null;
    },
  ) {
    this.host = host;
    this.headers = elements.headers;
    this.tracks = elements.tracks;
    this.ruler = elements.ruler;
    this.content = elements.content;
    this.playhead = elements.playhead;
    this.scroll = elements.scroll;
    this.scrub = elements.scrub ?? null;
    this.scrubFill = elements.scrubFill ?? null;
    this.scrubKnob = elements.scrubKnob ?? null;
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
    // Une reconstruction remplace les éléments : un geste en cours n'a plus
    // d'élément à suivre. Sans cette remise à zéro, un `pointermove` ultérieur
    // déplaçait encore le clip — sans passer par l'historique, donc impossible
    // à annuler.
    this.drag = null;
    this.clearTrackHints();
    this.clearDropHints();
    this.content.style.width = `${this.contentWidth()}px`;
    this.renderRuler();
    this.renderHeaders();
    this.renderTracks();
    this.renderPlayhead();
    this.paintWaveforms();
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

  /**
   * Intervalle des graduations, choisi parmi des pas « ronds » pour qu'un tick
   * fasse toujours ~60 px à l'écran, du dézoom extrême (0,25 px/s) au zoom fin.
   */
  private tickStep(): number {
    const steps = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    const target = 60;
    for (const step of steps) {
      if (step * this.zoom >= target) return step;
    }
    return steps[steps.length - 1];
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
        `<div class="track-row ${track.kind}" data-track-id="${track.id}" data-kind="${track.kind}" style="height:${ROW_HEIGHT}px">`,
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
    const speed = clipSpeed(clip);
    if (Math.abs(speed - 1) > 0.01) {
      badges.push(
        `<span class="clip-badge speed" title="${escapeHtml(
          t('badge.speed', { speed: Number(speed.toFixed(2)) }),
        )}">${Number(speed.toFixed(2))}×</span>`,
      );
    }
    if (clip.mask) {
      badges.push(
        `<span class="clip-badge mask" title="${escapeHtml(t('badge.mask'))}">◱</span>`,
      );
    }
    if (hasKeyframes(clip)) {
      badges.push(
        `<span class="clip-badge kf" title="${escapeHtml(
          t('badge.keyframes', { n: clip.keyframes?.length ?? 0 }),
        )}">◆</span>`,
      );
    }

    const wantsWave =
      (clip.type === 'audio' || (clip.type === 'video' && !clip.audio_muted)) &&
      Boolean(media?.has_audio);

    return `
      <div class="clip ${clip.type} ${selected}" data-clip-id="${clip.id}" data-track-id="${track.id}"
           style="left:${left}px;width:${width}px" title="${escapeHtml(label)}">
        <div class="clip-trim left"></div>
        ${
          wantsWave
            ? `<canvas class="clip-wave" data-wave="${clip.id}" width="${Math.round(width)}" height="${ROW_HEIGHT - 22}"></canvas>`
            : ''
        }
        <div class="clip-body">
          <span class="clip-name">${escapeHtml(label)}</span>
          <span class="clip-meta">${escapeHtml(meta)}</span>
        </div>
        <div class="clip-badges">${badges.join('')}</div>
        <div class="clip-trim right"></div>
      </div>
    `;
  }

  /**
   * Dessine la forme d'onde des clips audio (pics décodés une seule fois par
   * média, puis réutilisés à chaque redessin / zoom).
   */
  private paintWaveforms(): void {
    const canvases = this.tracks.querySelectorAll<HTMLCanvasElement>('canvas[data-wave]');
    if (!canvases.length) return;
    for (const canvas of canvases) {
      const clipId = canvas.dataset.wave ?? '';
      const found = this.clipById(clipId);
      if (!found) continue;
      const media = mediaById(this.host.project, found.clip.media);
      if (!media) continue;
      const key = `${media.id}:${media.duration_us}:${canvas.width}`;
      if (canvas.dataset.painted === key) continue;
      void waveformPeaks(media.id).then((peaks) => {
        if (!peaks || !peaks.length) return;
        // Le clip a pu être supprimé ou rogné entre-temps.
        if (!canvas.isConnected) return;
        this.drawWave(canvas, found.clip, media, peaks);
        canvas.dataset.painted = key;
      });
    }
  }

  private clipById(clipId: string): { clip: Clip } | undefined {
    for (const track of this.host.project.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (clip) return { clip };
    }
    return undefined;
  }

  private drawWave(
    canvas: HTMLCanvasElement,
    clip: Clip,
    media: Media,
    peaks: number[],
  ): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const span = Math.max(1, media.duration_us);
    const speed = clipSpeed(clip);
    context.fillStyle = 'rgba(255,255,255,0.42)';
    for (let x = 0; x < width; x += 1) {
      const sourceUs = clip.source_start_us + (x / width) * clip.duration_us * speed;
      const index = Math.min(
        peaks.length - 1,
        Math.max(0, Math.round((sourceUs / span) * (peaks.length - 1))),
      );
      const amplitude = (peaks[index] ?? 0) * (height / 2) * 0.94;
      context.fillRect(x, height / 2 - amplitude, 1, Math.max(1, amplitude * 2));
    }
  }

  renderPlayhead(): void {
    this.playhead.style.left = `${(this.host.timeUs / US) * this.zoom}px`;
    this.renderScrub();
  }

  /** Position de la tête de lecture sur la règle compacte (pleine durée). */
  private renderScrub(): void {
    if (!this.scrubFill || !this.scrubKnob) return;
    const end = Math.max(1, timelineEnd(this.host.project));
    const ratio = clamp(this.host.timeUs / end, 0, 1);
    this.scrubFill.style.width = `${ratio * 100}%`;
    this.scrubKnob.style.left = `${ratio * 100}%`;
  }

  /** Instant visé par un clic sur la règle compacte (mappé sur la durée totale). */
  private scrubTime(event: PointerEvent): number {
    if (!this.scrub) return 0;
    const bounds = this.scrub.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left - 12) / Math.max(1, bounds.width - 24), 0, 1);
    return ratio * Math.max(0, timelineEnd(this.host.project));
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

  private timeFromEvent(event: PointerEvent | DragEvent, row?: HTMLElement | null): number {
    const bounds = (row ?? this.content).getBoundingClientRect();
    return Math.max(0, (event.clientX - bounds.left) / this.zoom) * US;
  }

  private bind(): void {
    // La règle et la tête de lecture partagent le même geste : cliquer ou tirer
    // déplace le temps, y compris pendant la lecture.
    const scrubFrom = (element: HTMLElement, compute: (event: PointerEvent) => number): void => {
      element.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        (element.closest('.timeline-scrub') ?? element).classList.add('is-scrubbing');
        this.host.setTime(compute(event));
        const move = (moveEvent: PointerEvent) => this.host.setTime(compute(moveEvent));
        const up = () => {
          (element.closest('.timeline-scrub') ?? element).classList.remove('is-scrubbing');
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    };

    scrubFrom(this.ruler, (event) => this.timeFromEvent(event));
    scrubFrom(this.playhead, (event) => {
      const bounds = this.content.getBoundingClientRect();
      return Math.max(0, (event.clientX - bounds.left) / this.zoom) * US;
    });
    if (this.scrub) {
      scrubFrom(this.scrub, (event) => this.scrubTime(event));
      // Bulle d'aide : l'instant visé, sans avoir à relâcher.
      const strip = this.scrub;
      strip.addEventListener('pointermove', (event) => {
        const target = this.scrubTime(event);
        strip.title = strip.classList.contains('is-scrubbing')
          ? formatTimecode(this.host.timeUs)
          : formatTimecode(target);
      });
    }

    this.tracks.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      const clipElement = target.closest<HTMLElement>('.clip');
      const row = target.closest<HTMLElement>('.track-row');
      if (!row) return;      if (!clipElement) {
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
        startY: event.clientY,
        originalStart: found.clip.start_us,
        originalDuration: found.clip.duration_us,
        originalSource: found.clip.source_start_us,
        moved: false,
        touchedTracks: new Set([found.track.id]),
        rows: this.rowBounds(),
        snapPoints: this.snapPoints(found.clip.id),
      };
      // La capture du pointeur garde le geste vivant même quand l'élément change
      // de piste (donc de parent). Elle échoue sur un `pointerId` synthétique
      // (test automatisé) : le glissement doit rester fonctionnel malgré tout.
      try {
        clipElement.setPointerCapture(event.pointerId);
      } catch {
        // pointeur inconnu : on continue sans capture
      }
      event.preventDefault();
    });

    this.tracks.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const drag = this.drag;
      const deltaUs = ((event.clientX - drag.startX) / this.zoom) * US;
      if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
      if (Math.abs(event.clientY - drag.startY) > 2) drag.moved = true;
      const media = mediaById(this.host.project, drag.clip.media);
      const maxDuration = this.maxDuration(drag.clip, media);

      if (drag.mode === 'move') {
        let start = Math.max(0, drag.originalStart + deltaUs);
        if (this.host.snapEnabled) {
          const snapped = this.snap(start, drag.originalDuration, drag.snapPoints);
          if (snapped !== null) start = snapped;
        }
        drag.clip.start_us = Math.max(0, quantize(start));
        // ── Changement de piste ────────────────────────────────────────
        // Un glissement vertical fait passer le clip d'une ligne à l'autre,
        // comme dans un montage classique. Seules les pistes qui acceptent le
        // type du clip sont visées : un clip vidéo ne tombe pas sur une piste
        // audio (son contenu n'y serait plus rendu ni exporté).
        this.followPointerTrack(event.clientY, drag);
      } else if (drag.mode === 'trim-left') {
        const mediaType = drag.clip.type === 'video' || drag.clip.type === 'audio';
        const speed = clipSpeed(drag.clip);
        // Rogner la gauche avance aussi dans la source, à la vitesse du clip.
        const minDelta = mediaType
          ? Math.max(-drag.originalStart, -drag.originalSource / speed)
          : -drag.originalStart;
        const maxDelta = drag.originalDuration - MIN_CLIP_US;
        let bounded = clamp(deltaUs, minDelta, maxDelta);
        if (this.host.snapEnabled) {
          const snapped = this.snap(drag.originalStart + bounded, 0, drag.snapPoints);
          if (snapped !== null) bounded = clamp(snapped - drag.originalStart, minDelta, maxDelta);
        }
        drag.clip.start_us = Math.max(0, quantize(drag.originalStart + bounded));
        drag.clip.duration_us = Math.max(MIN_CLIP_US, quantize(drag.originalDuration - bounded));
        drag.clip.source_start_us = Math.max(
          0,
          quantize(drag.originalSource + bounded * speed),
        );
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
      for (const trackId of drag.touchedTracks) {
        const track = this.host.project.tracks.find((candidate) => candidate.id === trackId);
        if (track) track.clips.sort((a, b) => a.start_us - b.start_us);
      }
      this.clearTrackHints();
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

    // ── Dépôt depuis le chutier ───────────────────────────────────────
    //
    // On écoute sur la zone défilante entière et non sur les seules pistes :
    // lâcher sous la dernière piste doit aussi fonctionner.
    //
    // Règle de dépôt :
    //   • la ligne survolée est libre à l'instant du relâchement → le clip s'y
    //     pose, à cet instant précis ;
    //   • elle est occupée (ou absente, ou d'un autre type) → une **piste
    //     neuve** s'ouvre à cette hauteur. On ne refoule jamais le média « à la
    //     fin » de la piste : c'est ce que l'utilisateur ne retrouvait pas.
    // L'identifiant n'est lisible qu'au `dragstart` (les navigateurs
    // protègent le contenu du `DataTransfer` pendant le survol) : on le
    // mémorise ici pour pouvoir annoncer, dès le survol, si le dépôt ouvrira
    // une piste neuve ou posera le clip sur la ligne visée.
    document.addEventListener('dragstart', (event) => {
      const mediaId = event.dataTransfer?.getData('application/x-ctf-media');
      if (mediaId) this.draggedMediaId = mediaId;
    });
    document.addEventListener('dragend', () => {
      this.draggedMediaId = null;
      this.clearDropHints();
      this.clearTrackHints();
    });

    this.scroll.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('application/x-ctf-media')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const row = (event.target as HTMLElement).closest<HTMLElement>('.track-row');
      const drop = this.resolveDrop(row, event, this.dragMediaId());
      this.clearDropHints();
      if (!row) return;
      row.classList.add(drop.newTrack ? 'drop-redirect' : 'drop');
    });
    this.scroll.addEventListener('dragleave', (event) => {
      if (event.target === this.scroll) this.clearDropHints();
    });
    this.scroll.addEventListener('drop', (event) => {
      const mediaId = event.dataTransfer?.getData('application/x-ctf-media');
      if (!mediaId) return;
      event.preventDefault();
      const row = (event.target as HTMLElement).closest<HTMLElement>('.track-row');
      this.clearDropHints();
      const drop = this.resolveDrop(row, event, mediaId);
      this.host.addMediaToTrack(mediaId, drop.trackId, drop.startUs, {
        newTrack: drop.newTrack,
      });
    });

    // ── Molette : zoom de la timeline, pas de l'interface ──────────────
    //
    // Ctrl/⌘ + molette (et le pincement du trackpad, que Chrome signale de la
    // même façon) zoome la timeline autour du curseur. Sans `preventDefault`,
    // le navigateur zoome *toute* la page et le studio devient inutilisable.
    this.scroll.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          const contentRect = this.content.getBoundingClientRect();
          const anchorUs = Math.max(
            0,
            ((event.clientX - contentRect.left) / this.zoom) * US,
          );
          const offsetPx = event.clientX - this.scroll.getBoundingClientRect().left;
          this.host.zoomTimeline(Math.exp(-event.deltaY * 0.0018), anchorUs, offsetPx);
          return;
        }
        // La timeline n'a qu'un axe : la molette verticale fait défiler
        // horizontalement au lieu de ne rien faire.
        const axis = event.deltaX !== 0 ? event.deltaX : event.deltaY;
        if (axis !== 0) {
          event.preventDefault();
          this.scroll.scrollLeft += axis;
        }
      },
      { passive: false },
    );
  }

  private clearDropHints(except?: HTMLElement | null): void {
    this.tracks
      .querySelectorAll<HTMLElement>('.track-row.drop, .track-row.drop-redirect')
      .forEach((element) => {
        if (element === except) return;
        element.classList.remove('drop', 'drop-redirect');
      });
  }

  /** Identifiant du média en cours de glissement depuis le chutier. */
  private draggedMediaId: string | null = null;

  /**
   * Renseigne le média glissé depuis le studio.
   *
   * Le contenu d'un `DataTransfer` n'est lisible qu'au `dragstart` : le studio
   * le transmet donc ici pour que le survol puisse déjà annoncer la décision
   * (pose sur la ligne ou ouverture d'une piste).
   */
  setDraggedMedia(mediaId: string | null): void {
    this.draggedMediaId = mediaId;
    if (!mediaId) this.clearDropHints();
  }

  private dragMediaId(): string | null {
    return this.draggedMediaId;
  }

  /** Lignes de piste au moment où le geste commence (géométrie figée). */
  private rowBounds(): RowBounds[] {
    return Array.from(this.tracks.querySelectorAll<HTMLElement>('.track-row')).map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.trackId ?? '', top: rect.top, bottom: rect.bottom, element };
    });
  }

  /**
   * Ligne visée par une ordonnée écran.
   *
   * Hors des lignes, on retient la plus proche — mais seulement à moins d'une
   * hauteur de ligne : au-delà, le pointeur a quitté la timeline et le clip ne
   * doit pas sauter sur la première piste parce qu'on a survolé l'aperçu.
   */
  private rowAt(clientY: number, rows: RowBounds[]): RowBounds | null {
    if (!rows.length) return null;
    const inside = rows.find((row) => clientY >= row.top && clientY < row.bottom);
    if (inside) return inside;
    let best: RowBounds | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const distance = clientY < row.top ? row.top - clientY : clientY - row.bottom;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row;
      }
    }
    return bestDistance <= ROW_HEIGHT ? best : null;
  }

  private trackAcceptsClip(clip: Clip, track: Track): boolean {
    if (clip.type === 'audio') return track.kind === 'audio';
    // vidéo, image, texte et forme sont des couches visuelles.
    return track.kind === 'video';
  }

  private markTrackHint(element: HTMLElement | null, ok: boolean): void {
    if (!element) {
      this.clearTrackHints();
      return;
    }
    // Éviter une écriture DOM à chaque `pointermove` : la classe ne change
    // qu'en passant d'une ligne à l'autre.
    if (element.classList.contains(ok ? 'drag-target' : 'drag-blocked')) return;
    this.clearTrackHints();
    element.classList.add(ok ? 'drag-target' : 'drag-blocked');
  }

  private clearTrackHints(): void {
    this.tracks
      .querySelectorAll<HTMLElement>('.track-row.drag-target, .track-row.drag-blocked')
      .forEach((element) => element.classList.remove('drag-target', 'drag-blocked'));
  }

  /**
   * Fait suivre au clip la ligne survolée pendant un glissement vertical.
   *
   * Le clip est retiré de sa piste et poussé dans la nouvelle, et son élément
   * DOM change de ligne : la capture du pointeur reste attachée à l'élément,
   * donc le geste continue sans être interrompu.
   */
  private followPointerTrack(clientY: number, drag: DragState): void {
    const row = this.rowAt(clientY, drag.rows);
    if (!row) {
      this.clearTrackHints();
      return;
    }
    const target = this.host.project.tracks.find((candidate) => candidate.id === row.id);
    if (!target) return;
    if (target.id === drag.track.id) {
      this.markTrackHint(row.element, true);
      return;
    }
    if (!this.trackAcceptsClip(drag.clip, target)) {
      this.markTrackHint(row.element, false);
      return;
    }
    const index = drag.track.clips.indexOf(drag.clip);
    if (index >= 0) drag.track.clips.splice(index, 1);
    target.clips.push(drag.clip);
    drag.track = target;
    drag.touchedTracks.add(target.id);

    const element = this.tracks.querySelector<HTMLElement>(
      `.clip[data-clip-id="${cssEscape(drag.clip.id)}"]`,
    );
    if (element) {
      row.element.appendChild(element);
      element.dataset.trackId = target.id;
    }
    this.markTrackHint(row.element, true);
  }

  /**
   * Décide ce que devient un média lâché depuis le chutier : piste survolée si
   * elle accepte le média et qu'elle est libre à cet instant, sinon piste neuve.
   */
  private resolveDrop(
    row: HTMLElement | null,
    event: DragEvent,
    mediaId: string | null,
  ): { trackId: string | null; startUs: number; newTrack: boolean } {
    const startUs = this.timeFromEvent(event, row);
    if (!row) return { trackId: null, startUs, newTrack: true };
    const track = this.host.project.tracks.find(
      (candidate) => candidate.id === row.dataset.trackId,
    );
    if (!track) return { trackId: null, startUs, newTrack: true };
    const media = mediaId ? mediaById(this.host.project, mediaId) : undefined;
    if (!media) return { trackId: track.id, startUs, newTrack: true };
    const fits =
      trackAcceptsMedia(track, media) && slotFree(track, startUs, defaultDuration(media));
    return { trackId: track.id, startUs, newTrack: !fits };
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
      // La fenêtre vaut la portion de source divisée par la vitesse.
      return Math.max(
        MIN_CLIP_US,
        Math.round((source - clip.source_start_us) / clipSpeed(clip)),
      );
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
  /** Ordonnée du début du geste : c'est elle qui décide d'un changement de piste. */
  startY: number;
  originalStart: number;
  originalDuration: number;
  originalSource: number;
  moved: boolean;
  /** Pistes touchées par le geste : elles seules sont retriées à la fin. */
  touchedTracks: Set<string>;
  /** Géométrie des lignes, figée au début du geste. */
  rows: RowBounds[];
  snapPoints: number[];
}

interface RowBounds {
  id: string;
  top: number;
  bottom: number;
  element: HTMLElement;
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
