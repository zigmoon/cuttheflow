/**
 * Rendu d'une image de la timeline — partagé par l'aperçu et par l'export.
 *
 * Une seule implémentation : ce que l'aperçu montre est exactement ce que
 * l'export encode (mêmes placements, mêmes fondus, mêmes effets approximés).
 * Le moteur Rust, lui, utilise les filtres ffmpeg exacts ; ici les effets sont
 * approchés par les filtres du canvas, ce qui est indiqué dans le panneau.
 */

import type { Clip, Effect, Mask, Project } from './state';
import { resolvePlacements, valueAt, type Placement } from './state';

export interface FrameSource {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export type SourceLookup = (clip: Clip) => FrameSource | null;

export class FrameRenderer {
  project: Project;
  private placements: Map<string, Placement>;
  private ctx!: CanvasRenderingContext2D;
  private pixelBuffer: HTMLCanvasElement;
  /** Cale de composition pour les clips masqués (le masque ne doit pas trouer le fond). */
  private maskBuffer: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D | null = null;

  constructor(project: Project) {
    this.project = project;
    this.placements = resolvePlacements(project);
    this.pixelBuffer = document.createElement('canvas');
    this.maskBuffer = document.createElement('canvas');
  }

  setProject(project: Project): void {
    this.project = project;
    this.placements = resolvePlacements(project);
  }

  /** Recalcule les placements après une édition (transitions, déplacements). */
  refresh(): void {
    this.placements = resolvePlacements(this.project);
  }

  placementOf(clip: Clip): Placement {
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

  isActive(clip: Clip, timeUs: number): boolean {
    const placement = this.placementOf(clip);
    return timeUs >= placement.start_us && timeUs < placement.start_us + placement.duration_us;
  }

  localTime(clip: Clip, timeUs: number): number {
    return timeUs - this.placementOf(clip).start_us;
  }

  drawFrame(ctx: CanvasRenderingContext2D, timeUs: number, lookup: SourceLookup): void {
    this.ctx = ctx;
    const scale = ctx.canvas.width / this.project.width;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = this.project.background || '#000000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.scale(scale, scale);

    // Dernière piste = fond, première = premier plan (même ordre que le moteur).
    // Pendant un fondu enchaîné, DEUX clips d'une même piste sont actifs : le
    // sortant reste dessiné, l'entrant s'affiche par-dessus en s'opacifiant.
    for (let index = this.project.tracks.length - 1; index >= 0; index -= 1) {
      const track = this.project.tracks[index];
      if (!track || track.muted) continue;
      const active = track.clips
        .filter((clip) => this.isActive(clip, timeUs))
        .sort((a, b) => this.placementOf(a).start_us - this.placementOf(b).start_us);
      for (const clip of active) {
        const local = this.localTime(clip, timeUs);
        this.withMask(clip, () => {
          if (clip.type === 'video' || clip.type === 'image') {
            const found = lookup(clip);
            if (found) this.drawVisual(found.source, found.width, found.height, clip, local);
          } else if (clip.type === 'text') {
            this.drawText(clip, local);
          } else if (clip.type === 'shape') {
            this.drawShape(clip, local);
          }
        });
      }
    }
    ctx.restore();
  }

  /** Valeurs animées (keyframes) d'un clip à un instant local. */
  animated(clip: Clip, localUs: number): { opacity: number; scale: number; x: number; y: number; rotation: number } {
    return {
      opacity: valueAt(clip, 'opacity', localUs),
      scale: Math.max(0, valueAt(clip, 'scale', localUs)),
      x: valueAt(clip, 'x', localUs),
      y: valueAt(clip, 'y', localUs),
      rotation: valueAt(clip, 'rotation', localUs),
    };
  }

  /**
   * Rend le clip dans une cale intermédiaire quand il porte un masque : le
   * masque doit découper le clip, pas trouer ce qui est déjà dessiné dessous.
   */
  private withMask(clip: Clip, paint: () => void): void {
    const mask = clip.mask;
    if (!mask) {
      paint();
      return;
    }
    const outer = this.ctx;
    const canvas = outer.canvas;
    if (this.maskBuffer.width !== canvas.width || this.maskBuffer.height !== canvas.height) {
      this.maskBuffer.width = canvas.width;
      this.maskBuffer.height = canvas.height;
      this.maskCtx = null;
    }
    if (!this.maskCtx) this.maskCtx = this.maskBuffer.getContext('2d');
    const buffer = this.maskCtx;
    if (!buffer) {
      paint();
      return;
    }
    buffer.setTransform(1, 0, 0, 1, 0, 0);
    buffer.globalAlpha = 1;
    buffer.globalCompositeOperation = 'source-over';
    buffer.filter = 'none';
    buffer.clearRect(0, 0, this.maskBuffer.width, this.maskBuffer.height);
    buffer.setTransform(outer.getTransform());
    this.ctx = buffer;
    try {
      paint();
    } finally {
      this.ctx = outer;
    }
    // Le masque est exprimé dans le repère du projet : on garde la même
    // transformation que le contenu, sinon la découpe ne tombe pas au bon endroit.
    buffer.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in';
    this.paintMaskShape(buffer, mask);
    buffer.globalCompositeOperation = 'source-over';
    outer.save();
    outer.setTransform(1, 0, 0, 1, 0, 0);
    outer.drawImage(this.maskBuffer, 0, 0);
    outer.restore();
  }

  private paintMaskShape(ctx: CanvasRenderingContext2D, mask: Mask): void {
    const width = Math.max(1, mask.width * this.project.width);
    const height = Math.max(1, mask.height * this.project.height);
    const cx = mask.x * this.project.width;
    const cy = mask.y * this.project.height;
    const feather = Math.max(0, Math.min(1, mask.feather));
    ctx.save();
    ctx.filter = feather > 0.005 ? `blur(${(feather * Math.min(width, height) * 0.22).toFixed(2)}px)` : 'none';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (mask.kind === 'ellipse') {
      ctx.ellipse(cx, cy, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(cx - width / 2, cy - height / 2, width, height);
    }
    ctx.fill();
    ctx.restore();
  }

  private visualAlpha(clip: Clip, localUs: number): number {
    const placement = this.placementOf(clip);
    let alpha = valueAt(clip, 'opacity', localUs);
    if (placement.fade_in_us > 0 && localUs < placement.fade_in_us) {
      alpha *= Math.max(0, localUs / placement.fade_in_us);
    }
    if (clip.fade_out_us > 0) {
      const remaining = placement.duration_us - localUs;
      if (remaining < clip.fade_out_us) alpha *= Math.max(0, remaining / clip.fade_out_us);
    }
    return Math.min(1, Math.max(0, alpha));
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
    const animated = this.animated(clip, localUs);
    const contain = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
    const width = sourceWidth * contain * animated.scale;
    const height = sourceHeight * contain * animated.scale;
    const centerX = animated.x * canvasWidth;
    const centerY = animated.y * canvasHeight;
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
        this.drawTransformed(animated.rotation, centerX, centerY, width, height, () => {
          this.ctx.filter = filter;
          this.ctx.drawImage(this.pixelBuffer, 0, 0, width, height);
          this.ctx.filter = 'none';
        });
        this.ctx.restore();
        this.drawVignette(clip, centerX, centerY, alpha);
        return;
      }
    }

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.drawTransformed(animated.rotation, centerX, centerY, width, height, () => {
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
    this.drawVignette(clip, centerX, centerY, alpha);
  }

  /** Applique rotation + découpe, puis peint avec l'origine au coin du clip. */
  private drawTransformed(
    rotation: number,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    paint: () => void,
  ): void {
    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    if (rotation) this.ctx.rotate((rotation * Math.PI) / 180);
    this.ctx.beginPath();
    this.ctx.rect(-width / 2, -height / 2, width, height);
    this.ctx.clip();
    this.ctx.translate(-width / 2, -height / 2);
    paint();
    this.ctx.restore();
  }

  private drawVignette(clip: Clip, centerX: number, centerY: number, alpha: number): void {
    const effect = clip.effects?.find((candidate) => candidate.name === 'vignette');
    if (!effect) return;
    const width = this.project.width;
    const height = this.project.height;
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
    const animated = this.animated(clip, localUs);
    const x = animated.x * this.project.width;
    const y = animated.y * this.project.height;
    this.ctx.save();
    this.ctx.globalAlpha = this.visualAlpha(clip, localUs);
    this.ctx.translate(x, y);
    if (animated.rotation) this.ctx.rotate((animated.rotation * Math.PI) / 180);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `700 ${Math.max(1, style.size * animated.scale)}px "Inter", "Segoe UI", system-ui, sans-serif`;
    const lines = style.content.split('\n');
    const lineHeight = style.size * animated.scale * 1.15;
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
    const animated = this.animated(clip, localUs);
    const width = shape.width * animated.scale * this.project.width;
    const height = shape.height * animated.scale * this.project.height;
    const x = animated.x * this.project.width;
    const y = animated.y * this.project.height;
    this.ctx.save();
    this.ctx.globalAlpha = this.visualAlpha(clip, localUs);
    this.ctx.translate(x, y);
    if (animated.rotation) this.ctx.rotate((animated.rotation * Math.PI) / 180);
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
}
