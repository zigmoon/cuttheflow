/**
 * CTF FRAME SOURCE — extraction d'images frame-exacte pour les moteurs d'export offline
 * =====================================================================================
 *
 * POURQUOI CE MODULE EXISTE — MESURÉ dans Chrome 153 (banc `_bench/`, 2026-09-16)
 * -------------------------------------------------------------------------------
 * L'ancienne stratégie (« laisser la vidéo jouer et dessiner ce qui est là »,
 * avec une tolérance de dérive allant jusqu'à 2 s) produisait une DÉRIVE ÉNORME
 * entre l'image et la timeline :
 *
 *   coût de rendu réaliste (40 ms/frame, 1080p) :
 *       erreur MOYENNE 878 ms · erreur MAX 2080 ms   ← c'était LE décalage son/image
 *   coût de rendu nul :
 *       erreur moyenne 23 ms · max 66 ms (déjà visible)
 *
 *   Cause : la vidéo joue en TEMPS RÉEL (1×) alors que la boucle d'export tourne
 *   forcément plus lentement. Le décodeur prend de l'avance, et comme le code ne
 *   sait pas « attendre », il dessine la frame disponible — donc une image située
 *   jusqu'à 2 s dans le futur par rapport à la timeline. L'audio, lui, est exact :
 *   d'où le décalage entendu, ET les saccades (le contenu saute puis revient).
 *
 * STRATÉGIE RETENUE ICI — seek + attente de `seeked` : EXACTE et AUSSI RAPIDE
 * --------------------------------------------------------------------------
 *   1080p : 33,9 ms/frame en médiane (P90 50 ms) · erreur médiane 0 ms,
 *           erreur max 33 ms = UNE seule frame.
 *   720p  : 19,2 ms/frame en médiane, mêmes erreurs.
 *   `video.currentTime` est posé sur la valeur exacte et Chrome présente la frame
 *   correspondante (vérifié : `currentTime` après seek = 2.9667 = 89/30 pile).
 *
 *   Autrement dit : être exact NE COÛTE RIEN. L'ancienne stratégie dérivait ET
 *   n'était pas plus rapide.
 *
 * ⚠️ PIÈGES VÉRIFIÉS — ne pas réintroduire
 * --------------------------------------------------------------------------
 *  1. `requestVideoFrameCallback` ne se déclenche QUE lorsqu'une NOUVELLE frame
 *     est présentée : il doit être enregistré AVANT de déplacer la tête de
 *     lecture. L'enregistrer après un seek (ce que faisait l'ancienne branche
 *     « attente bornée ») ne rappelle JAMAIS → le code sortait par le délai et
 *     dessinait la frame déjà affichée.
 *  2. Une vidéo EN PAUSE ne fait pas avancer `currentTime` : le seul moyen de
 *     livrer une frame précise est de seek-er. On garde donc tous les éléments
 *     en pause pendant l'export (et c'est aussi bien plus léger).
 *  3. `video.currentTime` ne mesure PAS la progression d'un export : c'est la
 *     position du décodeur, pas l'horloge de la timeline.
 */

(function () {
    'use strict';

    const SEEK_TIMEOUT_MS = 4000;      // seek courant
    const FIRST_SEEK_TIMEOUT_MS = 20000; // 1er seek à froid (ouverture du fichier, 4K)
    const MIN_SRC_FRAME = 1 / 120;     // borne basse de l'estimation de durée de frame source
    const MAX_SRC_FRAME = 1 / 12;      // borne haute
    /**
     * 🎯 ON VISE LE **MILIEU** DE LA FRAME SOURCE, PAS SON DÉBUT.
     *
     * Mesuré (Chrome 153, bench `_bench/bench.html`, test `sequence`) : demander
     * exactement `k/fps` — c'est-à-dire une frontière de frame — fait tomber le seek
     * sur la MAUVAISE image une fois sur trois. Relevé sur 60 seeks consécutifs sur un
     * fichier 1080p30 : les images présentées étaient 0, 1, **1**, 3, 4, **4**, 6, 7…
     * soit `deltasHistogram = {0: 20, 1: 20, 2: 19}` (= 20 images DUPLIQUÉES et 19
     * SAUTÉES) et une erreur de −33,3 ms sur 20 des 60 images. À l'image : la cadence
     * sort à 20 fps au lieu de 30 — c'est EXACTEMENT le « vidéos sacadées » signalé.
     *
     * En demandant `t + demi-frame` (on se place au milieu de l'intervalle d'affichage
     * de la frame voulue), l'ambiguïté d'arrondi disparaît : relevé identique → 
     * `deltasHistogram = {1: 59}` et `errorHistMs = {0: 60}`, c'est-à-dire **aucune
     * duplication, aucun saut, aucune erreur**.
     *
     * Le décalage est borné par une demi-frame de SORTIE pour ne jamais sauter dans la
     * frame suivante quand la source est plus rapide que la sortie (60 fps → 30 fps).
     */
    const midFrameOffset = (srcFrameDur, outFps) => Math.min(srcFrameDur, 1 / outFps) * 0.5;

    class FrameSource {
        /**
         * @param {HTMLVideoElement} video  élément DÉDIÉ à cette source (jamais partagé)
         * @param {number} fps              images/seconde de SORTIE
         */
        constructor(video, fps) {
            this.video = video;
            this.outFps = Number(fps) || 30;
            // Durée d'une frame SOURCE, estimée à partir des écarts réellement observés
            // entre deux images présentées. On prend le **10ᵉ centile** des derniers
            // écarts : robuste (un écart aberrant de changement de clip ne fausse pas
            // l'estimation) tout en restant juste à 60 fps comme à 24 fps.
            // ⚠️ PIÈGE DÉJÀ RENCONTRÉ : un `Math.min()` partant d'une valeur initiale
            // trop petite (1/60) plafonne l'estimation et ne peut JAMAIS augmenter —
            // toute la détection de cadence donnait alors des chiffres absurdes
            // (58 duplications + 121 sauts sur 180 frames, ce qui est impossible).
            this._srcDeltas = [];
            this._srcFrameDur = 1 / 30;   // valeur de départ prudente ; corrigée en ~5 frames
            this._lastMediaTime = null;
            this._lastRequested = null;
            this._primed = false;
            // Statistiques d'extraction : servent à PROUVER la qualité de l'export
            // (0 image reconduite + erreur d'image nulle = sortie exactement conforme
            //  à la timeline). Journalisées en fin d'export.
            this.stats = { seeks: 0, reuses: 0, failures: 0, lateFrames: 0, timeouts: 0, errSum: 0, errMax: 0, samples: 0, duplicates: 0, skips: 0 };
        }

        /** L'élément affiche-t-il une image exploitable ? */
        get ready() {
            const v = this.video;
            return !!v && v.readyState >= 2 && v.videoWidth > 0;
        }

        /** Arrête la lecture : un élément qui joue échappe au contrôle de l'export. */
        pause() {
            const v = this.video;
            if (v && !v.paused) { try { v.pause(); } catch (_) {} }
            if (v) {
                // Un playbackRate exotique ferait varier la correspondance temps↔image.
                if (v.playbackRate !== 1) { try { v.playbackRate = 1; } catch (_) {} }
                if (v.defaultPlaybackRate !== 1) { try { v.defaultPlaybackRate = 1; } catch (_) {} }
            }
        }

        /**
         * Amène (une fois) l'élément sur `sourceTime` sans limite de temps serrée :
         * c'est le seek « à froid » qui ouvre le fichier et remplit le décodeur.
         * @returns {Promise<boolean>}
         */
        async prime(sourceTime) {
            this.pause();
            const ok = await this._seek(sourceTime || 0, FIRST_SEEK_TIMEOUT_MS);
            this._primed = ok;
            return ok;
        }

        /**
         * Livre la frame correspondant à `sourceTime`.
         * L'élément est laissé EN PAUSE sur cette frame : `drawImage(video)` dessine
         * donc exactement l'image demandée.
         *
         * @param {number} sourceTime  temps dans le média source (secondes)
         * @returns {Promise<boolean>} true si l'image affichée correspond bien à `sourceTime`
         *                             (à une frame source près). false => ne rien dessiner
         *                             et conserver la frame précédente.
         */
        async frameAt(sourceTime) {
            const v = this.video;
            if (!v) { this.stats.failures++; return false; }

            // On borne systématiquement à la durée réelle du média : demander au-delà
            // fait échouer le seek et laisse l'élément sur la DERNIÈRE image (donc une
            // image figée au lieu d'une erreur franche).
            const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
            const maxT = dur ? Math.max(0, dur - 1e-3) : sourceTime;
            const t = Math.max(0, Math.min(sourceTime, maxT));

            // ── 1. RÉUTILISATION : la frame affichée est déjà la bonne ────────────
            // (source moins rapide que la sortie, ou même position redemandée)
            if (this._lastMediaTime !== null && !v.seeking && this.ready) {
                const delta = t - this._lastMediaTime;
                if (delta >= -1e-4 && delta < this._srcFrameDur * 0.95) {
                    this.stats.reuses++;
                    return true;
                }
                // On est très légèrement en retard sur la frame affichée : reculer
                // coûterait un seek complet pour moins d'une frame d'écart.
                if (delta < 0 && -delta <= this._srcFrameDur * 0.5) {
                    this.stats.reuses++;
                    return true;
                }
            }

            this.pause();
            if (v.seeking) await this._waitSeeked(SEEK_TIMEOUT_MS);

            // 🎯 Viser le milieu de l'intervalle d'affichage de la frame voulue (voir
            //    `midFrameOffset` : viser son début fait rater une image sur trois).
            const off = midFrameOffset(this._srcFrameDur, this.outFps);
            const target = Math.min(dur ? Math.max(0, dur - 1e-3) : t + off, t + off);
            const ok = await this._seek(target, this._primed ? SEEK_TIMEOUT_MS : FIRST_SEEK_TIMEOUT_MS, t);
            this._primed = ok;
            if (!ok) { this.stats.failures++; return false; }
            return true;
        }

        /**
         * Seek exact vers `target`, en attente de l'événement `seeked`.
         * `logicalT` est l'instant RÉELLEMENT voulu sur la timeline source : c'est lui
         * qui sert aux statistiques (le `target` peut être décalé d'une demi-frame pour
         * viser le milieu de l'image — voir `midFrameOffset`).
         * rVFC, quand il est disponible, sert à connaître le `mediaTime` réellement
         * présenté (validation + apprentissage de la durée de frame source) ; il est
         * enregistré AVANT le déplacement de la tête de lecture.
         * @private
         */
        async _seek(target, timeoutMs, logicalT) {
            const v = this.video;
            if (!v) return false;
            const t = (logicalT === undefined || logicalT === null) ? target : logicalT;

            const prevMediaTime = this._lastMediaTime;
            const requestedPrev = this._lastRequested;
            const metaPromise = this._nextFrameMetadata(600);
            let seekOk = false;
            try {
                v.currentTime = target;
            } catch (_) {
                return false;
            }
            seekOk = await this._waitSeeked(timeoutMs);
            const meta = await metaPromise;

            if (!seekOk && v.readyState < 2) return false;
            if (v.videoWidth === 0) return false;

            this.stats.seeks++;

            // Position réellement affichée : c'est `currentTime` (Chrome le cale
            // exactement sur la frame présentée — vérifié au banc).
            const shown = Math.max(0, v.currentTime);
            const presented = meta && Number.isFinite(meta.mediaTime) ? meta.mediaTime : shown;
            this._lastMediaTime = presented;

            // Apprentissage de la durée d'une frame SOURCE à partir des écarts
            // réellement observés entre deux frames distinctes.
            if (prevMediaTime !== null) {
                const d = presented - prevMediaTime;
                if (d > 1e-5 && d < MAX_SRC_FRAME) {
                    this._srcDeltas.push(d);
                    if (this._srcDeltas.length > 60) this._srcDeltas.shift();
                    if (this._srcDeltas.length >= 5) {
                        const sorted = [...this._srcDeltas].sort((x, y) => x - y);
                        const p10 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.1))];
                        this._srcFrameDur = Math.max(MIN_SRC_FRAME, Math.min(MAX_SRC_FRAME, p10));
                    }
                }
            }

            // ── CADENCE : détection des images DUPLIQUÉES et SAUTÉES ──────────
            // C'est la seule mesure qui dise vraiment si le contenu avance au bon
            // rythme : un simple comptage de frames ne voit ni une image répétée ni
            // une image sautée. On compare l'avance réelle du contenu (`presented`)
            // à l'avance demandée (`t`) en nombre de frames source.
            if (prevMediaTime !== null && requestedPrev !== null) {
                const srcAdvance = (presented - prevMediaTime) / this._srcFrameDur;
                const askedAdvance = (t - requestedPrev) / this._srcFrameDur;
                if (askedAdvance > 0.5) {
                    if (srcAdvance < 0.5) this.stats.duplicates++;      // même image redessinée
                    else if (srcAdvance > 1.5) this.stats.skips++;      // image(s) passée(s)
                }
            }
            this._lastRequested = t;

            // Écart à l'instant voulu : après le correctif « milieu de frame » il doit
            // être nul ; une valeur d'une frame (33 ms) signalerait une régression.
            const err = presented - t;
            this.stats.errSum += Math.abs(err);
            this.stats.errMax = Math.max(this.stats.errMax, Math.abs(err));
            this.stats.samples++;
            if (err > this._srcFrameDur * 0.5 + 0.002) this.stats.lateFrames++;

            return true;
        }

        /** @private — média temps de la prochaine frame PRÉSENTÉE (null si indisponible) */
        _nextFrameMetadata(timeoutMs) {
            const v = this.video;
            if (!v || typeof v.requestVideoFrameCallback !== 'function') return Promise.resolve(null);
            return new Promise((resolve) => {
                let done = false;
                const finish = (m) => { if (done) return; done = true; clearTimeout(timer); resolve(m); };
                const timer = setTimeout(() => finish(null), timeoutMs);
                v.requestVideoFrameCallback((now, meta) => finish(meta));
            });
        }

        /** @private */
        _waitSeeked(timeoutMs) {
            const v = this.video;
            return new Promise((resolve) => {
                if (!v) return resolve(false);
                if (!v.seeking) return resolve(true);
                let done = false;
                const finish = (ok) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    v.removeEventListener('seeked', onSeeked);
                    if (!ok) this.stats.timeouts++;
                    resolve(ok);
                };
                const onSeeked = () => finish(true);
                const timer = setTimeout(() => finish(false), timeoutMs || SEEK_TIMEOUT_MS);
                v.addEventListener('seeked', onSeeked, { once: true });
            });
        }

        /** Libère l'élément (fin d'export). */
        release() {
            const v = this.video;
            if (!v) return;
            try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch (_) {}
            this.video = null;
        }
    }

    /**
     * Crée une FrameSource à partir d'une URL, en attendant que le média soit décodable.
     * @param {string} url
     * @param {number} fps
     * @param {{timeoutMs?:number}} [opts]
     * @returns {Promise<FrameSource>}
     */
    async function createFrameSource(url, fps, opts) {
        opts = opts || {};
        const timeoutMs = opts.timeoutMs || 20000;
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        // ⚠️ Jamais `autoplay` : un élément qui joue échappe au contrôle de l'export.
        video.autoplay = false;
        if (!String(url).startsWith('blob:') && !String(url).startsWith('data:')) video.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Média illisible (délai dépassé) : ' + url)), timeoutMs);
            video.onloadeddata = () => { clearTimeout(timer); resolve(); };
            video.onerror = () => { clearTimeout(timer); reject(new Error('Média illisible : ' + url)); };
            video.load();
        });
        return new FrameSource(video, fps);
    }

    window.CTFFrameSource = FrameSource;
    window.CTFCreateFrameSource = createFrameSource;
})();
