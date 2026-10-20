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
import type { Clip, Effect, Project } from './state';
import {
  activeClip,
  clipEnd,
  mediaById,
  resolvePlacements,
  timelineEnd,
  type Placement,
} from './state';

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
  private placements: Map<string, Placement>;
  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private images = new Map<string, HTMLImageElement>();
  private pixelBuffer: HTMLCanvasElement;
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
    this.placements = resolvePlacements(project);
    this.pixelBuffer = document.createElement('canvas');
    this.hidden = document.createElement('div');
    this.hidden.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;left:-9999px';
    document.body.appendChild(this.hidden);
    this.configureCanvas();
    this.draw();
  }

  setProject(project: Project): void {
    this.project = project;
    this.placements = resolvePlacements(project);
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
      element.src = mediaUrl(media.id);
      element.preload = 'auto';
      element.playsInline = true;
      element.crossOrigin = 'anonymous';
      element.addEventListener('seeked', () => this.draw());
      element.addEventListener('loadeddata', () => this.draw());
      this.hidden.appendChild(element);
      this.videos.set(clip.id, element);
    }
    return element;
  }

  private audioFor(clip: Clip): HTMLAudioElement | null {
    const media = mediaById(this.project, clip.media);
    if (!media) return null;
    let element = this.audios.get(clip.id);
    if (!element) {
      element = document.createElement('audio');
      element.src = mediaUrl(media.id);
      element.preload = 'auto';
      this.hidden.appendChild(element);
      this.audios.set(clip.id, element);
    }
    return element;
  }

  private imageFor(clip: Clip): HTMLImageElement | null {
    const media = mediaById(this.project, clip.media);
    if (!media) return null;
    let element = this.images.get(clip.id);
    if (!element) {
      element = new Image();
      element.src = mediaUrl(media.id);
      element.addEventListener('load', () => this.draw());
      this.images.set(clip.id, element);
    }
    return element;
  }

  private placementOf(clip: Clip): Placement {
    return (
      this.placements.get(clip.id) ?? {
        start_us: clip.start_us,
        source_start_us: clip.source_start_us,
        duration_us: clip.duration_us,
        fade_in_us: clip.fade_in_us,
        dissolve_us: 0,
      }
    );
  }

  private localTime(clip: Clip): number {
    return this.timeUs - this.placementOf(clip).start_us;
  }

  private visualAlpha(clip: Clip, localUs: number): number {
    const placement = this.placementOf(clip);
    let alpha = clip.opacity;
    if (placement.fade_in_us > 0 && localUs < placement.fade_in_us) {
      alpha *= Math.max(0, localUs / placement.fade_in_us);
    }
    if (clip.fade_out_us > 0) {
      const remaining = placement.duration_us - localUs;
      if (remaining < clip.fade_out_us) alpha *= Math.max(0, remaining / clip.fade_out_us);
    }
    return Math.min(1, Math.max(0, alpha));
  }

  private audioGain(clip: Clip, localUs: number): number {
    const placement = this.placementOf(clip);
    let gain = clip.volume;
    if (placement.fade_in_us > 0 && localUs < placement.fade_in_us) {
      gain *= Math.max(0, localUs / placement.fade_in_us);
    }
    if (clip.fade_out_us > 0) {
      const remaining = placement.duration_us - localUs;
      if (remaining < clip.fade_out_us) gain *= Math.max(0, remaining / clip.fade_out_us);
    }
    return Math.min(1, Math.max(0, gain));
  }

  /** Filtre canvas approximant la chaîne d'effets ffmpeg. */
  private filterFor(effects: Effect[] | undefined): string {
    if (!effects || !effects.length) return 'none';
    const parts: string[] = [];
    for (const effect of effects) {
      const amount = Math.min(1, Math.max(0, effect.amount));
      switch (effect.name) {
        case 'blur':
          parts.push(`blur(${(0.4 + amount * 9).toFixed(2)}px)`);
          break;
        case 'sharpen':
          parts.push(`contrast(${(1 + amount * 0.35).toFixed(3)})`);
          break;
        case 'brightness':
          parts.push(`brightness(${(0.55 + amount).toFixed(3)})`);
          break;
        case 'grayscale':
          parts.push('grayscale(1)');
          break;
        case 'sepia':
          parts.push(`sepia(${amount.toFixed(3)})`);
          break;
        case 'warm':
          parts.push(`sepia(${(amount * 0.55).toFixed(3)}) saturate(${(1 + amount * 0.3).toFixed(3)})`);
          break;
        case 'cool':
          parts.push(`hue-rotate(${(-amount * 24).toFixed(1)}deg) saturate(${(1 + amount * 0.15).toFixed(3)})`);
          break;
        case 'invert':
          parts.push('invert(1)');
          break;
        default:
          break;
      }
    }
    return parts.length ? parts.join(' ') : 'none';
  }

  private hasEffect(clip: Clip, name: string): boolean {
    return Boolean(clip.effects?.some((effect) => effect.name === name));
  }

  private drawVisual(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    clip: Clip,
    localUs: number,
  ): void {
    if (!sourceWidth || !sourceHeight) return;
    const canvasWidth = this.project.width;
    const canvasHeight = this.project.height;
    const contain = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
    const width = sourceWidth * contain * clip.scale;
    const height = sourceHeight * contain * clip.scale;
    const centerX = clip.x * canvasWidth;
    const centerY = clip.y * canvasHeight;
    const alpha = this.visualAlpha(clip, localUs);
    const filter = this.filterFor(clip.effects);

    const pixelate = clip.effects?.find((effect) => effect.name === 'pixelate');
    if (pixelate) {
      const step = 2 + Math.round(pixelate.amount * 30);
      const smallW = Math.max(2, Math.round(width / step));
      const smallH = Math.max(2, Math.round(height / step));
      this.pixelBuffer.width = smallW;
      this.pixelBuffer.height = smallH;
      const bufferCtx = this.pixelBuffer.getContext('2d');
      if (bufferCtx) {
        bufferCtx.imageSmoothingEnabled = true;
        bufferCtx.drawImage(source, 0, 0, smallW, smallH);
        this.ctx.save();
        this.ctx.globalAlpha = alpha;
        this.ctx.imageSmoothingEnabled = false;
        this.drawTransformed(clip, centerX, centerY, width, height, () => {
          this.ctx.filter = filter;
          this.ctx.drawImage(this.pixelBuffer, 0, 0, width, height);
          this.ctx.filter = 'none';
        });
        this.ctx.restore();
        this.drawVignette(clip, canvasWidth, canvasHeight, alpha);
        return;
      }
    }

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.drawTransformed(clip, centerX, centerY, width, height, () => {
      this.ctx.filter = filter;
      if (this.hasEffect(clip, 'mirror')) {
        this.ctx.translate(width, 0);
        this.ctx.scale(-1, 1);
      }
      if (this.hasEffect(clip, 'flip')) {
        this.ctx.translate(0, height);
        this.ctx.scale(1, -1);
      }
      try {
        this.ctx.drawImage(source, 0, 0, width, height);
      } catch {
        // image/vidéo pas encore décodée
      }
      this.ctx.filter = 'none';
    });
    this.ctx.restore();
    this.drawVignette(clip, canvasWidth, canvasHeight, alpha);
  }

  /** Applique rotation + découpe, puis peint avec l'origine au coin du clip. */
  private drawTransformed(
    clip: Clip,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    paint: () => void,
  ): void {
    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    if (clip.rotation) this.ctx.rotate((clip.rotation * Math.PI) / 180);
    this.ctx.beginPath();
    this.ctx.rect(-width / 2, -height / 2, width, height);
    this.ctx.clip();
    this.ctx.translate(-width / 2, -height / 2);
    paint();
    this.ctx.restore();
  }

  private drawVignette(clip: Clip, width: number, height: number, alpha: number): void {
    const effect = clip.effects?.find((candidate) => candidate.name === 'vignette');
    if (!effect) return;
    const centerX = clip.x * width;
    const centerY = clip.y * height;
    const radius = Math.max(width, height) * (0.85 - effect.amount * 0.25);
    const gradient = this.ctx.createRadialGradient(centerX, centerY, radius * 0.35, centerX, centerY, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${(0.35 + effect.amount * 0.5) * alpha})`);
    const previous = this.ctx.fillStyle;
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.fillStyle = previous;
  }

  private drawText(clip: Clip, localUs: number): void {
    const style = clip.text;
    if (!style || !style.content) return;
    const x = clip.x * this.project.width;
    const y = clip.y * this.project.height;
    this.ctx.save();
    this.ctx.globalAlpha = this.visualAlpha(clip, localUs);
    this.ctx.translate(x, y);
    if (clip.rotation) this.ctx.rotate((clip.rotation * Math.PI) / 180);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `700 ${style.size * clip.scale}px "Inter", "Segoe UI", system-ui, sans-serif`;
    const lines = style.content.split('\n');
    const lineHeight = style.size * clip.scale * 1.15;
    const startY = -((lines.length - 1) * lineHeight) / 2;
    if (style.background) {
      const widest = Math.max(...lines.map((line) => this.ctx.measureText(line).width));
      this.ctx.fillStyle = style.background;
      this.ctx.fillRect(
        -widest / 2 - style.size * 0.3,
        startY - lineHeight / 2,
        widest + style.size * 0.6,
        lineHeight * lines.length,
      );
    }
    this.ctx.fillStyle = style.color || '#FFFFFF';
    lines.forEach((line, index) => {
      this.ctx.fillText(line, 0, startY + index * lineHeight);
    });
    this.ctx.restore();
  }

  private drawShape(clip: Clip, localUs: number): void {
    const shape = clip.shape;
    if (!shape) return;
    const width = shape.width * clip.scale * this.project.width;
    const height = shape.height * clip.scale * this.project.height;
    const x = clip.x * this.project.width;
    const y = clip.y * this.project.height;
    this.ctx.save();
    this.ctx.globalAlpha = this.visualAlpha(clip, localUs);
    this.ctx.translate(x, y);
    if (clip.rotation) this.ctx.rotate((clip.rotation * Math.PI) / 180);
    this.ctx.fillStyle = shape.color;
    this.ctx.beginPath();
    if (shape.kind === 'ellipse') {
      this.ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else {
      const radius = Math.min(shape.radius * Math.min(width, height), Math.min(width, height) / 2);
      if (radius > 0.5) {
        this.ctx.roundRect(-width / 2, -height / 2, width, height, radius);
      } else {
        this.ctx.rect(-width / 2, -height / 2, width, height);
      }
    }
    this.ctx.fill();
    this.ctx.restore();
  }

  draw(): void {
    const ctx = this.ctx;
    const scale = this.canvas.width / this.project.width;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = this.project.background || '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(scale, scale);

    // Dernière piste = fond, première = premier plan (même ordre que le moteur).
    // Pendant un fondu enchaîné, DEUX clips d'une même piste sont actifs : le
    // sortant reste dessiné, l'entrant s'affiche par-dessus en s'opacifiant.
    for (let index = this.project.tracks.length - 1; index >= 0; index -= 1) {
      const track = this.project.tracks[index];
      if (!track || track.muted) continue;
      const active = track.clips
        .filter((clip) => this.timeUs >= clip.start_us && this.timeUs < clipEnd(clip))
        .sort((a, b) => a.start_us - b.start_us);
      for (const clip of active) {
        const local = this.localTime(clip);
        if (clip.type === 'video') {
          const element = this.videoFor(clip);
          if (element && element.readyState >= 2) {
            this.drawVisual(element, element.videoWidth, element.videoHeight, clip, local);
          }
        } else if (clip.type === 'image') {
          const element = this.imageFor(clip);
          if (element && element.complete && element.naturalWidth) {
            this.drawVisual(element, element.naturalWidth, element.naturalHeight, clip, local);
          }
        } else if (clip.type === 'text') {
          this.drawText(clip, local);
        } else if (clip.type === 'shape') {
          this.drawShape(clip, local);
        }
      }
    }
    ctx.restore();
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
        const desired = (placement.source_start_us + local) / 1_000_000;
        const gain = Math.min(1, Math.max(0, track.volume * this.audioGain(clip, local)));
        element.volume = gain;
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
    this.pauseAll();
    for (const track of this.project.tracks) {
      const clip = activeClip(track, this.timeUs);
      if (!clip) continue;
      const placement = this.placementOf(clip);
      const element =
        clip.type === 'audio'
          ? this.audios.get(clip.id) ?? this.audioFor(clip)
          : clip.type === 'video'
            ? this.videos.get(clip.id) ?? this.videoFor(clip)
            : null;
      if (element) {
        const desired = (placement.source_start_us + (this.timeUs - placement.start_us)) / 1_000_000;
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
    this.placements = resolvePlacements(this.project);
    this.prune();
    this.draw();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.pauseAll();
    this.hidden.remove();
  }
}
