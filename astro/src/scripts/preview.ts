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
/**
 * Tolérance de synchronisation pendant la lecture.
 *
 * 180 ms laissait l'image et le son jusqu'à ~5 images de retard l'un sur
 * l'autre : perceptible à l'œil ET à l'oreille, et surtout jamais corrigé
 * puisque le seuil n'était pas atteint. 60 ms reste sous le seuil de
 * perception audio-vidéo et évite les recalages inutiles (chaque recalage est
 * un `currentTime` = décodage interrompu = saccade).
 */
const DRIFT_SECONDS = 0.06;
/** Au-delà, on ne corrige plus en douceur : l'élément est vraiment perdu. */
const DRIFT_HARD_SECONDS = 0.4;
/** Fenêtre de pré-roulage : les clips à venir sont chargés et positionnés. */
const PREROLL_US = 900_000;
/**
 * Nombre de décodeurs vivants simultanément. Au-delà, les éléments des clips
 * inactifs les plus éloignés de la tête de lecture sont libérés : un montage
 * de 200 clips ne doit pas garder 200 décodeurs ouverts.
 */
const MAX_LIVE_DECODERS = 12;

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
  /** Clips dont la lecture a été amorcée (positionnée puis lancée). */
  private started = new Set<string>();
  /** Position de pré-roulage déjà posée, par clip. */
  private primed = new Map<string, number>();
  private lastWarm = 0;

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
    this.releaseDistant();
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
    // ⚠️ Le zoom manuel ne dépasse JAMAIS 100 % de la résolution du projet.
    // Avant, « + » montait le canvas à 174 % (3336 × 1877) : six millions de
    // pixels recomposés à chaque image pour afficher… un agrandissement flou de
    // la même source. C'était la principale cause de lecture saccadée dès deux
    // calques.
    const scale = Math.max(0.08, Math.min(1, fit * (this.fitMode ? 1 : this.zoom)));
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
        this.started.delete(id);
        this.primed.delete(id);
      }
    }
    for (const [id, element] of this.audios) {
      if (!validAudio.has(id)) {
        element.pause();
        element.remove();
        this.audios.delete(id);
        this.started.delete(id);
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
      // Pendant la lecture, la boucle rAF dessine déjà à chaque image : un
      // `draw()` déclenché en plus par `seeked`/`loadeddata` doublait le coût
      // de composition (et provoquait des micro-saccades aux coupes). En pause,
      // ces rappels sont au contraire le seul moyen d'afficher l'image.
      element.addEventListener('seeked', () => {
        if (!this.playing) this.draw();
      });
      element.addEventListener('loadeddata', () => {
        if (!this.playing) this.draw();
      });
      element.addEventListener('error', () => {
        if (!this.playing) this.draw();
      });
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
    if (this.canvas.width < 2 || this.canvas.height < 2) return;
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

  /** Positionne un élément média dès que sa durée est connue. */
  private seekElement(element: HTMLMediaElement, seconds: number): void {
    const apply = () => {
      try {
        element.currentTime = Math.max(0, seconds);
      } catch {
        // pas encore prêt : le prochain passage réessaiera
      }
    };
    if (element.readyState >= 1) apply();
    else element.addEventListener('loadedmetadata', apply, { once: true });
  }

  /**
   * Pré-roulage : charge et positionne les clips qui commencent bientôt.
   *
   * Sans cela, le décodeur d'un clip était créé AU moment de la coupe : écran
   * noir, puis une seconde de décodage à rebours pour rattraper la position.
   * C'est le défaut le plus visible d'un montage avec plusieurs calques.
   */
  private warmUpcoming(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastWarm < 200) return;
    this.lastWarm = now;
    for (const track of this.project.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.type !== 'image' && clip.type !== 'video') continue;
        const placement = this.placementOf(clip);
        const delta = placement.start_us - this.timeUs;
        // Seuls les clips qui arrivent sont préparés : charger toutes les
        // images du projet d'un coup coûterait la mémoire de tout le montage.
        if (delta <= 0 || delta > PREROLL_US) continue;
        if (clip.type === 'image') {
          // Décodage de l'image à l'avance : elle est prête à la coupe.
          this.imageFor(clip);
          continue;
        }
        if (this.primed.get(clip.id) === placement.start_us) continue;
        const element = this.videoFor(clip);
        if (!element) continue;
        this.primed.set(clip.id, placement.start_us);
        this.seekElement(element, sourceTimeAt(clip, 0) / 1_000_000);
      }
    }
  }

  /**
   * Libère les décodeurs des clips lointains.
   *
   * Chaque `<video>` actif ou récent garde un décodeur matériel. Sur un montage
   * long, ils s'accumulaient sans limite et la lecture finissait par saccader.
   */
  private releaseDistant(): void {
    if (this.videos.size <= MAX_LIVE_DECODERS) return;
    const entries = [...this.videos.entries()]
      .filter(([id]) => !this.started.has(id))
      .map(([id, element]) => ({ id, element, distance: this.clipDistance(id) }))
      .filter((entry) => entry.distance > 5_000_000)
      .sort((a, b) => b.distance - a.distance);
    for (const entry of entries) {
      if (this.videos.size <= MAX_LIVE_DECODERS) break;
      try {
        entry.element.pause();
        entry.element.removeAttribute('src');
        entry.element.load();
      } catch {
        // ignoré
      }
      entry.element.remove();
      this.videos.delete(entry.id);
      this.primed.delete(entry.id);
    }
  }

  /** Distance (µs) entre la tête de lecture et la fenêtre d'un clip. */
  private clipDistance(clipId: string): number {
    for (const track of this.project.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (!clip) continue;
      const placement = this.placementOf(clip);
      const end = placement.start_us + placement.duration_us;
      if (this.timeUs >= placement.start_us && this.timeUs < end) return 0;
      return Math.min(Math.abs(placement.start_us - this.timeUs), Math.abs(end - this.timeUs));
    }
    return Number.POSITIVE_INFINITY;
  }

  /**
   * Instant de la timeline lu sur le décodeur du calque visuel du dessus.
   *
   * Sert à recaler la tête de lecture sur l'image réelle : quand le décodeur
   * prend du retard, l'horloge `performance.now()` continuait d'avancer et
   * l'image sautait des trames. `null` si aucun décodeur n'est exploitable.
   */
  private referenceTimeUs(): number | null {
    for (let index = 0; index < this.project.tracks.length; index += 1) {
      const track = this.project.tracks[index];
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.type !== 'video') continue;
        const element = this.videos.get(clip.id);
        if (!element || element.paused || element.readyState < 3) continue;
        const placement = this.placementOf(clip);
        if (this.timeUs < placement.start_us || this.timeUs >= placement.start_us + placement.duration_us) {
          continue;
        }
        const local = (element.currentTime * 1_000_000 - clip.source_start_us) / clipSpeed(clip);
        const time = placement.start_us + local;
        if (time < placement.start_us || time > placement.start_us + placement.duration_us) continue;
        return time;
      }
    }
    return null;
  }

  /** Recale tous les éléments audio/vidéo actifs. */
  private syncAudio(): void {
    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        // Texte et formes n'ont aucun élément média : les ignorer avant tout
        // calcul évite de parcourir inutilement leurs placements à chaque image.
        if (clip.type !== 'video' && clip.type !== 'audio') continue;
        const placement = this.placementOf(clip);
        const active =
          !track.muted &&
          this.timeUs >= placement.start_us &&
          this.timeUs < placement.start_us + placement.duration_us;
        const existing =
          clip.type === 'audio' ? this.audios.get(clip.id) : this.videos.get(clip.id);
        // On ne crée un élément média que lorsqu'il devient actif : un montage
        // de 200 clips ne doit pas ouvrir 200 décodeurs au premier appui.
        if (!active) {
          if (existing && !existing.paused) existing.pause();
          this.started.delete(clip.id);
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
        const desired = Math.max(0, sourceTimeAt(clip, local) / 1_000_000);
        const muted = track.muted || (clip.type === 'video' && clip.audio_muted);
        const gain = muted
          ? 0
          : Math.min(1, Math.max(0, track.volume * this.audioGain(clip, local)));
        // Écrire `volume`/`muted` à chaque image force un recalcul côté média :
        // on ne le fait que lorsque la valeur change réellement.
        const syncKey = `${muted ? 1 : 0}:${gain.toFixed(3)}`;
        const cached = element as HTMLMediaElement & { _ctfSyncKey?: string };
        if (cached._ctfSyncKey !== syncKey) {
          cached._ctfSyncKey = syncKey;
          element.muted = muted;
          element.volume = gain;
        }
        const rate = clipSpeed(clip);
        if (Math.abs(element.playbackRate - rate) > 1e-3) {
          // 0.0625–16 : au-delà Chrome refuse la valeur.
          try {
            element.playbackRate = Math.min(16, Math.max(0.0625, rate));
          } catch {
            // ignoré
          }
        }
        // Amorçage : au premier passage sur le clip on se cale EXACTEMENT sur
        // la source, puis on ne corrige que lorsque la dérive devient audible.
        // Avant, la lecture démarrait à la position laissée par le clip
        // précédent et le recalage n'arrivait qu'après 180 ms de décalage.
        const firstStart = !this.started.has(clip.id);
        if (firstStart || Math.abs(element.currentTime - desired) > DRIFT_SECONDS) {
          this.seekElement(element, desired);
          if (firstStart) this.started.add(clip.id);
        }
        if (this.playing) {
          if (element.paused) void element.play().catch(() => {});
        } else if (!element.paused) {
          element.pause();
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
    let next = Math.min(end, this.clockOffsetUs + elapsed);
    // L'image réelle pilote l'horloge : un décodeur légèrement en retard ne
    // doit pas provoquer de saut de trames. On ne recale que vers l'avant et
    // sur une amplitude modérée, sinon on revient à la saccade d'origine.
    const reference = this.referenceTimeUs();
    if (reference !== null) {
      const drift = reference - next;
      if (drift > 15_000 && drift < 200_000) {
        next = reference;
        this.clockStart = performance.now();
        this.clockOffsetUs = next;
      }
    }
    this.timeUs = next;
    this.syncAudio();
    this.warmUpcoming();
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
    // Amorçage exact de tous les calques actifs AVANT que l'horloge démarre :
    // la première image est déjà décodée, le son démarre au bon endroit.
    this.started.clear();
    this.primed.clear();
    this.warmUpcoming(true);
    this.syncAudio();
    this.draw();
    this.callbacks.onPlayState(true);
    this.clockStart = performance.now();
    this.clockOffsetUs = this.timeUs;
    this.frame = requestAnimationFrame(this.loop);
  }

  pause(): void {
    const wasPlaying = this.playing;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.pauseAll();
    this.started.clear();
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
    // Tout est repositionné à l'instant exact : au prochain appui sur lecture,
    // les décodeurs sont déjà au bon endroit (aucun recalage visible).
    this.pauseAll();
    this.started.clear();
    this.primed.clear();
    this.syncAudio();
    this.warmUpcoming(true);
    this.draw();
    this.callbacks.onTime(this.timeUs);
  }

  refresh(): void {
    this.renderer.refresh();
    this.prune();
    this.releaseDistant();
    // Un clip déplacé ou rogné change sa position de départ : la pré-roulage
    // doit se refaire, sinon le décodeur attend une coupe qui a bougé.
    this.primed.clear();
    this.warmUpcoming(true);
    this.draw();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.pauseAll();
    this.started.clear();
    this.primed.clear();
    for (const element of [...this.videos.values(), ...this.audios.values()]) {
      try {
        element.removeAttribute('src');
        element.load();
      } catch {
        // ignoré
      }
    }
    this.videos.clear();
    this.audios.clear();
    this.images.clear();
    this.hidden.remove();
  }
}
