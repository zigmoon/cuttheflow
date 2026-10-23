/**
 * CUT THE FLOW — studio.
 *
 * L'interface ne fait QUE de l'édition et de la preview. L'import et l'export
 * sont délégués au moteur Rust (`/api/import`, `/api/export`) : c'est la seule
 * façon d'obtenir le même fichier sur Windows, macOS et Linux.
 */

import * as api from './api';
import { exportInBrowser, type BrowserExportResult } from './export-browser';
import { applyStatic, getLang, platformKeys, readStoredLang, setLang, t, type Lang } from './i18n';
import { Preview } from './preview';
import { TimelineView, type TimelineHost } from './timeline';
import { APP_VERSION } from './version';
import {
  EFFECTS,
  KEYFRAME_PROPS,
  MAX_SPEED,
  MIN_SPEED,
  TRANSITIONS,
  US,
  applySpeed,
  clamp,
  clipEnd,
  clipSpeed,
  createClip,
  createProject,
  createShapeClip,
  createTextClip,
  duplicateClip,
  findClip,
  firstTrackFor,
  fps,
  fpsValue,
  formatTimecode,
  keyframesFor,
  mediaById,
  needsBrowserRender,
  normalizeProject,
  parseSeconds,
  placeClip,
  quantize,
  timelineEnd,
  uid,
  valueAt,
} from './state';
import type {
  Clip,
  Easing,
  ExportFormat,
  KeyframeProp,
  Mask,
  Media,
  Project,
  ShapeKind,
  Track,
  TrackKind,
  TransitionKind,
} from './state';

const STORAGE_PROJECT = 'ctf2.project';
const STORAGE_TIME = 'ctf2.time';
const STORAGE_PREFS = 'ctf2.prefs';

/**
 * Échelles de la timeline, en pixels par seconde. La plage descend volontairement
 * très bas (0,25 px/s ≈ une heure de montage dans la largeur de l'écran) : sur un
 * projet long, on a besoin de voir l'ensemble avant de zoomer sur un détail.
 */
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

interface Prefs {
  theme: 'dark' | 'light';
  lang: Lang;
  snap: boolean;
  format: ExportFormat;
  leftPanel: boolean;
  rightPanel: boolean;
  timelineHeight: number;
  timelineCollapsed: boolean;
}

/** Les touches sont identiques partout ; seul le libellé est traduit. */
const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'sc.play'],
  ['← / →', 'sc.frame'],
  ['Shift + ← / →', 'sc.second'],
  ['Home / End', 'sc.homeEnd'],
  ['S', 'sc.split'],
  ['Del', 'sc.delete'],
  ['Ctrl + D', 'sc.duplicate'],
  ['T', 'sc.text'],
  ['R', 'sc.rect'],
  ['C', 'sc.ellipse'],
  ['N', 'sc.snap'],
  ['F', 'sc.focus'],
  ['+ / -', 'sc.zoom'],
  ['Ctrl + Shift + 0', 'sc.fitTimeline'],
  ['Ctrl + 0', 'sc.fit'],
  ['Ctrl + Z', 'sc.undo'],
  ['Ctrl + Shift + Z', 'sc.redo'],
  ['Ctrl + I', 'sc.import'],
  ['Ctrl + O', 'sc.open'],
  ['Ctrl + S', 'sc.save'],
  ['Ctrl + E', 'sc.export'],
  ['Ctrl + N', 'sc.new'],
  ['Ctrl + ,', 'sc.prefs'],
  ['?', 'sc.help'],
];

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Élément #${id} introuvable`);
  return element as T;
}

class Editor implements TimelineHost {
  project: Project;
  timeUs = 0;
  selectedClipId: string | null = null;
  zoom = 64;
  snapEnabled = true;

  private prefs: Prefs;
  private preview!: Preview;
  private timeline!: TimelineView;
  private activeTab: 'props' | 'fx' | 'transitions' = 'props';
  private saveTimer = 0;
  private exportTimer = 0;
  private currentJob: string | null = null;
  private engineOk = false;
  private engineSettled = false;
  private engineFfmpeg = '';
  private engineFont = '';
  /** Version du moteur, telle que rapportée par `/api/health`. */
  private engineVersion = '';
  /** `engine` = binaire Rust joignable ; `local` = tout se fait dans le navigateur. */
  private mode: 'engine' | 'local' = 'local';
  private browserExport: AbortController | null = null;
  private dropDepth = 0;

  // ── Historique (annuler / rétablir) ───────────────────────────────────
  // Instantanés JSON du projet : `undo` contient les états *précédents*, le
  // plus récent en dernier. `lastSnapshot` est toujours l'état du dernier point
  // de commit ; toute mutation survenue depuis forme donc une seule étape (un
  // glissement de clip = une annulation, pas soixante).
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = '';
  private static readonly HISTORY_LIMIT = 50;
  private static readonly HISTORY_BUDGET = 6_000_000;
  /** Vrai si le navigateur ne sait pas encoder la combinaison choisie. */
  private encoderBlocked = false;
  private encoderCheckToken = 0;

  constructor() {
    this.prefs = loadPrefs();
    this.snapEnabled = this.prefs.snap;
    this.project = loadProject();
    // Un projet neuf adopte le format d'export préféré ; un projet existant
    // garde le sien (le format fait partie du montage).
    if (!hasStoredProject()) this.project.export.format = this.prefs.format;
  }

  async init(): Promise<void> {
    this.applyLanguage(this.prefs.lang);
    this.applyPrefs();
    this.preview = new Preview(els.preview, this.project, {
      onTime: (timeUs) => {
        this.timeUs = timeUs;
        this.timeline?.renderPlayhead();
        this.updateTimeUi();
      },
      onPlayState: (playing) => {
        els.shell.dataset.playing = playing ? 'true' : 'false';
        this.setStatus(playing ? t('status.playing') : t('status.paused'));
      },
    });

    this.timeline = new TimelineView(this, {
      headers: els.trackHeaders,
      tracks: els.tracks,
      ruler: els.ruler,
      content: els.timelineContent,
      playhead: els.playhead,
      scroll: els.timelineScroll,
      scrub: els.timelineScrub,
      scrubFill: els.scrubFill,
      scrubKnob: els.scrubKnob,
    });

    this.bind();
    this.renderShortcuts();
    this.syncProjectUi();
    this.renderMediaList();
    this.renderAllPanels();
    this.updateTimeUi();
    this.fitPreview();
    this.setStatus(t('status.ready'));
    void this.checkEngine();
    this.restoreFromStorage();
    this.resetHistory();
    void this.revealStudio();
  }

  /** Écran d'accueil : il s'efface quand le studio est prêt, sans jamais bloquer. */
  private async revealStudio(): Promise<void> {
    const splash = document.getElementById('splash');
    if (!splash) return;
    const started = performance.now();
    while (!this.engineSettled && performance.now() - started < 2500) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const minimum = 420 - (performance.now() - started);
    if (minimum > 0) await new Promise((resolve) => setTimeout(resolve, minimum));
    splash.classList.add('is-done');
    setTimeout(() => splash.remove(), 480);
  }

  // ── TimelineHost ────────────────────────────────────────────────────

  setTime(timeUs: number): void {
    const end = timelineEnd(this.project);
    this.timeUs = clamp(quantize(timeUs), 0, Math.max(0, end));
    this.preview.seek(this.timeUs);
    this.timeline.renderPlayhead();
    this.updateTimeUi();
  }

  selectClip(clipId: string | null): void {
    this.selectedClipId = clipId;
    // Pas de reconstruction de la timeline ici : `selectClip` est appelé depuis
    // `pointerdown`, et remplacer le DOM annulerait la capture du pointeur.
    els.tracks.querySelectorAll<HTMLElement>('.clip').forEach((element) => {
      element.classList.toggle('selected', element.dataset.clipId === clipId);
    });
    this.renderAllPanels();
  }

  afterEdit(): void {
    this.preview.setProject(this.project);
    this.timeline.render();
    this.renderAllPanels();
    this.updateTimeUi();
    this.recordHistory();
    this.saveSoon();
  }

  duringEdit(): void {
    this.preview.refresh();
    this.updateDocMeta();
  }

  // ── Historique ──────────────────────────────────────────────────────

  /** Sérialisation de référence : c'est elle qui définit « même état ». */
  private snapshot(): string {
    return JSON.stringify(this.project);
  }

  /**
   * Enregistre l'état courant comme nouveau point de commit.
   *
   * Sans changement réel (curseur déplacé puis remis en place, `input` répété
   * avec la même valeur…) rien n'est empilé : l'historique ne contient que des
   * étapes utiles.
   */
  private recordHistory(): void {
    const current = this.snapshot();
    if (!this.lastSnapshot) {
      this.lastSnapshot = current;
      this.updateHistoryUi();
      return;
    }
    if (current === this.lastSnapshot) return;
    this.undoStack.push(this.lastSnapshot);
    this.redoStack.length = 0;
    this.trimHistory();
    this.lastSnapshot = current;
    this.updateHistoryUi();
  }

  /** Plafond en nombre d'étapes ET en octets : un gros projet ne mange pas la RAM. */
  private trimHistory(): void {
    while (this.undoStack.length > Editor.HISTORY_LIMIT) this.undoStack.shift();
    let total = 0;
    for (const entry of this.undoStack) total += entry.length;
    while (this.undoStack.length > 1 && total > Editor.HISTORY_BUDGET) {
      total -= this.undoStack.shift()!.length;
    }
  }

  /**
   * Oublie l'historique. Appelé quand le projet est remplacé (nouveau projet,
   * ouverture de fichier) ou quand une étape n'est plus rejouable — la
   * suppression d'un média efface son blob d'IndexedDB, donc l'annuler
   * ramènerait un clip sans source.
   */
  private resetHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lastSnapshot = this.snapshot();
    this.updateHistoryUi();
  }

  undo(): void {
    // Une saisie en cours (champ non validé, curseur relâché depuis < 700 ms)
    // devient une étape à part entière : Ctrl+Z doit reculer d'un cran, pas
    // sauter par-dessus la frappe en cours.
    this.recordHistory();
    const previous = this.undoStack.pop();
    if (!previous) {
      this.setStatus(t('history.nothing'));
      return;
    }
    this.redoStack.push(this.lastSnapshot);
    this.applySnapshot(previous);
    this.setStatus(t('history.undone'));
  }

  redo(): void {
    this.recordHistory();
    const next = this.redoStack.pop();
    if (!next) {
      this.setStatus(t('history.nothing'));
      return;
    }
    this.undoStack.push(this.lastSnapshot);
    this.applySnapshot(next);
    this.setStatus(t('history.redone'));
  }

  private applySnapshot(json: string): void {
    this.project = JSON.parse(json) as Project;
    this.lastSnapshot = json;
    if (this.selectedClipId && !findClip(this.project, this.selectedClipId)) {
      this.selectedClipId = null;
    }
    this.timeUs = clamp(this.timeUs, 0, Math.max(0, timelineEnd(this.project)));
    this.preview.setProject(this.project);
    this.preview.seek(this.timeUs);
    this.timeline.render();
    this.syncProjectUi();
    this.renderMediaList();
    this.renderAllPanels();
    this.updateTimeUi();
    this.updateHistoryUi();
    this.saveSoon();
  }

  private updateHistoryUi(): void {
    els.btnUndo.disabled = this.undoStack.length === 0;
    els.btnRedo.disabled = this.redoStack.length === 0;
  }

  /**
   * Pose un média sur la timeline.
   *
   * Deux gestes, deux règles :
   *
   * - **Dépôt depuis le chutier** (`newTrack`) : on construit **toujours** une
   *   piste neuve du type du média, insérée à la ligne survolée, et le clip
   *   tombe exactement à l'instant du dépôt. C'est le geste « poser une nouvelle
   *   couche ici ».
   * - **Ajout par clic, import** : on réutilise la première piste compatible, le
   *   clip se décale après ce qui gêne. C'est le geste « empiler à la suite ».
   */
  addMediaToTrack(
    mediaId: string,
    trackId: string | null,
    startUs: number,
    options: { newTrack?: boolean } = {},
  ): void {
    const media = mediaById(this.project, mediaId);
    if (!media) return;
    const droppedIndex = trackId
      ? this.project.tracks.findIndex((candidate) => candidate.id === trackId)
      : -1;
    const kind: TrackKind = media.kind === 'audio' ? 'audio' : 'video';

    let track: Track | undefined;
    let created = false;
    if (options.newTrack) {
      // Insertion à la ligne survolée ; sous la dernière piste, on empile à la
      // fin — il n'y a pas de ligne pour dire « ici ».
      track = this.addTrack(kind, droppedIndex >= 0 ? droppedIndex : this.project.tracks.length);
      created = true;
    } else {
      const existing = firstTrackFor(this.project, media);
      if (existing) {
        track = existing;
      } else {
        track = this.addTrack(kind, this.project.tracks.length);
        created = true;
      }
    }

    const clip = createClip(media, startUs);
    if (created) {
      // Piste neuve : le clip reste pile là où on l'a lâché. Passer par
      // `placeClip` le ferait glisser après la dernière séquence si un clip
      // traînait plus loin — exactement ce qu'on ne veut pas.
      clip.start_us = quantize(Math.max(0, startUs));
      track.clips.push(clip);
      track.clips.sort((a, b) => a.start_us - b.start_us);
    } else {
      placeClip(track, clip, startUs);
    }
    this.selectedClipId = clip.id;
    this.afterEdit();

    const message = t(created ? 'toast.placedNewTrack' : 'toast.placed', {
      name: media.name,
      track: track.name,
    });
    this.setStatus(message);
    if (created) this.toast(message, 'ok');
  }

  toggleTrackMute(trackId: string): void {
    const track = this.project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    track.muted = !track.muted;
    this.afterEdit();
  }

  setTrackVolume(trackId: string, volume: number): void {
    const track = this.project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    track.volume = clamp(volume, 0, 2);
    const input = els.trackHeaders.querySelector<HTMLInputElement>(
      `.track-header[data-track-id="${trackId}"] .track-volume`,
    );
    if (input) input.title = t('tl.trackVolume', { n: Math.round(track.volume * 100) });
    this.preview.refresh();
    this.saveSoon();
  }

  toast(message: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    const element = document.createElement('div');
    element.className = `toast ${kind}`;
    element.textContent = message;
    els.toastHost.appendChild(element);
    window.setTimeout(() => element.remove(), 4200);
  }

  // ── Liaison DOM ─────────────────────────────────────────────────────

  private bind(): void {
    els.projectName.addEventListener('input', () => {
      this.project.name = els.projectName.value || t('doc.untitled');
      this.saveSoon();
    });

    // Fichier
    els.btnNew.addEventListener('click', () => this.newProject());
    els.btnOpen.addEventListener('click', () => this.openProjectFile());
    els.btnSave.addEventListener('click', () => this.saveProjectFile());

    // Historique
    els.btnUndo.addEventListener('click', () => this.undo());
    els.btnRedo.addEventListener('click', () => this.redo());

    // Import : le panneau médias et la zone de dépôt (plus Ctrl+I)
    for (const button of [els.btnImportSide]) {
      button.addEventListener('click', () => els.fileInput.click());
    }
    els.dropZone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      const files = Array.from(els.fileInput.files ?? []);
      els.fileInput.value = '';
      void this.importFiles(files);
    });
    els.projectInput.addEventListener('change', () => {
      const file = els.projectInput.files?.[0];
      els.projectInput.value = '';
      if (file) void this.loadProjectFile(file);
    });

    this.bindDesktopDrop();

    // Lecture
    els.btnPlay.addEventListener('click', () => this.preview.toggle());
    els.btnStart.addEventListener('click', () => this.setTime(0));
    els.btnEnd.addEventListener('click', () => this.setTime(timelineEnd(this.project)));

    els.snapToggle.addEventListener('change', () => {
      this.snapEnabled = els.snapToggle.checked;
      this.prefs.snap = this.snapEnabled;
      this.persistPrefs();
      this.setStatus(this.snapEnabled ? t('status.snapOn') : t('status.snapOff'));
    });

    // Aperçu
    els.previewZoomIn.addEventListener('click', () => this.zoomPreview(1.25));
    els.previewZoomOut.addEventListener('click', () => this.zoomPreview(1 / 1.25));
    els.previewFit.addEventListener('click', () => this.fitPreview());
    // Le pourcentage n'est pas un second bouton « ajuster » : il ramène à 100 %.
    els.previewZoomValue.addEventListener('click', () => {
      this.preview.fitMode = false;
      this.preview.zoom = 1;
      this.fitPreview(false);
    });

    // Timeline
    els.btnAddVideo.addEventListener('click', () => this.addTrack('video'));
    els.btnAddAudio.addEventListener('click', () => this.addTrack('audio'));
    els.btnToolSplit.addEventListener('click', () => this.splitAtPlayhead());
    els.btnToolDuplicate.addEventListener('click', () => this.duplicateSelected());
    els.btnToolDelete.addEventListener('click', () => this.deleteSelected());
    els.btnInsertText.addEventListener('click', () => this.addText());
    els.btnInsertRect.addEventListener('click', () => this.addShape('rect'));
    els.btnInsertEllipse.addEventListener('click', () => this.addShape('ellipse'));

    els.btnZoomIn.addEventListener('click', () => this.changeZoom(1));
    els.btnZoomOut.addEventListener('click', () => this.changeZoom(-1));
    els.btnZoomFit.addEventListener('click', () => this.fitTimeline());
    // Ranger la timeline : la scène prend la place, la barre reste pour revenir.
    els.btnTimelineFocus.addEventListener('click', () => this.toggleTimelineFocus());

    els.timelineResizer.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.prefs.timelineCollapsed) return;
      const startY = event.clientY;
      const startHeight = els.shell.getBoundingClientRect().bottom -
        els.timelinePanel.getBoundingClientRect().top;
      const move = (moveEvent: PointerEvent) => {
        const height = clamp(startHeight - (moveEvent.clientY - startY), 170, window.innerHeight - 320);
        document.documentElement.style.setProperty('--timeline-h', `${Math.round(height)}px`);
        this.prefs.timelineHeight = Math.round(height);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.persistPrefs();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    // Double-clic sur la poignée : même repli que le bouton de la barre.
    els.timelineResizer.addEventListener('dblclick', () => this.toggleTimelineFocus());

    // Onglets d'outils
    document.querySelectorAll<HTMLButtonElement>('.segmented [data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeTab = (button.dataset.tab as typeof this.activeTab) ?? 'props';
        // Les panneaux cachés ne sont pas mis à jour pendant une saisie : on les
        // reconstruit ici, sinon les marges affichées seraient périmées.
        this.renderAllPanels();
      });
    });

    // Panneaux
    els.btnToggleLeft.addEventListener('click', () => this.togglePanel('left'));
    els.btnToggleRight.addEventListener('click', () => this.togglePanel('right'));

    // Thème, langue, préférences
    els.btnPreferences.addEventListener('click', () => this.openPreferences());
    els.prefsFormat.addEventListener('change', () => {
      this.prefs.format = els.prefsFormat.value as ExportFormat;
      this.project.export.format = this.prefs.format;
      this.persistPrefs();
      this.saveSoon();
      this.updateStatusBar();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => {
      button.addEventListener('click', () => this.setTheme(button.dataset.themeChoice === 'light' ? 'light' : 'dark'));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-lang-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        const choice = button.dataset.langChoice;
        this.applyLanguage(choice === 'fr' ? 'fr' : 'en');
        this.prefs.lang = getLang();
        this.persistPrefs();
      });
    });
    els.prefsShortcuts.addEventListener('click', () => {
      this.closeModal(els.prefsModal);
      this.openModal(els.helpModal);
    });

    // Aide
    els.btnHelp.addEventListener('click', () => this.openModal(els.helpModal));

    // Export
    els.btnExport.addEventListener('click', () => this.openExport());
    for (const id of ['exportFormat', 'exportQuality', 'exportResolution', 'exportFps']) {
      must<HTMLSelectElement>(id).addEventListener('change', () => this.updateExportSummary());
    }
    els.startExportBtn.addEventListener('click', () => void this.startExport());
    els.cancelExportBtn.addEventListener('click', () => void this.cancelExport());

    // Fermeture des dialogues
    document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).hasAttribute('data-close') || event.target === backdrop) {
          this.closeModal(backdrop);
        }
      });
    });

    // Propriétés / effets / transitions (délégation)
    els.toolsScroll.addEventListener('input', (event) => this.onPanelInput(event, false));
    els.toolsScroll.addEventListener('change', (event) => this.onPanelInput(event, true));
    els.toolsScroll.addEventListener('click', (event) => this.onPanelClick(event));

    // Médias (délégation)
    els.mediaList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>('.media-card');
      const mediaId = card?.dataset.mediaId;
      if (!mediaId) return;
      if (target.closest('.media-delete')) {
        void this.removeMedia(mediaId);
        return;
      }
      const media = mediaById(this.project, mediaId);
      if (!media) return;
      const track = firstTrackFor(this.project, media) ?? this.addTrack(media.kind === 'audio' ? 'audio' : 'video');
      this.addMediaToTrack(media.id, track.id, this.timeUs);
    });
    els.mediaList.addEventListener('dragstart', (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>('.media-card');
      if (!card?.dataset.mediaId || !event.dataTransfer) return;
      event.dataTransfer.setData('application/x-ctf-media', card.dataset.mediaId);
      event.dataTransfer.effectAllowed = 'copy';
    });

    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('beforeunload', () => this.persist());
    window.addEventListener('resize', () => {
      if (this.preview.fitMode) this.fitPreview();
    });
  }

  /** Glisser depuis le bureau : voile + import au relâchement. */
  private bindDesktopDrop(): void {
    const hasFiles = (event: DragEvent) =>
      Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'));

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.dropDepth += 1;
      els.dropOverlay.hidden = false;
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      this.dropDepth = Math.max(0, this.dropDepth - 1);
      if (this.dropDepth === 0) els.dropOverlay.hidden = true;
    });
    window.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.dropDepth = 0;
      els.dropOverlay.hidden = true;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) void this.importFiles(files);
    });
  }

  // ── Préférences, thème, panneaux ────────────────────────────────────

  private applyPrefs(): void {
    this.setTheme(this.prefs.theme, false);
    els.snapToggle.checked = this.prefs.snap;
    els.prefsFormat.value = this.project.export.format;
    document.documentElement.style.setProperty(
      '--timeline-h',
      `${clamp(this.prefs.timelineHeight || 306, 170, 720)}px`,
    );
    this.applyPanelVisibility();
    this.applyTimelineState();
  }

  /**
   * Applique une langue : balisage statique, libellés dynamiques, titre du
   * document. Le projet n'est pas touché — seuls les textes changent.
   */
  private applyLanguage(lang: Lang): void {
    setLang(lang);
    applyStatic();
    document.title =
      lang === 'fr' ? 'CUT THE FLOW — Studio de montage' : 'CUT THE FLOW — Editing studio';
    document
      .querySelectorAll<HTMLButtonElement>('[data-lang-choice]')
      .forEach((button) => button.classList.toggle('is-active', button.dataset.langChoice === lang));
    if (this.preview) {
      this.renderShortcuts();
      this.renderMediaList();
      this.renderAllPanels();
      this.updateDocMeta();
      this.updateTimeUi();
      this.timeline?.render();
      this.updateEngineBadge();
      this.applyTimelineState();
      if (els.prefsModal.classList.contains('is-open')) this.openPreferences();
      if (els.exportModal.classList.contains('is-open')) this.updateExportSummary();
    }
  }

  private setTheme(theme: 'dark' | 'light', persist = true): void {
    const dark = theme === 'dark';
    const root = document.documentElement;
    root.classList.toggle('theme-dark', dark);
    root.classList.toggle('theme-light', !dark);
    root.dataset.theme = theme;
    root.dataset.themeMode = theme;
    root.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0c0c0f' : '#f8f8f8');
    document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => {
      button.classList.toggle(
        'is-active',
        (button.dataset.themeChoice === 'light') === !dark,
      );
    });
    this.prefs.theme = theme;
    if (persist) {
      this.persistPrefs();
      store.set('ctf2.theme', theme);
    }
  }

  private togglePanel(side: 'left' | 'right'): void {
    if (side === 'left') this.prefs.leftPanel = !this.prefs.leftPanel;
    else this.prefs.rightPanel = !this.prefs.rightPanel;
    this.applyPanelVisibility();
    this.persistPrefs();
    if (this.preview.fitMode) window.setTimeout(() => this.fitPreview(), 0);
  }

  /** Replie la timeline sur sa barre d'outils pour donner la scène à l'aperçu. */
  private toggleTimelineFocus(): void {
    this.prefs.timelineCollapsed = !this.prefs.timelineCollapsed;
    this.applyTimelineState();
    this.persistPrefs();
    if (this.preview.fitMode) window.setTimeout(() => this.fitPreview(), 0);
  }

  private applyTimelineState(): void {
    const collapsed = this.prefs.timelineCollapsed;
    els.shell.dataset.timeline = collapsed ? 'off' : 'on';
    els.btnTimelineFocus.classList.toggle('is-active', collapsed);
    els.btnTimelineFocus.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    const label = t(collapsed ? 'tl.restore' : 'tl.focus');
    els.btnTimelineFocus.title = label;
    els.btnTimelineFocus.setAttribute('aria-label', label);
  }

  private applyPanelVisibility(): void {
    els.workspace.dataset.left = this.prefs.leftPanel ? 'on' : 'off';
    els.workspace.dataset.right = this.prefs.rightPanel ? 'on' : 'off';
    els.btnToggleLeft.classList.toggle('is-active', this.prefs.leftPanel);
    els.btnToggleRight.classList.toggle('is-active', this.prefs.rightPanel);
  }

  private persistPrefs(): void {
    store.set(STORAGE_PREFS, JSON.stringify(this.prefs));
  }

  private openPreferences(): void {
    els.prefsEngine.textContent = this.engineOk
      ? t('prefs.engine', { info: this.engineSummary() })
      : t(this.inApp ? 'prefs.engineOffApp' : 'prefs.engineOff');
    // La version affichée est celle du bundle compilé ; celle du moteur vient de
    // `/api/health`. En mode statique il n'y a pas de moteur, donc pas de ligne.
    const engine = this.engineOk && this.engineVersion ? ` · ${t('prefs.engineVersion')} ${this.engineVersion}` : '';
    els.prefsVersion.textContent = `${t('prefs.version')} ${APP_VERSION}${engine}`;
    this.openModal(els.prefsModal);
  }

  private openModal(element: HTMLElement): void {
    element.classList.add('is-open');
  }

  private closeModal(element: HTMLElement): void {
    element.classList.remove('is-open');
  }

  // ── Moteur ──────────────────────────────────────────────────────────

  /**
   * Vrai quand l'interface est servie par le binaire (application de bureau).
   *
   * Le serveur répond toujours avec sa version, même sans ffmpeg ; en
   * hébergement statique `/api/health` renvoie 404 et la version reste vide.
   * C'est ce qui permet de parler correctement à l'utilisateur : dans
   * l'application il n'y a ni onglet ni navigateur à changer, et la solution au
   * manque de ffmpeg est de l'installer.
   */
  private get inApp(): boolean {
    return this.engineVersion !== '';
  }

  /**
   * Détecte le mode. Sans moteur, l'application reste pleinement utilisable :
   * import, aperçu et export passent par le navigateur (IndexedDB + WebCodecs).
   */
  private async checkEngine(): Promise<void> {
    try {
      const info = await api.health();
      this.mode = info.mode;
      // `ok: false` avec une raison = le serveur répond mais ffmpeg manque. Ce
      // n'est pas une panne : le studio tourne en mode navigateur, on le dit
      // calmement au lieu d'afficher une erreur.
      this.engineOk = info.mode === 'engine';
      this.engineFfmpeg = info.ffmpeg;
      this.engineFont = info.font ?? '';
      this.engineVersion = info.version ?? '';
      this.updateEngineBadge();
      if (!this.engineOk && info.reason) this.toast(info.reason, 'info');
      const available = await api.listMedia();
      this.mergeServerMedia(available);
      // Les URL d'objet locales arrivent avec la liste : on redessine pour que
      // le projet restauré s'affiche sans attendre une interaction.
      this.preview.setProject(this.project);
      this.timeline.render();
      this.renderMediaList();
    } catch (error) {
      this.engineOk = false;
      this.updateEngineBadge();
      this.setStatus(t('status.engineDown'));
      this.toast(t('toast.engineDown'), 'error');
      void error;
    } finally {
      this.engineSettled = true;
    }
  }

  private updateEngineBadge(): void {
    const badge = els.engineBadge;
    // Le mode navigateur n'est PAS une panne : c'est le fonctionnement normal
    // d'un hébergement statique (app.zigmoon.com) ou d'un binaire lancé sans
    // ffmpeg. Afficher « hors ligne » en rouge y serait faux — rien n'est hors
    // ligne, le studio est pleinement utilisable — et alarmant pour rien.
    if (this.mode === 'local') {
      badge.dataset.state = 'browser';
      els.engineLabel.textContent = t(this.inApp ? 'engine.localApp' : 'engine.local');
      badge.title = t(this.inApp ? 'engine.localAppTitle' : 'engine.localTitle');
      return;
    }
    // Ici un moteur était attendu : son absence est une vraie panne.
    if (!this.engineOk) {
      badge.dataset.state = 'bad';
      els.engineLabel.textContent = t('engine.off');
      badge.title = t(this.inApp ? 'engine.lostTitleApp' : 'engine.lostTitle');
      return;
    }
    badge.dataset.state = 'ok';
    els.engineLabel.textContent = t('engine.on');
    badge.title = `${this.engineFfmpeg}\n${this.engineFont ? `font: ${this.engineFont}` : 'font: none'}`;
  }

  /** Résumé court du moteur, dans la langue courante. */
  private engineSummary(): string {
    if (this.mode === 'local') return 'WebCodecs';
    const short = this.engineFfmpeg.split(' ').slice(0, 2).join(' ');
    return this.engineFont ? `${short} · ${t('engine.fontOk')}` : short;
  }

  private mergeServerMedia(serverMedia: Media[]): void {
    const available = new Map(serverMedia.map((media) => [media.id, media]));

    // 1. Mettre à jour les métadonnées connues, ajouter les nouveaux fichiers.
    const byId = new Map(this.project.media.map((media) => [media.id, media]));
    for (const media of serverMedia) {
      const existing = byId.get(media.id);
      if (existing) Object.assign(existing, media);
      else {
        this.project.media.push(media);
        byId.set(media.id, media);
      }
    }

    // 2. Fusionner les doublons (même nom, même taille) : un fichier importé
    //    deux fois ne doit pas apparaître deux fois. L'entrée conservée est
    //    celle que des clips utilisent déjà, sinon la première.
    const usedIds = new Set(
      this.project.tracks.flatMap((track) => track.clips.map((clip) => clip.media).filter(Boolean)),
    );
    const keepByKey = new Map<string, Media>();
    const remap = new Map<string, string>();
    for (const media of this.project.media) {
      const key = `${media.name}|${media.size_bytes}`;
      const kept = keepByKey.get(key);
      if (!kept) {
        keepByKey.set(key, media);
        continue;
      }
      if (usedIds.has(kept.id) && !usedIds.has(media.id)) {
        remap.set(media.id, kept.id);
      } else if (!usedIds.has(kept.id) && usedIds.has(media.id)) {
        keepByKey.set(key, media);
        remap.set(kept.id, media.id);
      } else {
        remap.set(media.id, kept.id);
      }
    }
    if (remap.size) {
      for (const track of this.project.tracks) {
        for (const clip of track.clips) {
          if (clip.media && remap.has(clip.media)) clip.media = remap.get(clip.media)!;
        }
      }
      const survivors = new Set([...keepByKey.values()].map((media) => media.id));
      this.project.media = this.project.media.filter((media) => survivors.has(media.id));
    }

    // 3. Un média absent du registre ne peut être ni lu ni exporté : on retire
    //    ceux qui ne servent nulle part, et on SIGNALE ceux qui sont utilisés
    //    (jamais de suppression silencieuse d'un clip).
    const used = new Set(
      this.project.tracks.flatMap((track) => track.clips.map((clip) => clip.media).filter(Boolean)),
    );
    const orphans = this.project.media.filter(
      (media) => !available.has(media.id) && !used.has(media.id),
    );
    if (orphans.length) {
      const orphanIds = new Set(orphans.map((media) => media.id));
      this.project.media = this.project.media.filter((media) => !orphanIds.has(media.id));
    }
    const missing = [...used].filter((id) => id && !available.has(id));
    if (missing.length) {
      this.toast(t('toast.mediaMissing', { n: missing.length }), 'error');
    }

    this.renderMediaList();
    this.saveSoon();
  }

  // ── Import ──────────────────────────────────────────────────────────

  private async importFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    // En mode navigateur (site statique ou moteur sans ffmpeg), l'import passe
    // par IndexedDB : il ne dépend pas du moteur. Seul le mode « engine » a
    // besoin d'un moteur joignable.
    if (this.mode === 'engine' && !this.engineOk) {
      this.toast(t('toast.engineOfflineImport'), 'error');
      return;
    }
    for (const file of files) {
      this.setStatus(t('toast.importing', { name: file.name }));
      try {
        const media = await api.importMedia(file, (percent) => {
          this.setStatus(
            t('toast.importingPercent', { name: file.name, percent: Math.round(percent) }),
          );
        });
        // Le même fichier importé deux fois ne doit pas créer deux entrées :
        // on réutilise le média déjà connu (même nom, même taille) et on jette
        // le doublon côté moteur.
        const duplicate = this.project.media.find(
          (candidate) => candidate.name === media.name && candidate.size_bytes === media.size_bytes,
        );
        let effective = media;
        if (duplicate) {
          effective = duplicate;
          void api.deleteMedia(media.id).catch(() => {});
        } else {
          this.project.media.push(media);
        }
        const track =
          firstTrackFor(this.project, effective) ??
          this.addTrack(effective.kind === 'audio' ? 'audio' : 'video');
        this.addMediaToTrack(effective.id, track.id, this.timeUs);
        this.toast(t('toast.imported', { name: effective.name }), 'ok');
      } catch (error) {
        this.toast(t('toast.importFailed', { error: (error as Error).message }), 'error');
      }
    }
    this.renderMediaList();
    this.setStatus(t('status.ready'));
  }

  private async removeMedia(mediaId: string): Promise<void> {
    const media = mediaById(this.project, mediaId);
    if (!media) return;
    const used = this.project.tracks.some((track) => track.clips.some((clip) => clip.media === mediaId));
    const question = used
      ? t('toast.removeUsed', { name: media.name })
      : t('toast.removeConfirm', { name: media.name });
    if (!window.confirm(question)) return;
    this.project.media = this.project.media.filter((candidate) => candidate.id !== mediaId);
    for (const track of this.project.tracks) {
      track.clips = track.clips.filter((clip) => clip.media !== mediaId);
    }
    if (this.selectedClipId && !findClip(this.project, this.selectedClipId)) {
      this.selectedClipId = null;
    }
    try {
      await api.deleteMedia(mediaId);
    } catch {
      // le fichier peut déjà avoir disparu : l'interface reste cohérente
    }
    // Le blob vient d'être effacé d'IndexedDB : annuler ramènerait un clip sans
    // source. On repart donc d'un historique neuf plutôt que d'un état cassé.
    this.afterEdit();
    this.resetHistory();
    this.renderMediaList();
  }

  // ── Projet ──────────────────────────────────────────────────────────

  private newProject(): void {
    if (!window.confirm(t('toast.newProjectConfirm'))) return;
    this.project = createProject();
    this.project.name = t('doc.untitled');
    this.timeUs = 0;
    this.selectedClipId = null;
    this.syncProjectUi();
    this.preview.setProject(this.project);
    this.fitPreview();
    this.timeline.render();
    this.renderMediaList();
    this.renderAllPanels();
    this.updateTimeUi();
    this.persist();
    this.resetHistory();
    this.setStatus(t('status.newProject'));
  }

  private saveProjectFile(): void {
    const payload = JSON.stringify(this.project, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeFileName(this.project.name)}.ctf.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.toast(t('toast.projectSaved'), 'ok');
    this.setStatus(t('status.projectSaved'));
  }

  private openProjectFile(): void {
    els.projectInput.click();
  }

  private async loadProjectFile(file: File): Promise<void> {
    try {
      const parsed = JSON.parse(await file.text());
      const project = normalizeProject(parsed.project ?? parsed);
      const serverMedia = await api.listMedia().catch(() => [] as Media[]);
      const byId = new Map(serverMedia.map((media) => [media.id, media]));
      let missing = 0;
      for (const media of project.media) {
        const known = byId.get(media.id);
        if (known) Object.assign(media, known);
        else missing += 1;
      }
      for (const media of serverMedia) {
        if (!project.media.some((candidate) => candidate.id === media.id)) project.media.push(media);
      }
      this.project = project;
      this.timeUs = 0;
      this.selectedClipId = null;
      this.syncProjectUi();
      this.preview.setProject(this.project);
      this.fitPreview();
      this.timeline.render();
      this.renderMediaList();
      this.renderAllPanels();
      this.updateTimeUi();
      this.persist();
      this.resetHistory();
      if (missing > 0) {
        this.toast(t('toast.mediaMissing', { n: missing }), 'error');
      } else {
        this.toast(t('toast.projectLoaded'), 'ok');
      }
      this.setStatus(t('status.projectLoaded', { name: this.project.name }));
    } catch (error) {
      this.toast(t('toast.projectUnreadable', { error: (error as Error).message }), 'error');
    }
  }

  private syncProjectUi(): void {
    els.projectName.value = this.project.name;
    els.prefsFormat.value = this.project.export.format;
    this.updateDocMeta();
    this.updateStatusBar();
  }

  private updateDocMeta(): void {
    els.docMeta.textContent = `${this.project.width} × ${this.project.height} · ${t('status.fps', {
      n: roundFps(fpsValue(this.project.fps)),
    })}`;
  }

  private restoreFromStorage(): void {
    const savedTime = Number(store.get(STORAGE_TIME) || 0);
    if (savedTime > 0) this.setTime(savedTime);
    this.updateTimeUi();
  }

  private persist(): void {
    try {
      const payload = JSON.stringify(this.project);
      store.set(STORAGE_PROJECT, payload);
      store.set(STORAGE_TIME, String(Math.round(this.timeUs)));
      els.statusAutosave.dataset.state = 'saved';
      els.statusAutosaveText.textContent = t('status.auto');
    } catch {
      els.statusAutosave.dataset.state = 'error';
      els.statusAutosaveText.textContent = t('status.error');
    }
  }

  private saveSoon(): void {
    els.statusAutosave.dataset.state = 'saving';
    els.statusAutosaveText.textContent = t('status.saving');
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.persist();
      // Les réglages continus (curseurs de piste, intensité d'effet, saisie au
      // clavier dans les propriétés) ne passent pas par `afterEdit` : ce commit
      // différé les regroupe en une seule étape d'historique.
      this.recordHistory();
    }, 700);
  }

  // ── Pistes et clips ─────────────────────────────────────────────────

  private addTrack(kind: TrackKind, index = this.project.tracks.length): Track {
    const label = kind === 'video' ? 'VIDEO' : 'AUDIO';
    // Une piste insérée au milieu ne doit pas voler le nom d'une voisine.
    const taken = new Set(this.project.tracks.map((candidate) => candidate.name));
    let number = this.project.tracks.filter((candidate) => candidate.kind === kind).length + 1;
    while (taken.has(`${label} ${number}`)) number += 1;
    const track: Track = {
      id: uid(kind === 'video' ? 'v' : 'a'),
      kind,
      name: `${label} ${number}`,
      muted: false,
      volume: 1,
      clips: [],
    };
    // `splice` et non `push` : une piste créée par un dépôt apparaît **à
    // l'endroit du dépôt**, comme une ligne insérée dans une liste.
    this.project.tracks.splice(
      clamp(Math.round(index), 0, this.project.tracks.length),
      0,
      track,
    );
    this.timeline.render();
    this.saveSoon();
    return track;
  }

  private visualTrack(): Track {
    return this.project.tracks.find((candidate) => candidate.kind === 'video') ?? this.addTrack('video');
  }

  private addText(): void {
    const track = this.visualTrack();
    const clip = createTextClip(this.timeUs);
    clip.name = t('tl.textFallback');
    clip.text = { ...clip.text!, content: getLang() === 'fr' ? 'VOTRE TITRE' : 'YOUR TITLE' };
    placeClip(track, clip, this.timeUs);
    this.selectedClipId = clip.id;
    this.activeTab = 'props';
    this.afterEdit();
    this.renderTabs();
    this.setStatus(t('status.textAdded'));
  }

  private addShape(kind: ShapeKind): void {
    const track = this.visualTrack();
    const clip = createShapeClip(this.timeUs, kind);
    clip.name = t(kind === 'ellipse' ? 'shape.ellipse' : 'shape.rect');
    placeClip(track, clip, this.timeUs);
    this.selectedClipId = clip.id;
    this.activeTab = 'props';
    this.afterEdit();
    this.renderTabs();
    this.setStatus(t(kind === 'ellipse' ? 'status.ellipseAdded' : 'status.rectAdded'));
  }

  private deleteSelected(): void {
    if (!this.selectedClipId) {
      this.toast(t('toast.noClip'), 'info');
      return;
    }
    const found = findClip(this.project, this.selectedClipId);
    if (!found) return;
    found.track.clips = found.track.clips.filter((clip) => clip.id !== found.clip.id);
    this.selectedClipId = null;
    this.afterEdit();
    this.setStatus(t('status.clipDeleted'));
  }

  private duplicateSelected(): void {
    if (!this.selectedClipId) return;
    const found = findClip(this.project, this.selectedClipId);
    if (!found) return;
    const copy = duplicateClip(found.clip);
    placeClip(found.track, copy, copy.start_us);
    this.selectedClipId = copy.id;
    this.afterEdit();
    this.setStatus(t('status.clipDuplicated'));
  }

  /** Coupe le clip sélectionné (ou celui sous le playhead) au playhead. */
  private splitAtPlayhead(): void {
    let found = this.selectedClipId ? findClip(this.project, this.selectedClipId) : undefined;
    if (
      !found ||
      this.timeUs <= found.clip.start_us + 50_000 ||
      this.timeUs >= clipEnd(found.clip) - 50_000
    ) {
      found = undefined;
      for (const track of this.project.tracks) {
        const candidate = track.clips.find(
          (clip) =>
            this.timeUs > clip.start_us + 50_000 && this.timeUs < clipEnd(clip) - 50_000,
        );
        if (candidate) {
          found = { track, clip: candidate };
          break;
        }
      }
    }
    if (!found) {
      this.toast(t('toast.playheadInside'), 'error');
      return;
    }

    const { track, clip } = found;
    const cutUs = quantize(this.timeUs);
    const offset = cutUs - clip.start_us;
    const speed = clipSpeed(clip);
    const right: Clip = {
      ...clip,
      id: uid(clip.type.charAt(0)),
      start_us: cutUs,
      duration_us: clip.duration_us - offset,
      source_start_us: clip.source_start_us + Math.round(offset * speed),
      // Les clés sont locales au clip : celles de droite repartent de 0.
      keyframes: (clip.keyframes ?? [])
        .filter((key) => key.time_us >= offset)
        .map((key) => ({ ...key, time_us: key.time_us - offset })),
      fade_in_us: 0,
      transition: clip.transition ? { ...clip.transition } : null,
      effects: clip.effects ? clip.effects.map((effect) => ({ ...effect })) : [],
      text: clip.text ? { ...clip.text } : null,
      shape: clip.shape ? { ...clip.shape } : null,
    };
    clip.keyframes = (clip.keyframes ?? []).filter((key) => key.time_us < offset);
    clip.duration_us = offset;
    clip.fade_out_us = Math.min(clip.fade_out_us, offset / 2);
    clip.transition = null;

    track.clips.push(right);
    track.clips.sort((a, b) => a.start_us - b.start_us);
    this.selectedClipId = right.id;
    this.afterEdit();
    this.setStatus(t('status.clipSplit'));
  }

  // ── Panneaux ────────────────────────────────────────────────────────

  private renderTabs(): void {
    document.querySelectorAll<HTMLButtonElement>('.segmented [data-tab]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.tab === this.activeTab);
    });
    els.panelProps.hidden = this.activeTab !== 'props';
    els.panelFx.hidden = this.activeTab !== 'fx';
    els.panelTransitions.hidden = this.activeTab !== 'transitions';
    const titles: Record<typeof this.activeTab, [string, string]> = {
      props: [t('eyebrow.selection'), t('tabs.props')],
      fx: [t('eyebrow.render'), t('tabs.fx')],
      transitions: [t('eyebrow.edit'), t('tabs.transitions')],
    };
    els.toolsEyebrow.textContent = titles[this.activeTab][0];
    els.toolsTitle.textContent = titles[this.activeTab][1];
  }

  private renderAllPanels(): void {
    this.renderTabs();
    this.renderProperties();
    this.renderEffects();
    this.renderTransitions();
    const found = this.selectedClipId ? findClip(this.project, this.selectedClipId) : undefined;
    els.toolsChip.hidden = !found;
    if (found) els.toolsChip.textContent = found.clip.type;
  }

  private currentClip(): { track: Track; clip: Clip } | undefined {
    return this.selectedClipId ? findClip(this.project, this.selectedClipId) : undefined;
  }

  private renderProperties(): void {
    const found = this.currentClip();
    if (!found) {
      els.panelProps.innerHTML = `<p class="empty-hint">${escapeHtml(t('props.empty'))}</p>`;
      return;
    }
    const clip = found.clip;
    const media = mediaById(this.project, clip.media);
    const parts: string[] = [];

    parts.push(`<div class="section-title">${escapeHtml(t('props.section.clip'))}</div>`);
    parts.push(fieldText(t('field.name'), 'name', clip.name));
    parts.push(fieldNumber(t('field.start'), 'start', clip.start_us / US, 0.01));
    parts.push(fieldNumber(t('field.duration'), 'duration', clip.duration_us / US, 0.01));
    if (clip.type === 'video' || clip.type === 'audio' || clip.type === 'image') {
      parts.push(fieldNumber(t('field.sourceStart'), 'source', clip.source_start_us / US, 0.01));
    }
    parts.push(fieldRange(t('field.volume'), 'volume', clip.volume * 100, 0, 200, 1, '%'));
    parts.push(fieldNumber(t('field.fadeIn'), 'fadeIn', clip.fade_in_us / US, 0.05));
    parts.push(fieldNumber(t('field.fadeOut'), 'fadeOut', clip.fade_out_us / US, 0.05));

    parts.push(`<div class="section-title">${escapeHtml(t('props.section.composition'))}</div>`);
    parts.push(fieldRange(t('field.scale'), 'scale', clip.scale * 100, 5, 400, 1, '%'));
    parts.push(fieldRange(t('field.x'), 'x', clip.x * 100, -50, 150, 1, '%'));
    parts.push(fieldRange(t('field.y'), 'y', clip.y * 100, -50, 150, 1, '%'));
    parts.push(fieldRange(t('field.rotation'), 'rotation', clip.rotation, -180, 180, 1, '°'));
    parts.push(fieldRange(t('field.opacity'), 'opacity', clip.opacity * 100, 0, 100, 1, '%'));

    if (clip.type === 'video' || clip.type === 'audio') {
      const speed = clipSpeed(clip);
      parts.push(`<div class="section-title">${escapeHtml(t('props.section.speed'))}</div>`);
      parts.push(`
        <div class="field">
          <span>${escapeHtml(t('field.speed'))}</span>
          <div class="field-row">
            <input type="range" min="${MIN_SPEED * 100}" max="${MAX_SPEED * 100}" step="5"
                   data-prop="speed" value="${Math.round(speed * 100)}" />
            <span class="range-value" data-speed-readout>${speed.toFixed(2)}×</span>
          </div>
        </div>
        <div class="chip-row">
          ${[0.5, 0.75, 1, 1.5, 2, 4]
            .map(
              (preset) =>
                `<button type="button" class="chip ${Math.abs(preset - speed) < 0.01 ? 'is-on' : ''}"
                         data-speed="${preset}">${preset}×</button>`,
            )
            .join('')}
        </div>
        <p class="empty-hint">${escapeHtml(t('speed.hint'))}</p>
      `);
    }

    if (['video', 'image', 'text', 'shape'].includes(clip.type)) {
      parts.push(this.keyframesHtml(clip));
      parts.push(this.maskHtml(clip));
    }

    if (clip.type === 'video') {
      parts.push(`
        <label class="check-field">
          <span>${escapeHtml(t('props.audioMuted'))}</span>
          <input type="checkbox" data-prop="audioMuted" ${clip.audio_muted ? 'checked' : ''} />
        </label>
      `);
    }

    if (clip.type === 'text' && clip.text) {
      parts.push(`<div class="section-title">${escapeHtml(t('props.section.text'))}</div>`);
      parts.push(`
        <div class="field wide">
          <textarea data-prop="textContent" spellcheck="false">${escapeHtml(clip.text.content)}</textarea>
        </div>
      `);
      parts.push(fieldRange(t('field.size'), 'textSize', clip.text.size, 8, 320, 1, 'px'));
      parts.push(`
        <div class="field"><span>${escapeHtml(t('field.color'))}</span>
          <input type="color" data-prop="textColor" value="${toHex(clip.text.color)}" />
        </div>
      `);
    }

    if (clip.type === 'shape' && clip.shape) {
      parts.push(`<div class="section-title">${escapeHtml(t('props.section.shape'))}</div>`);
      parts.push(`
        <div class="field"><span>${escapeHtml(t('field.type'))}</span>
          <select data-prop="shapeKind">
            <option value="rect" ${clip.shape.kind === 'rect' ? 'selected' : ''}>${escapeHtml(t('shape.rect'))}</option>
            <option value="ellipse" ${clip.shape.kind === 'ellipse' ? 'selected' : ''}>${escapeHtml(t('shape.ellipse'))}</option>
          </select>
        </div>
      `);
      parts.push(`
        <div class="field"><span>${escapeHtml(t('field.color'))}</span>
          <input type="color" data-prop="shapeColor" value="${toHex(clip.shape.color)}" />
        </div>
      `);
      parts.push(fieldRange(t('field.width'), 'shapeWidth', clip.shape.width * 100, 1, 100, 1, '%'));
      parts.push(fieldRange(t('field.height'), 'shapeHeight', clip.shape.height * 100, 1, 100, 1, '%'));
      if (clip.shape.kind === 'rect') {
        parts.push(fieldRange(t('field.radius'), 'shapeRadius', clip.shape.radius * 200, 0, 100, 1, '%'));
      }
    }

    if (media) {
      parts.push(`
        <div class="section-title">${escapeHtml(t('props.section.source'))}</div>
        <p class="empty-hint">${escapeHtml(media.name)}${
          media.width ? ` · ${media.width}×${media.height}` : ''
        } · ${formatTimecode(media.duration_us)}</p>
      `);
    }

    parts.push(
      `<button class="btn ghost sm danger" data-action="delete-clip" style="margin-top:4px">${escapeHtml(t('props.deleteClip'))}</button>`,
    );
    els.panelProps.innerHTML = parts.join('');
  }

  private keyframesHtml(clip: Clip): string {
    const props = clip.type === 'audio' ? (['volume'] as KeyframeProp[]) : KEYFRAME_PROPS;
    const parts: string[] = [];
    parts.push(`<div class="section-title">${escapeHtml(t('props.section.keyframes'))}</div>`);
    parts.push(`<p class="empty-hint">${escapeHtml(t('kf.hint'))}</p>`);
    parts.push('<div class="kf-props">');
    for (const prop of props) {
      const keys = keyframesFor(clip, prop);
      parts.push(`
        <div class="kf-prop-row ${keys.length ? 'is-on' : ''}">
          <span class="kf-name">${escapeHtml(t(`field.${prop}`))}</span>
          <span class="kf-count">${keys.length ? escapeHtml(t('kf.count', { n: keys.length })) : '—'}</span>
          <button type="button" class="btn ghost xs" data-kf-add="${prop}"
                  title="${escapeHtml(t('kf.add'))}">◆ +</button>
          ${
            keys.length
              ? `<button type="button" class="btn ghost xs danger" data-kf-clear="${prop}"
                         title="${escapeHtml(t('kf.remove'))}">✕</button>`
              : ''
          }
        </div>
      `);
    }
    parts.push('</div>');

    const all = (clip.keyframes ?? [])
      .map((key, index) => ({ key, index }))
      .sort((a, b) => a.key.time_us - b.key.time_us || a.index - b.index);
    if (all.length) {
      parts.push('<div class="kf-keys">');
      for (const entry of all) {
        const scale = keyframeScale(entry.key.prop);
        const id = `${entry.key.prop}|${entry.key.time_us}|${entry.index}`;
        parts.push(`
          <div class="kf-key">
            <span class="kf-time">${escapeHtml(formatTimecode(entry.key.time_us))}</span>
            <span class="kf-name">${escapeHtml(t(`field.${entry.key.prop}`))}</span>
            <input type="number" class="kf-value" data-kf-value="${id}" step="${scale.step}"
                   min="${scale.min}" max="${scale.max}"
                   value="${Math.round(entry.key.value * scale.factor * 100) / 100}" />
            <span class="kf-unit">${scale.suffix}</span>
            <select data-kf-easing="${id}" title="${escapeHtml(t('kf.easing'))}">
              ${(['linear', 'ease-in', 'ease-out', 'ease-in-out'] as Easing[])
                .map(
                  (easing) =>
                    `<option value="${easing}" ${entry.key.easing === easing ? 'selected' : ''}>${escapeHtml(
                      t(`easing.${easing}`),
                    )}</option>`,
                )
                .join('')}
            </select>
            <button type="button" class="btn ghost xs danger" data-kf-del="${id}">✕</button>
          </div>
        `);
      }
      parts.push('</div>');
    }
    return parts.join('');
  }

  private maskHtml(clip: Clip): string {
    const mask = clip.mask;
    const parts: string[] = [];
    parts.push(`<div class="section-title">${escapeHtml(t('props.section.mask'))}</div>`);
    parts.push(`
      <label class="check-field">
        <span>${escapeHtml(t('mask.enable'))}</span>
        <input type="checkbox" data-prop="maskOn" ${mask ? 'checked' : ''} />
      </label>
    `);
    if (!mask) return parts.join('');
    parts.push(`<p class="empty-hint">${escapeHtml(t('mask.hint'))}</p>`);
    parts.push(`
      <div class="field"><span>${escapeHtml(t('mask.kind'))}</span>
        <select data-prop="maskKind">
          <option value="rect" ${mask.kind === 'rect' ? 'selected' : ''}>${escapeHtml(t('mask.rect'))}</option>
          <option value="ellipse" ${mask.kind === 'ellipse' ? 'selected' : ''}>${escapeHtml(t('mask.ellipse'))}</option>
        </select>
      </div>
    `);
    parts.push(fieldRange(t('mask.x'), 'maskX', mask.x * 100, -50, 150, 1, '%'));
    parts.push(fieldRange(t('mask.y'), 'maskY', mask.y * 100, -50, 150, 1, '%'));
    parts.push(fieldRange(t('mask.width'), 'maskWidth', mask.width * 100, 1, 100, 1, '%'));
    parts.push(fieldRange(t('mask.height'), 'maskHeight', mask.height * 100, 1, 100, 1, '%'));
    parts.push(fieldRange(t('mask.feather'), 'maskFeather', mask.feather * 100, 0, 100, 1, '%'));
    parts.push(`
      <label class="check-field">
        <span>${escapeHtml(t('mask.invert'))}</span>
        <input type="checkbox" data-prop="maskInvert" ${mask.invert ? 'checked' : ''} />
      </label>
    `);
    return parts.join('');
  }

  private renderEffects(): void {
    const found = this.currentClip();
    const clip = found?.clip;
    const active = new Map((clip?.effects ?? []).map((effect) => [effect.name, effect.amount]));

    const parts: string[] = [];
    if (!clip) {
      parts.push(`<p class="empty-hint">${escapeHtml(t('fx.empty'))}</p>`);
    } else if (clip.type === 'audio') {
      parts.push(`<p class="empty-hint">${escapeHtml(t('fx.audioOnly'))}</p>`);
    } else {
      parts.push(`<p class="empty-hint">${escapeHtml(t('fx.intro'))}</p>`);
      for (const definition of EFFECTS) {
        const on = active.has(definition.name);
        const amount = active.get(definition.name) ?? 0.5;
        parts.push(`
          <div class="fx-item ${on ? 'is-on' : ''}" data-effect="${definition.name}">
            <label class="fx-head">
              <span class="fx-toggle">
                <input type="checkbox" data-effect-toggle="${definition.name}" ${on ? 'checked' : ''} />
                <span></span>
              </span>
              <span class="fx-name">${escapeHtml(t(`fx.${definition.name}.label`))}</span>
              <span class="fx-preview">${escapeHtml(t(`fx.${definition.name}.hint`))}</span>
            </label>
            ${
              on
                ? `<div class="fx-body">
                     <div class="field">
                       <span>${escapeHtml(t('field.intensity'))}</span>
                       <input type="range" min="0" max="100" step="1"
                              data-effect-amount="${definition.name}" value="${Math.round(amount * 100)}" />
                     </div>
                     <div class="range-value" data-effect-readout="${definition.name}">${Math.round(
                       amount * 100,
                     )} %</div>
                   </div>`
                : ''
            }
          </div>
        `);
      }
    }
    els.panelFx.innerHTML = parts.join('');
  }

  private renderTransitions(): void {
    const found = this.currentClip();
    const clip = found?.clip;
    const parts: string[] = [];

    if (!clip) {
      parts.push(`<p class="empty-hint">${escapeHtml(t('tr.empty'))}</p>`);
    } else if (!['video', 'image', 'text', 'shape'].includes(clip.type)) {
      parts.push(`<p class="empty-hint">${escapeHtml(t('tr.visualOnly'))}</p>`);
    } else {
      const current = clip.transition?.kind ?? null;
      parts.push(`<p class="empty-hint">${escapeHtml(t('tr.intro'))}</p>`);
      for (const definition of TRANSITIONS) {
        const on = current === definition.kind;
        parts.push(`
          <button type="button" class="transition-card ${on ? 'is-on' : ''}"
                  data-transition="${definition.kind}">
            <span class="transition-icon">
              <svg viewBox="0 0 24 24"><use href="#i-transition"></use></svg>
            </span>
            <span class="transition-copy">
              <strong>${escapeHtml(t(`tr.${definition.kind}.label`))}</strong>
              <small>${escapeHtml(t(`tr.${definition.kind}.hint`))}</small>
            </span>
          </button>
        `);
      }
      if (current) {
        const seconds = clip.transition!.duration_us / US;
        parts.push(`
          <div class="field">
            <span>${escapeHtml(t('field.durationShort'))}</span>
            <div class="field-row">
              <input type="range" min="1" max="100" step="1" data-prop="transitionDuration"
                     value="${Math.round(seconds * 20)}" />
              <span class="range-value" data-transition-readout>${seconds.toFixed(2)} s</span>
            </div>
          </div>
        `);
        parts.push(
          `<button class="btn ghost sm danger" data-action="clear-transition">${escapeHtml(t('tr.clear'))}</button>`,
        );
      }

      const previous = this.previousClip(found.track, clip);
      if (previous) {
        const gap = clip.start_us - clipEnd(previous);
        const before = Math.max(0, clip.source_start_us);
        const previousMedia = mediaById(this.project, previous.media);
        const after = previousMedia
          ? Math.max(0, previousMedia.duration_us - previous.source_start_us - previous.duration_us)
          : 0;
        const dissolve = clip.transition?.kind === 'dissolve' ? clip.transition : null;
        const effective = dissolve && gap === 0
          ? Math.max(
              0,
              Math.min(
                dissolve.duration_us,
                before,
                after,
                clip.duration_us / 2,
                previous.duration_us / 2,
              ),
            )
          : 0;
        const warning = !dissolve
          ? ''
          : gap !== 0
            ? `<br /><span class="hint-warn">${escapeHtml(t('tr.warnGap'))}</span>`
            : effective === 0
              ? `<br /><span class="hint-warn">${escapeHtml(t('tr.warnMargin'))}</span>`
              : effective < dissolve.duration_us
                ? `<br /><span class="hint-warn">${escapeHtml(
                    t('tr.warnReduced', { time: formatTimecode(effective) }),
                  )}</span>`
                : '';
        parts.push(`
          <div class="section-title">${escapeHtml(t('tr.margins'))}</div>
          <p class="empty-hint">
            ${escapeHtml(t('tr.gap'))} <strong>${
              gap === 0 ? escapeHtml(t('tr.gapNone')) : formatTimecode(Math.abs(gap))
            }</strong><br />
            ${escapeHtml(t('tr.before'))} <strong>${formatTimecode(before)}</strong><br />
            ${escapeHtml(t('tr.after'))} <strong>${formatTimecode(after)}</strong>${warning}
          </p>
        `);
      } else {
        parts.push(`<p class="empty-hint">${escapeHtml(t('tr.noPrevious'))}</p>`);
      }
    }
    els.panelTransitions.innerHTML = parts.join('');
  }

  private previousClip(track: Track, clip: Clip): Clip | undefined {
    let best: Clip | undefined;
    for (const candidate of track.clips) {
      if (candidate.id === clip.id) continue;
      if (clipEnd(candidate) <= clip.start_us && (!best || clipEnd(candidate) > clipEnd(best))) {
        best = candidate;
      }
    }
    return best;
  }

  private onPanelInput(event: Event, commit: boolean): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    const toggle = target.dataset.effectToggle;
    if (toggle) {
      this.toggleEffect(toggle, (target as HTMLInputElement).checked);
      return;
    }
    const amount = target.dataset.effectAmount;
    if (amount) {
      const found = this.currentClip();
      const effect = found?.clip.effects?.find((candidate) => candidate.name === amount);
      if (effect) {
        effect.amount = clamp(Number(target.value) / 100, 0, 1);
        const readout = els.toolsScroll.querySelector<HTMLElement>(`[data-effect-readout="${amount}"]`);
        if (readout) readout.textContent = `${Math.round(effect.amount * 100)} %`;
        this.preview.refresh();
        this.saveSoon();
      }
      return;
    }

    const kfValue = target.dataset.kfValue;
    if (kfValue) {
      this.editKeyframe(kfValue, Number(target.value), null);
      return;
    }
    const kfEasing = target.dataset.kfEasing;
    if (kfEasing) {
      this.editKeyframe(kfEasing, null, target.value as Easing);
      return;
    }

    const property = target.dataset.prop;
    if (!property) return;
    const found = this.currentClip();
    if (!found) return;
    const clip = found.clip;
    const media = mediaById(this.project, clip.media);

    switch (property) {
      case 'name':
        clip.name = target.value;
        break;
      case 'start':
        clip.start_us = Math.max(0, parseSeconds(target.value));
        target.value = (clip.start_us / US).toFixed(2);
        break;
      case 'duration': {
        let duration = Math.max(100_000, parseSeconds(target.value));
        if ((clip.type === 'video' || clip.type === 'audio') && media) {
          const available = Math.max(100_000, media.duration_us - clip.source_start_us);
          duration = Math.min(duration, Math.round(available / clipSpeed(clip)));
        }
        clip.duration_us = duration;
        target.value = (duration / US).toFixed(2);
        break;
      }
      case 'source': {
        if (!media) break;
        clip.source_start_us = clamp(parseSeconds(target.value), 0, Math.max(0, media.duration_us - 100_000));
        const span = clip.duration_us * clipSpeed(clip);
        if (clip.source_start_us + span > media.duration_us) {
          clip.duration_us = Math.max(100_000, Math.round((media.duration_us - clip.source_start_us) / clipSpeed(clip)));
        }
        target.value = (clip.source_start_us / US).toFixed(2);
        break;
      }
      case 'volume':
        clip.volume = clamp(Number(target.value) / 100, 0, 2);
        break;
      case 'fadeIn':
        clip.fade_in_us = clamp(parseSeconds(target.value), 0, clip.duration_us / 2);
        target.value = (clip.fade_in_us / US).toFixed(2);
        break;
      case 'fadeOut':
        clip.fade_out_us = clamp(parseSeconds(target.value), 0, clip.duration_us / 2);
        target.value = (clip.fade_out_us / US).toFixed(2);
        break;
      case 'scale':
        clip.scale = clamp(Number(target.value) / 100, 0.05, 20);
        break;
      case 'x':
        clip.x = clamp(Number(target.value) / 100, -1, 2);
        break;
      case 'y':
        clip.y = clamp(Number(target.value) / 100, -1, 2);
        break;
      case 'rotation':
        clip.rotation = clamp(Number(target.value), -360, 360);
        break;
      case 'opacity':
        clip.opacity = clamp(Number(target.value) / 100, 0, 1);
        break;
      case 'speed': {
        const next = clamp(Number(target.value) / 100, MIN_SPEED, MAX_SPEED);
        applySpeed(clip, media, next);
        const readout = els.toolsScroll.querySelector<HTMLElement>('[data-speed-readout]');
        if (readout) readout.textContent = `${clipSpeed(clip).toFixed(2)}×`;
        break;
      }
      case 'maskOn':
        clip.mask = (target as HTMLInputElement).checked
          ? ({ kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.5, feather: 0.05, invert: false } as Mask)
          : null;
        break;
      case 'maskKind':
        if (clip.mask) clip.mask.kind = target.value === 'ellipse' ? 'ellipse' : 'rect';
        break;
      case 'maskX':
        if (clip.mask) clip.mask.x = clamp(Number(target.value) / 100, -1, 2);
        break;
      case 'maskY':
        if (clip.mask) clip.mask.y = clamp(Number(target.value) / 100, -1, 2);
        break;
      case 'maskWidth':
        if (clip.mask) clip.mask.width = clamp(Number(target.value) / 100, 0.01, 2);
        break;
      case 'maskHeight':
        if (clip.mask) clip.mask.height = clamp(Number(target.value) / 100, 0.01, 2);
        break;
      case 'maskFeather':
        if (clip.mask) clip.mask.feather = clamp(Number(target.value) / 100, 0, 1);
        break;
      case 'maskInvert':
        if (clip.mask) clip.mask.invert = (target as HTMLInputElement).checked;
        break;
      case 'audioMuted':
        clip.audio_muted = (target as HTMLInputElement).checked;
        break;
      case 'textContent':
        if (clip.text) clip.text.content = target.value;
        break;
      case 'textSize':
        if (clip.text) clip.text.size = clamp(Number(target.value), 8, 512);
        break;
      case 'textColor':
        if (clip.text) clip.text.color = target.value;
        break;
      case 'shapeKind':
        if (clip.shape) {
          clip.shape.kind = target.value === 'ellipse' ? 'ellipse' : 'rect';
          if (clip.shape.kind === 'ellipse') clip.shape.radius = 0.5;
          if (commit) this.renderProperties();
        }
        break;
      case 'shapeColor':
        if (clip.shape) clip.shape.color = target.value;
        break;
      case 'shapeWidth':
        if (clip.shape) clip.shape.width = clamp(Number(target.value) / 100, 0.01, 1);
        break;
      case 'shapeHeight':
        if (clip.shape) clip.shape.height = clamp(Number(target.value) / 100, 0.01, 1);
        break;
      case 'shapeRadius':
        if (clip.shape) clip.shape.radius = clamp(Number(target.value) / 200, 0, 0.5);
        break;
      case 'transitionDuration':
        if (clip.transition) {
          clip.transition.duration_us = clamp(
            Math.round((Number(target.value) / 20) * US),
            50_000,
            clip.duration_us / 2,
          );
          const readout = els.toolsScroll.querySelector<HTMLElement>('[data-transition-readout]');
          if (readout) readout.textContent = `${(clip.transition.duration_us / US).toFixed(2)} s`;
        }
        break;
      default:
        return;
    }

    this.timeline.updateClipElement(clip);
    this.preview.refresh();
    if (commit) {
      this.timeline.render();
      this.updateTimeUi();
      // Les marges de transition dépendent du début, de la durée et du point de
      // sortie : on les rafraîchit sans reconstruire les champs en cours de saisie.
      this.renderTransitions();
      // Activer un masque (ou changer sa forme) ajoute/retire des champs.
      if (property === 'maskOn' || property === 'maskKind') this.renderProperties();
      this.saveSoon();
    }
  }

  private onPanelClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-action="delete-clip"]')) {
      this.deleteSelected();
      return;
    }
    const speed = target.closest<HTMLElement>('[data-speed]');
    if (speed?.dataset.speed) {
      const found = this.currentClip();
      if (found) {
        const media = mediaById(this.project, found.clip.media);
        applySpeed(found.clip, media, Number(speed.dataset.speed));
        this.afterEdit();
        this.renderProperties();
      }
      return;
    }
    const kfAdd = target.closest<HTMLElement>('[data-kf-add]');
    if (kfAdd?.dataset.kfAdd) {
      this.addKeyframe(kfAdd.dataset.kfAdd as KeyframeProp);
      return;
    }
    const kfClear = target.closest<HTMLElement>('[data-kf-clear]');
    if (kfClear?.dataset.kfClear) {
      this.clearKeyframes(kfClear.dataset.kfClear as KeyframeProp);
      return;
    }
    const kfDel = target.closest<HTMLElement>('[data-kf-del]');
    if (kfDel?.dataset.kfDel) {
      this.deleteKeyframe(kfDel.dataset.kfDel);
      return;
    }
    if (target.closest('[data-action="clear-transition"]')) {
      const found = this.currentClip();
      if (found) {
        found.clip.transition = null;
        this.afterEdit();
        this.renderTransitions();
      }
      return;
    }
    const transition = target.closest<HTMLElement>('[data-transition]');
    if (transition?.dataset.transition) {
      this.applyTransition(transition.dataset.transition as TransitionKind);
    }
  }

  private toggleEffect(name: string, enabled: boolean): void {
    const found = this.currentClip();
    if (!found) return;
    const clip = found.clip;
    clip.effects = clip.effects ?? [];
    if (enabled) {
      if (!clip.effects.some((effect) => effect.name === name)) {
        clip.effects.push({ name, amount: 0.5 });
      }
    } else {
      clip.effects = clip.effects.filter((effect) => effect.name !== name);
    }
    this.afterEdit();
    this.renderEffects();
  }

  private applyTransition(kind: TransitionKind): void {
    const found = this.currentClip();
    if (!found) return;
    const { clip } = found;
    if (clip.transition?.kind === kind) {
      clip.transition = null;
    } else {
      clip.transition = {
        kind,
        duration_us: clip.transition?.duration_us ?? Math.min(500_000, clip.duration_us / 2),
      };
    }
    this.afterEdit();
    this.renderTransitions();
  }

  // ── Keyframes ───────────────────────────────────────────────────────

  /** Pose une clé à la tête de lecture avec la valeur courante de la propriété. */
  private addKeyframe(prop: KeyframeProp): void {
    const found = this.currentClip();
    if (!found) return;
    const { clip } = found;
    clip.keyframes = clip.keyframes ?? [];
    const local = Math.max(0, Math.round(this.timeUs - clip.start_us));
    const value = valueAt(clip, prop, local);
    const existing = clip.keyframes.find(
      (key) => key.prop === prop && Math.abs(key.time_us - local) < 1000,
    );
    if (existing) {
      // Deuxième clic au même endroit : on retire la clé (comportement chrono).
      clip.keyframes = clip.keyframes.filter((key) => key !== existing);
    } else {
      clip.keyframes.push({ prop, time_us: local, value, easing: 'linear' });
      clip.keyframes.sort((a, b) => a.time_us - b.time_us);
    }
    this.afterEdit();
    this.renderProperties();
    this.setStatus(t('kf.count', { n: keyframesFor(clip, prop).length }));
  }

  private clearKeyframes(prop: KeyframeProp): void {
    const found = this.currentClip();
    if (!found) return;
    found.clip.keyframes = (found.clip.keyframes ?? []).filter((key) => key.prop !== prop);
    this.afterEdit();
    this.renderProperties();
  }

  private deleteKeyframe(id: string): void {
    const found = this.currentClip();
    if (!found) return;
    const [prop, time, index] = id.split('|');
    const list = found.clip.keyframes ?? [];
    const key = list[Number(index)];
    if (!key || key.prop !== prop || String(key.time_us) !== time) return;
    found.clip.keyframes = list.filter((candidate) => candidate !== key);
    this.afterEdit();
    this.renderProperties();
  }

  private editKeyframe(id: string, value: number | null, easing: Easing | null): void {
    const found = this.currentClip();
    if (!found) return;
    const [prop, time, index] = id.split('|');
    const key = (found.clip.keyframes ?? [])[Number(index)];
    if (!key || key.prop !== prop || String(key.time_us) !== time) return;
    if (easing) key.easing = easing;
    if (value !== null && Number.isFinite(value)) {
      key.value = value / keyframeScale(key.prop).factor;
    }
    this.preview.refresh();
    this.timeline.updateClipElement(found.clip);
    this.saveSoon();
  }

  // ── Temps et statut ─────────────────────────────────────────────────

  private updateTimeUi(): void {
    const end = timelineEnd(this.project);
    els.timeLabel.textContent = formatTimecode(this.timeUs);
    els.durationLabel.textContent = formatTimecode(end);
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const end = timelineEnd(this.project);
    const clips = this.project.tracks.reduce((total, track) => total + track.clips.length, 0);
    els.statusFormat.textContent = this.project.export.format.toUpperCase();
    els.statusDuration.textContent = formatTimecode(end);
    els.statusClips.textContent = t('status.clips', { n: clips });
    els.statusZoom.textContent = `${this.zoom < 10 ? this.zoom.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : Math.round(this.zoom)} px/s`;
    els.previewZoomValue.textContent = `${Math.round(this.preview.scale * 100)} %`;
    els.emptyState.hidden = clips > 0;
    els.canvasStack.hidden = clips === 0;
  }

  private setStatus(message: string): void {
    els.statusMessage.textContent = message;
  }

  private changeZoom(direction: number): void {
    const current = this.zoom;
    const next =
      direction > 0
        ? ZOOM_STEPS.find((step) => step > current + 0.5)
        : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.5);
    if (next === undefined) return;
    // Repère : le centre de la vue. Sans cela, dézoomer ferait sauter le montage
    // hors de l'écran à chaque cran.
    const view = els.timelineScroll;
    const offset = view.clientWidth / 2;
    this.setZoomAt(next, ((view.scrollLeft + offset) / current) * US, offset);
  }

  /**
   * Zoom molette (Ctrl/⌘ + molette) **centré sur le curseur** : le temps sous la
   * souris reste sous la souris. Sans cela, le navigateur zoome toute
   * l'interface — le studio devenait inutilisable après deux coups de molette.
   */
  zoomTimeline(factor: number, anchorUs: number, offsetPx: number): void {
    this.setZoomAt(this.zoom * factor, anchorUs, offsetPx);
  }

  private setZoomAt(next: number, anchorUs: number, offsetPx: number): void {
    const value = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(value - this.zoom) < 0.01) return;
    this.zoom = value;
    this.timeline.render();
    els.timelineScroll.scrollLeft = Math.max(0, (anchorUs / US) * value - offsetPx);
    this.updateStatusBar();
  }

  /** Cadre tout le montage dans la largeur visible (bouton de zoom, Ctrl+Maj+0). */
  fitTimeline(): void {
    const view = els.timelineScroll;
    const end = Math.max(US, timelineEnd(this.project));
    const usable = Math.max(120, view.clientWidth - 24);
    this.zoom = clamp(usable / (end / US), MIN_ZOOM, MAX_ZOOM);
    this.timeline.render();
    view.scrollLeft = 0;
    this.updateStatusBar();
  }

  private zoomPreview(factor: number): void {
    this.preview.fitMode = false;
    this.preview.zoom = clamp(this.preview.zoom * factor, 0.2, 4);
    this.fitPreview(false);
  }

  private fitPreview(reset = true): void {
    if (!this.preview) return;
    if (reset) {
      this.preview.fitMode = true;
      this.preview.zoom = 1;
    }
    const bounds = els.viewport.getBoundingClientRect();
    this.preview.configureCanvas(
      Math.max(120, bounds.width - 96),
      Math.max(80, bounds.height - 96),
    );
    this.updateStatusBar();
  }

  // ── Rendu annexe ────────────────────────────────────────────────────

  private renderMediaList(): void {
    if (!this.project.media.length) {
      els.mediaList.innerHTML = `<p class="empty-hint">${escapeHtml(t('media.empty'))}</p>`;
      return;
    }
    const cards = [...this.project.media]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((media) => {
        const meta =
          media.kind === 'audio'
            ? `${formatTimecode(media.duration_us)} · ${media.sample_rate || 48_000} Hz`
            : `${formatTimecode(media.duration_us)} · ${media.width}×${media.height}`;
        const thumb =
          media.kind === 'audio'
            ? '<span class="media-thumb audio"><svg viewBox="0 0 24 24"><use href="#i-music"></use></svg></span>'
            : `<img class="media-thumb" src="${api.thumbnailUrl(media.id)}" alt="" loading="lazy"
                 onerror="this.style.visibility='hidden'" />`;
        return `
          <article class="media-card" draggable="true" data-media-id="${media.id}"
                   role="listitem" title="${escapeHtml(t('media.cardTitle', { name: media.name }))}">
            ${thumb}
            <div class="media-info">
              <div class="media-name">${escapeHtml(media.name)}</div>
              <div class="media-meta">${meta}</div>
            </div>
            <button class="media-delete" title="${escapeHtml(t('media.remove'))}" aria-label="${escapeHtml(
              t('media.remove'),
            )}">
              <svg viewBox="0 0 24 24"><use href="#i-close"></use></svg>
            </button>
          </article>
        `;
      });
    els.mediaList.innerHTML = cards.join('');
  }

  private renderShortcuts(): void {
    els.shortcutGrid.innerHTML = SHORTCUTS.map(
      ([keys, key]) =>
        `<div class="shortcut-row"><span>${escapeHtml(t(key))}</span><kbd>${escapeHtml(platformKeys(keys))}</kbd></div>`,
    ).join('');
  }

  // ── Clavier ─────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable;

    if (event.key === 'Escape') {
      document.querySelectorAll<HTMLElement>('.modal-backdrop.is-open').forEach((modal) => this.closeModal(modal));
      if (typing && target instanceof HTMLElement) target.blur();
      return;
    }
    if (typing) return;

    const meta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (meta) {
      switch (key) {
        case 'z':
          event.preventDefault();
          // Ctrl+Shift+Z : rétablir (convention macOS/Firefox/Chrome).
          if (event.shiftKey) this.redo();
          else this.undo();
          return;
        case 'y':
          event.preventDefault();
          this.redo();
          return;
        case 's':
          event.preventDefault();
          this.saveProjectFile();
          return;
        case 'o':
          event.preventDefault();
          this.openProjectFile();
          return;
        case 'n':
          event.preventDefault();
          this.newProject();
          return;
        case 'e':
          event.preventDefault();
          this.openExport();
          return;
        case 'i':
          event.preventDefault();
          els.fileInput.click();
          return;
        case 'd':
          event.preventDefault();
          this.duplicateSelected();
          return;
        case ',':
          event.preventDefault();
          this.openPreferences();
          return;
        case '0':
          event.preventDefault();
          // Ctrl+Maj+0 cadre le montage, Ctrl+0 (seul) ajuste l'aperçu.
          if (event.shiftKey) this.fitTimeline();
          else this.fitPreview();
          return;
        default:
          return;
      }
    }

    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.preview.toggle();
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.deleteSelected();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.setTime(this.timeUs - (event.shiftKey ? US : US / fpsValue(this.project.fps)));
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.setTime(this.timeUs + (event.shiftKey ? US : US / fpsValue(this.project.fps)));
        break;
      case 'Home':
        event.preventDefault();
        this.setTime(0);
        break;
      case 'End':
        event.preventDefault();
        this.setTime(timelineEnd(this.project));
        break;
      case '+':
      case '=':
        event.preventDefault();
        this.changeZoom(1);
        break;
      case '-':
        event.preventDefault();
        this.changeZoom(-1);
        break;
      case '?':
        event.preventDefault();
        this.openModal(els.helpModal);
        break;
      default:
        break;
    }

    switch (key) {
      case 's':
        event.preventDefault();
        this.splitAtPlayhead();
        break;
      case 't':
        event.preventDefault();
        this.addText();
        break;
      case 'r':
        event.preventDefault();
        this.addShape('rect');
        break;
      case 'c':
        event.preventDefault();
        this.addShape('ellipse');
        break;
      case 'n':
        event.preventDefault();
        els.snapToggle.checked = !els.snapToggle.checked;
        els.snapToggle.dispatchEvent(new Event('change'));
        break;
      case 'f':
        event.preventDefault();
        this.toggleTimelineFocus();
        break;
      default:
        break;
    }
  }

  // ── Export ──────────────────────────────────────────────────────────

  private openExport(): void {
    if (timelineEnd(this.project) <= 0) {
      this.toast('La timeline est vide : ajoutez au moins un clip.', 'error');
      return;
    }
    els.exportResolution.value = `${this.project.width}x${this.project.height}`;
    if (!els.exportResolution.value) {
      const option = document.createElement('option');
      option.value = `${this.project.width}x${this.project.height}`;
      option.textContent = `${this.project.width} × ${this.project.height}`;
      els.exportResolution.appendChild(option);
      els.exportResolution.value = option.value;
    }
    els.exportFps.value = String(roundFps(fpsValue(this.project.fps)));
    els.exportFormat.value = this.project.export.format;
    els.exportError.hidden = true;
    els.exportError.textContent = '';
    // Le résultat de l'export précédent reste dans le DOM sinon : un lien
    // `blob:` mort, et un `download` périmé que rien ne distingue du nouveau.
    els.exportResult.innerHTML = '';
    els.exportResult.hidden = true;
    els.exportProgress.hidden = true;
    els.startExportBtn.disabled = false;
    els.startExportBtn.hidden = false;
    els.cancelExportBtn.hidden = true;
    this.updateExportSummary();
    this.openModal(els.exportModal);
  }

  private qualityCrf(format: ExportFormat): number {
    const quality = els.exportQuality.value;
    if (format === 'webm') return quality === 'high' ? 30 : quality === 'medium' ? 34 : 38;
    return quality === 'high' ? 18 : quality === 'medium' ? 22 : 26;
  }

  private exportProject(): Project {
    const [width, height] = els.exportResolution.value.split('x').map(Number);
    const project: Project = structuredClone(this.project);
    project.width = width || 1920;
    project.height = height || 1080;
    project.fps = fps(Number(els.exportFps.value));
    project.export.format = els.exportFormat.value as ExportFormat;
    project.export.crf = this.qualityCrf(project.export.format);
    project.export.preset = 'medium';
    return project;
  }

  private updateExportSummary(): void {
    const project = this.exportProject();
    const end = timelineEnd(project);
    const frames = Math.ceil((end / US) * fpsValue(project.fps));
    const clips = project.tracks.reduce((total, track) => total + track.clips.length, 0);
    const effects = project.tracks.reduce(
      (total, track) => total + track.clips.reduce((sum, clip) => sum + (clip.effects?.length ?? 0), 0),
      0,
    );
    const transitions = project.tracks.reduce(
      (total, track) => total + track.clips.filter((clip) => clip.transition).length,
      0,
    );
    const audioOnly = project.export.format === 'mp3';
    const first = audioOnly
      ? t('export.audioOnly')
      : t('export.summaryVideo', {
          format: project.export.format.toUpperCase(),
          width: project.width,
          height: project.height,
          fps: roundFps(fpsValue(project.fps)),
        });
    const clipText = t('status.clips', { n: clips });
    const second = audioOnly
      ? t('export.summaryAudioLine', { time: formatTimecode(end), clips: clipText })
      : t('export.summaryVideoLine', {
          time: formatTimecode(end),
          frames,
          clips: clipText,
          effects: effects ? t('export.effects', { n: effects }) : '',
          transitions: transitions ? t('export.transitions', { n: transitions }) : '',
        });
    // Un projet à keyframes / masque / vitesse passe par le navigateur : le
    // moteur natif ne sait pas encore les rendre, et un export silencieusement
    // faux est pire qu'un export plus lent mais annoncé.
    const browserOnly = this.mode === 'local' || needsBrowserRender(this.project);
    const hint = browserOnly
      ? t(audioOnly ? 'export.hintAudioBrowser' : 'export.hintVideoBrowser')
      : t(audioOnly ? 'export.hintAudio' : 'export.hintVideo');
    const fallback =
      this.mode !== 'local' && needsBrowserRender(this.project)
        ? `<br /><span class="hint warn">${escapeHtml(t('export.hintEngineFallback'))}</span>`
        : '';
    els.exportSummary.innerHTML = `
      ${first}<br />
      ${second}<br />
      <span class="hint">${escapeHtml(hint)}</span>${fallback}
    `;
    void this.checkEncoders();
  }

  /**
   * Vérifie **avant** l'export que le navigateur sait encoder la combinaison
   * choisie. Proposer 4K H.264 puis échouer après vingt secondes de composition
   * est le pire des comportements : ici le bouton est bloqué et la raison est
   * écrite noir sur blanc, à côté des réglages concernés.
   */
  private async checkEncoders(): Promise<void> {
    const token = ++this.encoderCheckToken;
    const notice = els.exportEncoderNotice;
    const settle = (blocked: boolean, message = ''): void => {
      // Une vérification plus récente a pris la main : on ignore ce résultat.
      if (token !== this.encoderCheckToken) return;
      this.encoderBlocked = blocked;
      notice.textContent = message;
      notice.hidden = !blocked;
      // Un export en cours gère lui-même l'état du bouton.
      if (els.exportProgress.hidden) els.startExportBtn.disabled = blocked;
    };

    const format = els.exportFormat.value as ExportFormat;
    const browserPath = this.mode === 'local' || needsBrowserRender(this.project);
    if (!browserPath || format === 'mp3' || typeof VideoEncoder === 'undefined') {
      settle(false);
      return;
    }

    const [width, height] = els.exportResolution.value.split('x').map(Number);
    if (!width || !height) {
      settle(false);
      return;
    }
    const framerate = Number(els.exportFps.value) || 30;
    const candidates =
      format === 'webm'
        ? ['vp09.00.10.08', 'vp8']
        : ['avc1.640028', 'avc1.4D4028', 'avc1.42E028', 'avc1.42E01F'];

    for (const codec of candidates) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate: 8_000_000,
          framerate,
        });
        if (support.supported) {
          settle(false);
          return;
        }
      } catch {
        // codec inconnu de ce navigateur : on essaie le suivant
      }
    }
    settle(true, t('export.encoderUnsupported', { format: format.toUpperCase(), width, height }));
  }

  private async startExport(): Promise<void> {
    // Seul l'export par ffmpeg exige un moteur joignable ; en mode navigateur
    // (WebCodecs) l'absence de moteur est normale, pas une panne.
    if (this.mode === 'engine' && !this.engineOk) {
      this.toast(t('toast.engineOfflineExport'), 'error');
      return;
    }
    // Filet de sécurité : le bouton est déjà désactivé par `checkEncoders`, mais
    // un clic programmé (ou un état périmé) ne doit pas lancer un export voué à
    // l'échec.
    if (this.encoderBlocked) {
      this.toast(els.exportEncoderNotice.textContent || '', 'error');
      return;
    }
    const project = this.exportProject();
    els.startExportBtn.disabled = true;
    els.cancelExportBtn.hidden = false;
    els.exportError.hidden = true;
    els.exportError.textContent = '';
    els.exportResult.hidden = true;
    els.exportProgress.hidden = false;
    els.exportProgressFill.style.width = '0%';
    els.exportStage.textContent = t('export.sending');
    els.exportPercent.textContent = '0 %';

    if (this.mode === 'local' || needsBrowserRender(project)) {
      await this.startBrowserExport(project);
      return;
    }

    try {
      this.currentJob = await api.startExport({
        project,
        format: project.export.format,
        crf: project.export.crf,
        preset: project.export.preset,
      });
      this.pollJob();
    } catch (error) {
      this.exportFailed((error as Error).message);
    }
  }

  /** Export sans moteur : rendu + encodage WebCodecs dans l'onglet courant. */
  private async startBrowserExport(project: Project): Promise<void> {
    if (typeof VideoEncoder === 'undefined') {
      // Dans l'application, conseiller « utilisez Chrome » n'aurait aucun sens :
      // la vraie solution est d'installer ffmpeg.
      this.exportFailed(
        t(this.inApp ? 'export.encoderUnavailableApp' : 'export.browserUnsupported', {
          format: project.export.format.toUpperCase(),
        }),
      );
      return;
    }
    this.browserExport = new AbortController();
    els.exportStage.textContent = t(this.inApp ? 'export.browserStartApp' : 'export.browserStart');
    const started = performance.now();
    try {
      const result = await exportInBrowser({
        project,
        format: project.export.format,
        width: project.width,
        height: project.height,
        fps: fpsValue(project.fps),
        quality: els.exportQuality.value as 'high' | 'medium' | 'fast',
        signal: this.browserExport.signal,
        onProgress: (stage, percent) => {
          els.exportProgressFill.style.width = `${clamp(percent, 0, 100)}%`;
          els.exportPercent.textContent = `${Math.round(percent)} %`;
          const label = t(`stage.${stage}`);
          els.exportStage.textContent = label === `stage.${stage}` ? stage : label;
        },
      });
      this.showBrowserResult(result, (performance.now() - started) / 1000);
    } catch (error) {
      // Une annulation demandée par l'utilisateur n'est pas un échec.
      if (this.browserExport?.signal.aborted) {
        els.exportProgress.hidden = true;
        // Le texte de l'échec précédent ne doit pas rester dans le DOM : masqué
        // il est invisible, mais il ressurgirait au prochain affichage.
        els.exportError.textContent = '';
        els.exportError.hidden = true;
        els.exportStage.textContent = t('stage.cancelled');
        els.startExportBtn.disabled = this.encoderBlocked;
        els.cancelExportBtn.hidden = true;
        this.setStatus(t('stage.cancelled'));
        return;
      }
      this.exportFailed((error as Error).message);
    } finally {
      this.browserExport = null;
    }
  }

  private showBrowserResult(result: BrowserExportResult, seconds: number): void {
    els.startExportBtn.disabled = this.encoderBlocked;
    els.cancelExportBtn.hidden = true;
    els.exportProgress.hidden = true;
    const url = URL.createObjectURL(result.blob);
    const size = t('export.size', { n: (result.size_bytes / 1024 / 1024).toFixed(2) });
    const audioOnly = result.format === 'mp3';
    const videoCodec = result.format === 'mp4' ? 'H.264' : 'VP9';
    const audioCodec = result.format === 'mp4' ? 'AAC' : 'Opus';
    const codecs = `${videoCodec} + ${result.has_audio ? audioCodec : t('export.noAudio')}`;
    const details = audioOnly
      ? t('export.detailsAudio', { size, time: formatTimecode(result.duration_us) })
      : t('export.detailsVideo', {
          size,
          frames: result.frames,
          seconds: seconds.toFixed(1),
          codecs,
          width: result.width,
          height: result.height,
        });
    const name = `${sanitizeFileName(this.project.name)}.${result.format}`;
    const warning = result.audio_skipped > 0
      ? `<div class="export-warn">${escapeHtml(
          t('export.audioSkipped', { n: result.audio_skipped }),
        )}</div>`
      : '';
    els.exportResult.innerHTML = `
      <strong>${escapeHtml(t('export.done'))}</strong> — ${result.format.toUpperCase()}<br />
      ${details}
      <a href="${url}" download="${escapeHtml(name)}">${escapeHtml(t('export.download'))}</a>
      ${warning}
    `;
    els.exportResult.hidden = false;
    this.setStatus(t('status.exportDone', { size }));
    this.toast(t('toast.exportDone'), 'ok');
    if (result.audio_skipped > 0) {
      this.toast(t('export.audioSkipped', { n: result.audio_skipped }), 'error');
    }
  }

  private pollJob(): void {
    window.clearInterval(this.exportTimer);
    const jobId = this.currentJob;
    if (!jobId) return;
    this.exportTimer = window.setInterval(async () => {
      try {
        const job = await api.jobStatus(jobId);
        els.exportProgressFill.style.width = `${clamp(job.progress, 0, 100)}%`;
        els.exportPercent.textContent = `${Math.round(job.progress)} %`;
        els.exportStage.textContent = t(`stage.${job.stage}`) === `stage.${job.stage}`
          ? job.message || job.stage
          : t(`stage.${job.stage}`);
        if (job.status === 'done' && job.output) {
          window.clearInterval(this.exportTimer);
          els.startExportBtn.disabled = false;
          els.cancelExportBtn.hidden = true;
          els.exportProgress.hidden = true;
          const output = job.output;
          const size = t('export.size', { n: (output.size_bytes / 1024 / 1024).toFixed(2) });
          const isAudio = output.format === 'mp3';
          const details = isAudio
            ? t('export.detailsAudio', { size, time: formatTimecode(output.duration_us) })
            : t('export.detailsVideo', {
                size,
                frames: output.frames,
                seconds: (output.elapsed_ms / 1000).toFixed(1),
                codecs: output.video_codec
                  ? `${output.video_codec} + ${output.audio_codec || t('export.noAudio')}`
                  : '',
                width: output.width,
                height: output.height,
              });
          els.exportResult.innerHTML = `
            <strong>${escapeHtml(t('export.done'))}</strong> — ${output.format.toUpperCase()}<br />
            ${details}
            <a href="${api.jobFileUrl(jobId)}" download>${escapeHtml(t('export.download'))}</a>
          `;
          els.exportResult.hidden = false;
          this.setStatus(t('status.exportDone', { size }));
          this.toast(t('toast.exportDone'), 'ok');
        } else if (job.status === 'error' || job.status === 'cancelled') {
          window.clearInterval(this.exportTimer);
          this.exportFailed(job.error || job.message);
        }
      } catch (error) {
        window.clearInterval(this.exportTimer);
        this.exportFailed((error as Error).message);
      }
    }, 500);
  }

  private exportFailed(message: string): void {
    els.exportProgress.hidden = true;
    els.exportError.textContent = `${t('export.failed')}\n${message}`;
    els.exportError.hidden = false;
    els.startExportBtn.disabled = this.encoderBlocked;
    els.cancelExportBtn.hidden = true;
    this.setStatus(t('status.exportFailed'));
    this.toast(t('toast.exportFailed'), 'error');
  }

  private async cancelExport(): Promise<void> {
    if (this.mode === 'local') {
      this.browserExport?.abort();
      els.exportStage.textContent = t('export.canceling');
      return;
    }
    if (!this.currentJob) return;
    try {
      await api.cancelJob(this.currentJob);
      els.exportStage.textContent = t('export.canceling');
    } catch (error) {
      this.toast(t('export.cancelFailed', { error: (error as Error).message }), 'error');
    }
  }
}

// ── Éléments ───────────────────────────────────────────────────────────

const els = {
  shell: must<HTMLElement>('app-shell'),
  workspace: must<HTMLElement>('workspace'),
  projectName: must<HTMLInputElement>('projectName'),
  docMeta: must<HTMLElement>('docMeta'),
  engineBadge: must<HTMLElement>('engineBadge'),
  engineLabel: must<HTMLElement>('engineLabel'),
  btnNew: must<HTMLButtonElement>('btn-new'),
  btnOpen: must<HTMLButtonElement>('btn-open'),
  btnSave: must<HTMLButtonElement>('btn-save'),
  btnUndo: must<HTMLButtonElement>('btn-undo'),
  btnRedo: must<HTMLButtonElement>('btn-redo'),
  btnImportSide: must<HTMLButtonElement>('btn-import-side'),
  btnHelp: must<HTMLButtonElement>('btn-help'),
  btnToggleLeft: must<HTMLButtonElement>('btn-toggle-left'),
  btnToggleRight: must<HTMLButtonElement>('btn-toggle-right'),
  btnExport: must<HTMLButtonElement>('btn-export'),
  btnPreferences: must<HTMLButtonElement>('btn-preferences'),
  emptyState: must<HTMLElement>('emptyState'),
  canvasStack: must<HTMLElement>('canvasStack'),
  preview: must<HTMLCanvasElement>('preview'),
  viewport: must<HTMLElement>('viewport'),
  dropZone: must<HTMLElement>('dropZone'),
  dropOverlay: must<HTMLElement>('dropOverlay'),
  mediaList: must<HTMLElement>('mediaList'),
  fileInput: must<HTMLInputElement>('fileInput'),
  projectInput: must<HTMLInputElement>('projectInput'),
  btnPlay: must<HTMLButtonElement>('btn-play'),
  btnStart: must<HTMLButtonElement>('btn-start'),
  btnEnd: must<HTMLButtonElement>('btn-end'),
  timeLabel: must<HTMLElement>('timeLabel'),
  durationLabel: must<HTMLElement>('durationLabel'),
  snapToggle: must<HTMLInputElement>('snapToggle'),
  previewZoomIn: must<HTMLButtonElement>('preview-zoom-in'),
  previewZoomOut: must<HTMLButtonElement>('preview-zoom-out'),
  previewZoomValue: must<HTMLButtonElement>('preview-zoom-value'),
  previewFit: must<HTMLButtonElement>('preview-fit'),
  trackHeaders: must<HTMLElement>('trackHeaders'),
  tracks: must<HTMLElement>('tracks'),
  ruler: must<HTMLElement>('ruler'),
  timelineContent: must<HTMLElement>('timelineContent'),
  playhead: must<HTMLElement>('playhead'),
  timelineScroll: must<HTMLElement>('timelineScroll'),
  timelineScrub: must<HTMLElement>('timelineScrub'),
  scrubFill: must<HTMLElement>('scrubFill'),
  scrubKnob: must<HTMLElement>('scrubKnob'),
  timelinePanel: must<HTMLElement>('timelinePanel'),
  timelineResizer: must<HTMLElement>('timelineResizer'),
  btnAddVideo: must<HTMLButtonElement>('btn-add-video'),
  btnAddAudio: must<HTMLButtonElement>('btn-add-audio'),
  btnToolSplit: must<HTMLButtonElement>('btn-tool-split'),
  btnToolDuplicate: must<HTMLButtonElement>('btn-tool-duplicate'),
  btnToolDelete: must<HTMLButtonElement>('btn-tool-delete'),
  btnInsertText: must<HTMLButtonElement>('btn-insert-text'),
  btnInsertRect: must<HTMLButtonElement>('btn-insert-rect'),
  btnInsertEllipse: must<HTMLButtonElement>('btn-insert-ellipse'),
  btnZoomIn: must<HTMLButtonElement>('btn-zoom-in'),
  btnZoomFit: must<HTMLButtonElement>('btn-zoom-fit'),
  btnZoomOut: must<HTMLButtonElement>('btn-zoom-out'),
  btnTimelineFocus: must<HTMLButtonElement>('btn-timeline-focus'),
  toolsScroll: document.querySelector<HTMLElement>('.tools-scroll') as HTMLElement,
  toolsEyebrow: must<HTMLElement>('toolsEyebrow'),
  toolsTitle: must<HTMLElement>('toolsTitle'),
  toolsChip: must<HTMLElement>('toolsChip'),
  panelProps: must<HTMLElement>('panelProps'),
  panelFx: must<HTMLElement>('panelFx'),
  panelTransitions: must<HTMLElement>('panelTransitions'),
  statusMessage: must<HTMLElement>('statusMessage'),
  statusFormat: must<HTMLElement>('statusFormat'),
  statusDuration: must<HTMLElement>('statusDuration'),
  statusClips: must<HTMLElement>('statusClips'),
  statusZoom: must<HTMLElement>('statusZoom'),
  statusAutosave: must<HTMLElement>('statusAutosave'),
  statusAutosaveText: must<HTMLElement>('statusAutosaveText'),
  exportModal: must<HTMLElement>('exportModal'),
  exportFormat: must<HTMLSelectElement>('exportFormat'),
  exportQuality: must<HTMLSelectElement>('exportQuality'),
  exportResolution: must<HTMLSelectElement>('exportResolution'),
  exportFps: must<HTMLSelectElement>('exportFps'),
  exportSummary: must<HTMLElement>('exportSummary'),
  exportProgress: must<HTMLElement>('exportProgress'),
  exportProgressFill: must<HTMLElement>('exportProgressFill'),
  exportStage: must<HTMLElement>('exportStage'),
  exportPercent: must<HTMLElement>('exportPercent'),
  exportResult: must<HTMLElement>('exportResult'),
  exportError: must<HTMLElement>('exportError'),
  exportEncoderNotice: must<HTMLElement>('exportEncoderNotice'),
  startExportBtn: must<HTMLButtonElement>('startExportBtn'),
  cancelExportBtn: must<HTMLButtonElement>('cancelExportBtn'),
  helpModal: must<HTMLElement>('helpModal'),
  shortcutGrid: must<HTMLElement>('shortcutGrid'),
  prefsModal: must<HTMLElement>('prefsModal'),
  prefsFormat: must<HTMLSelectElement>('prefsFormat'),
  prefsShortcuts: must<HTMLButtonElement>('prefs-shortcuts'),
  prefsEngine: must<HTMLElement>('prefsEngine'),
  prefsVersion: must<HTMLElement>('prefsVersion'),
  toastHost: must<HTMLElement>('toastHost'),
};

// ── Utilitaires ────────────────────────────────────────────────────────

/**
 * Accès au stockage local, tolérant. `localStorage` lève une exception quand le
 * navigateur le bloque (mode privé, politique d'entreprise, iframe isolée) :
 * dans ce cas le studio doit continuer à fonctionner, simplement sans reprise
 * de session.
 */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // quota dépassé ou stockage indisponible : la session reste en mémoire
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // rien à faire
    }
  },
};

function loadProject(): Project {
  try {
    if (new URLSearchParams(location.search).get('reset') === '1') {
      store.remove(STORAGE_PROJECT);
      store.remove(STORAGE_TIME);
      return createProject();
    }
    const text = store.get(STORAGE_PROJECT);
    if (text) return normalizeProject(JSON.parse(text));
  } catch {
    // projet local illisible : on repart d'un projet vide
  }
  return createProject();
}

function hasStoredProject(): boolean {
  return Boolean(store.get(STORAGE_PROJECT));
}

function loadPrefs(): Prefs {
  const fallback: Prefs = {
    theme: 'dark',
    lang: readStoredLang(),
    snap: true,
    format: 'mp4',
    leftPanel: true,
    rightPanel: true,
    timelineHeight: 306,
    timelineCollapsed: false,
  };
  try {
    const raw = store.get(STORAGE_PREFS);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      lang: readStoredLang(),
      snap: parsed.snap !== false,
      format: (['mp4', 'webm', 'mp3'] as ExportFormat[]).includes(parsed.format as ExportFormat)
        ? (parsed.format as ExportFormat)
        : 'mp4',
      leftPanel: parsed.leftPanel !== false,
      rightPanel: parsed.rightPanel !== false,
      timelineHeight: Number(parsed.timelineHeight) || 306,
      timelineCollapsed: parsed.timelineCollapsed === true,
    };
  } catch {
    return fallback;
  }
}

function roundFps(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Facteur d'affichage d'une propriété animable (les % sont plus lisibles). */
function keyframeScale(prop: KeyframeProp): {
  factor: number;
  suffix: string;
  min: number;
  max: number;
  step: number;
} {
  switch (prop) {
    case 'opacity':
      return { factor: 100, suffix: '%', min: 0, max: 100, step: 1 };
    case 'volume':
      return { factor: 100, suffix: '%', min: 0, max: 200, step: 1 };
    case 'scale':
      return { factor: 100, suffix: '%', min: 5, max: 400, step: 1 };
    case 'rotation':
      return { factor: 1, suffix: '°', min: -360, max: 360, step: 1 };
    default:
      return { factor: 100, suffix: '%', min: -50, max: 150, step: 1 };
  }
}

function fieldText(label: string, property: string, value: string): string {
  return `<div class="field"><span>${label}</span><input type="text" data-prop="${property}" value="${escapeHtml(
    value,
  )}" /></div>`;
}

function fieldNumber(label: string, property: string, value: number, step: number): string {
  return `<div class="field"><span>${label}</span><input type="number" min="0" step="${step}" data-prop="${property}" value="${value.toFixed(
    2,
  )}" /></div>`;
}

function fieldRange(
  label: string,
  property: string,
  value: number,
  min: number,
  max: number,
  step: number,
  suffix: string,
): string {
  return `<div class="field"><span>${label}</span><div class="field-row"><input type="range" min="${min}" max="${max}" step="${step}" data-prop="${property}" value="${Math.round(
    value,
  )}" /><span class="range-value">${Math.round(value)}${suffix}</span></div></div>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toHex(color: string): string {
  const value = String(color).trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7);
  if (/^0x[0-9a-f]{6}$/i.test(value)) return `#${value.slice(2)}`;
  return '#ffffff';
}

function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'project'
  );
}

export function boot(): void {
  // Filet de sécurité : même si l'initialisation échoue, l'écran d'accueil ne
  // doit jamais rester devant le studio.
  const splash = document.getElementById('splash');
  const clearSplash = () => {
    if (!splash) return;
    splash.classList.add('is-done');
    window.setTimeout(() => splash.remove(), 480);
  };
  window.setTimeout(() => splash?.remove(), 4000);

  const editor = new Editor();
  (window as unknown as { ctf?: Editor }).ctf = editor;
  editor.init().catch((error: unknown) => {
    console.error(error);
    clearSplash();
  });
}
