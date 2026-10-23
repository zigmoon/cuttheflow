/**
 * Preview temps réel : composition canvas + audio synchronisé.
 *
 * La preview est un confort d'édition ; l'export ne passe jamais par elle.
 * Elle applique néanmoins **les mêmes placements** que le moteur (voir
 * `resolvePlacements`), donc une transition en fondu enchaîné se voit à
 * l'identique, contenu compris.
 *
 * Les effets sont approximés avec les filtres CSS du canvas : l'export, lui,
 * utilise les filtres ffmpeg exacts. Les deux ne peuvent pas diverger sur la
 * durée ou la synchronisation — seulement sur le rendu de certains effets
 * (grain, pixelisation), ce qui est indiqué dans le panneau d'effets.
 */

import { mediaUrl } from './api';
import { FrameRenderer } from './render';
import type { Clip, Project } from './state';
import { clipSpeed, mediaById, sourceTimeAt, timelineEnd, valueAt, type Placement } from './state';

const MAX_PREVIEW_WIDTH = 1440;
const DRIFT_SECONDS = 0.18;

export interface PreviewCallbacks {
  onTime: (timeUs: number) => void;
  onPlayState: (playing: boolean) => void;
}

export class Preview {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: PreviewCallbacks;
  private project: Project;
  private renderer: FrameRenderer;
  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private images = new Map<string, HTMLImageElement>();
  private hidden: HTMLDivElement;
  private frame = 0;
  private clockStart = 0;
  private clockOffsetUs = 0;
  private lastProjectKey = '';
  private availableWidth = MAX_PREVIEW_WIDTH;
  private availableHeight = MAX_PREVIEW_WIDTH * 0.75;

  timeUs = 0;
  playing = false;
  scale = 1;
  /** 1 = ajusté à la fenêtre ; > 1 = zoom manuel. */
  fitMode = true;
  zoom = 1;

  constructor(canvas: HTMLCanvasElement, project: Project, callbacks: PreviewCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D indisponible');
    this.ctx = context;
    this.callbacks = callbacks;
    this.project = project;
    this.renderer = new FrameRenderer(project);
    this.hidden = document.createElement('div');
    this.hidden.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;left:-9999px';
    document.body.appendChild(this.hidden);
    this.configureCanvas();
    this.draw();
  }

  setProject(project: Project): void {
    this.project = project;
    this.renderer.setProject(project);
    this.configureCanvas();
    this.prune();
    this.draw();
  }

  /** Ajuste la taille du canvas à la place disponible, sans dépasser la source. */
  configureCanvas(availableWidth = 0, availableHeight = 0): void {
    if (availableWidth > 0) this.availableWidth = availableWidth;
    if (availableHeight > 0) this.availableHeight = availableHeight;
    const limitWidth = this.availableWidth;
    const limitHeight = this.availableHeight;
    const fit = Math.min(
      limitWidth / this.project.width,
      limitHeight / this.project.height,
      1,
    );
    const scale = Math.max(0.08, fit * (this.fitMode ? 1 : this.zoom));
    const width = Math.max(2, Math.round(this.project.width * scale));
    const height = Math.max(2, Math.round(this.project.height * scale));
    this.scale = width / this.project.width;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.parentElement?.setAttribute(
      'style',
      `width:${width}px;height:${height}px`,
    );
    this.draw();
  }

  private projectKey(): string {
    const ids = this.project.tracks.flatMap((track) => track.clips.map((clip) => `${clip.id}:${clip.media}`));
    return `${this.project.width}x${this.project.height}|${ids.join(',')}`;
  }

  /** Supprime les éléments des clips qui n'existent plus. */
  private prune(): void {
    const key = this.projectKey();
    if (key === this.lastProjectKey) return;
    this.lastProjectKey = key;
    const validVideo = new Set<string>();
    const validAudio = new Set<string>();
    const validImages = new Set<string>();
    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        if (clip.type === 'video') validVideo.add(clip.id);
        if (clip.type === 'audio') validAudio.add(clip.id);
        if (clip.type === 'image') validImages.add(clip.id);
      }
    }
    for (const [id, element] of this.videos) {
      if (!validVideo.has(id)) {
        element.pause();
        element.remove();
        this.videos.delete(id);
      }
    }
    for (const [id, element] of this.audios) {
      if (!validAudio.has(id)) {
        element.pause();
        element.remove();
        this.audios.delete(id);
      }
    }
    for (const id of [...this.images.keys()]) {
      if (!validImages.has(id)) this.images.delete(id);
    }
  }

  private videoFor(clip: Clip): HTMLVideoElement | null {
    const media = mediaById(this.project, clip.media);
    if (!media) return null;
    let element = this.videos.get(clip.id);
    if (!element) {
      element = document.createElement('video');
      element.preload = 'auto';
      element.playsInline = true;
      element.crossOrigin = 'anonymous';
      element.addEventListener('seeked', () => this.draw());
      element.addEventListener('loadeddata', () => this.draw());
      this.hidden.appendChild(element);
      this.videos.set(clip.id, element);
    }
    // L'URL peut arriver après l'élément (médias locaux restaurés depuis
    // IndexedDB) : on la repose dès qu'elle est disponible.
    const url = mediaUrl(media.id);
    if (url && element.getAttribute('src') !== url) element.setAttribute('src', url);
    return element;
  }

  private audioFor(clip: Clip): HTMLAudioElement | null {
    const media = mediaById(this.project, clip.media);
    if (!media) return null;
    let element = this.audios.get(clip.id);
    if (!element) {
      element = document.createElement('audio');
      element.preload = 'auto';
      this.hidden.appendChild(element);
      this.audios.set(clip.id, element);
    }
    const url = mediaUrl(media.id);
    if (url && element.getAttribute('src') !== url) element.setAttribute('src', url);
    return element;
  }

  private imageFor(clip: Clip): HTMLImageElement | null {
    const media = mediaById(this.project, clip.media);
    if (!media) return null;
    let element = this.images.get(clip.id);
    if (!element) {
      element = new Image();
      element.addEventListener('load', () => this.draw());
      this.images.set(clip.id, element);
    }
    const url = mediaUrl(media.id);
    if (url && element.getAttribute('src') !== url) element.setAttribute('src', url);
    return element;
  }

  private placementOf(clip: Clip): Placement {
    return this.renderer.placementOf(clip);
  }

  private audioGain(clip: Clip, localUs: number): number {
    const placement = this.placementOf(clip);
    let gain = valueAt(clip, 'volume', localUs);
    if (placement.fade_in_us > 0 && localUs < placement.fade_in_us) {
      gain *= Math.max(0, localUs / placement.fade_in_us);
    }
    if (clip.fade_out_us > 0) {
      const remaining = placement.duration_us - localUs;
      if (remaining < clip.fade_out_us) gain *= Math.max(0, remaining / clip.fade_out_us);
    }
    return Math.min(1, Math.max(0, gain));
  }

  /** Compose l'image courante : même rendu que l'export (voir `render.ts`). */
  draw(): void {
    this.renderer.drawFrame(this.ctx, this.timeUs, (clip) => {
      if (clip.type === 'video') {
        const element = this.videoFor(clip);
        if (!element || element.readyState < 2) return null;
        return { source: element, width: element.videoWidth, height: element.videoHeight };
      }
      if (clip.type === 'image') {
        const element = this.imageFor(clip);
        if (!element || !element.complete || !element.naturalWidth) return null;
        return { source: element, width: element.naturalWidth, height: element.naturalHeight };
      }
      return null;
    });
  }

  /** Recale tous les éléments audio/vidéo actifs. */
  private syncAudio(): void {
    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        const placement = this.placementOf(clip);
        const active =
          !track.muted &&
          this.timeUs >= placement.start_us &&
          this.timeUs < placement.start_us + placement.duration_us;
        const existing =
          clip.type === 'audio'
            ? this.audios.get(clip.id)
            : clip.type === 'video'
              ? this.videos.get(clip.id)
              : undefined;
        // On ne crée un élément média que lorsqu'il devient actif : un montage
        // de 200 clips ne doit pas ouvrir 200 décodeurs au premier appui.
        if (!active) {
          if (existing && !existing.paused) existing.pause();
          continue;
        }
        const element =
          clip.type === 'audio'
            ? existing ?? this.audioFor(clip)
            : clip.type === 'video'
              ? existing ?? this.videoFor(clip)
              : null;
        if (!element) continue;
        const local = this.timeUs - placement.start_us;
        const desired = sourceTimeAt(clip, local) / 1_000_000;
        const gain = Math.min(1, Math.max(0, track.volume * this.audioGain(clip, local)));
        element.volume = gain;
        const rate = clipSpeed(clip);
        if (Math.abs(element.playbackRate - rate) > 1e-3) {
          // 0.0625–16 : au-delà Chrome refuse la valeur.
          try {
            element.playbackRate = Math.min(16, Math.max(0.0625, rate));
          } catch {
            // ignoré
          }
        }
        if (clip.type === 'video') {
          (element as HTMLVideoElement).muted = track.muted || clip.audio_muted;
        } else {
          (element as HTMLAudioElement).muted = track.muted;
        }
        if (Math.abs(element.currentTime - desired) > DRIFT_SECONDS) {
          try {
            element.currentTime = Math.max(0, desired);
          } catch {
            // pas encore prêt
          }
        }
        if (this.playing && element.paused) {
          void element.play().catch(() => {});
        }
      }
    }
  }

  private pauseAll(): void {
    for (const element of this.videos.values()) element.pause();
    for (const element of this.audios.values()) element.pause();
  }

  private loop = (): void => {
    if (!this.playing) return;
    const elapsed = (performance.now() - this.clockStart) * 1000;
    const end = timelineEnd(this.project);
    this.timeUs = Math.min(end, this.clockOffsetUs + elapsed);
    this.syncAudio();
    this.draw();
    this.callbacks.onTime(this.timeUs);
    if (this.timeUs >= end) {
      this.pause();
      return;
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  play(): void {
    if (this.playing) return;
    const end = timelineEnd(this.project);
    if (end <= 0) return;
    if (this.timeUs >= end - 1000) this.timeUs = 0;
    this.playing = true;
    this.clockStart = performance.now();
    this.clockOffsetUs = this.timeUs;
    this.syncAudio();
    this.callbacks.onPlayState(true);
    this.frame = requestAnimationFrame(this.loop);
  }

  pause(): void {
    const wasPlaying = this.playing;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.pauseAll();
    if (wasPlaying) this.callbacks.onPlayState(false);
    this.draw();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(timeUs: number): void {
    const end = timelineEnd(this.project);
    this.timeUs = Math.min(end, Math.max(0, timeUs));
    // Pendant la lecture, la boucle recalcule le temps depuis `clockOffsetUs` :
    // sans recaler l'horloge ici, déplacer la tête de lecture était annulé à
    // l'image suivante et il fallait mettre en pause pour se déplacer.
    if (this.playing) {
      this.clockStart = performance.now();
      this.clockOffsetUs = this.timeUs;
    }
    this.pauseAll();
    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        const placement = this.placementOf(clip);
        const active =
          this.timeUs >= placement.start_us &&
          this.timeUs < placement.start_us + placement.duration_us;
        if (!active) continue;
        const element =
          clip.type === 'audio'
            ? this.audios.get(clip.id) ?? this.audioFor(clip)
            : clip.type === 'video'
              ? this.videos.get(clip.id) ?? this.videoFor(clip)
              : null;
        if (!element) continue;
        const desired = sourceTimeAt(clip, this.timeUs - placement.start_us) / 1_000_000;
        try {
          element.currentTime = Math.max(0, desired);
        } catch {
          // ignoré
        }
      }
    }
    this.draw();
    this.callbacks.onTime(this.timeUs);
  }

  refresh(): void {
    this.renderer.refresh();
    this.prune();
    this.draw();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.pauseAll();
    this.hidden.remove();
  }
}
