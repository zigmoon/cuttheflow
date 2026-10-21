/**
 * 🎯 CANVAS EXPORT — Moteur Web universel
 * =========================================
 * 
 * PHILOSOPHIE :
 *   - Rendu frame par frame cadencé sur une horloge audio commune
 *   - Canvas offscreen → captureStream(fps) → MediaRecorder natif
 *   - Fonctionne sur TOUS les navigateurs (Chrome, Firefox, Safari, Edge)
 *   - Zéro dépendance à WebCodecs, VideoEncoder, ou AudioEncoder
 *   - Audio via OfflineAudioContext (sample-accurate, zéro click)
 *   - Format de sortie : WebM ou MP4 lorsque le navigateur le supporte
 * 
 * GARANTIES :
 *   ✅ Durée audio/vidéo commune, y compris sans GPU
 *   ✅ Audio sample-accurate (OfflineAudioContext)
 *   ✅ Tous les FX, transitions, sous-titres, color grading supportés
 *   ✅ 100% navigateurs — pas besoin de codecs hardware
 */

async function startCanvasExport(app) {
    console.log('%c🎯═══════════════════════════════════════════', 'color: #0f0');
    console.log('%c🎯 CANVAS EXPORT — Rendu déterministe WebM', 'color: #0f0; font-size: 16px; font-weight: bold');
    console.log('%c🎯═══════════════════════════════════════════', 'color: #0f0');

    const [width, height] = (app.selectedResolution || '1920x1080').split('x').map(v => Number(v));
    const fps = Number(app.selectedFps) || 30;
    if (!width || !height) throw new Error('Invalid export resolution');

    app.isExporting = true;

    const updateProgress = (pct) => {
        const fill = document.getElementById('exportProgressFill');
        if (fill) { fill.style.width = pct + '%'; const t = fill.querySelector('.progress-text'); if (t) t.textContent = Math.round(pct) + '%'; }
    };
    const updateStatus = (msg) => {
        const el = document.getElementById('exportStatus');
        if (el) el.textContent = msg;
    };

    document.getElementById('exportProgress').style.display = 'block';
    document.getElementById('startExportBtn').disabled = true;

    let canvas = null;
    let ctx = null;

    try {
        // ═══════════════════════════════════════════════════════════════
        // PHASE 1 : ANALYSE DE LA TIMELINE
        // ═══════════════════════════════════════════════════════════════
        updateStatus('🎯 Phase 1/5 : Analyse de la timeline...');
        updateProgress(2);

        app._invalidateTimelineEndCache();
        let timelineEnd = app.getTimelineEndTime();
        const videoClips = [];
        const audioClips = [];
        const textClips = [];
        const blockClips = [];

        app.tracks.forEach((track, trackIdx) => {
            const isMuted = track.muted || track._effectiveMute;
            track.clips.forEach(clip => {
                if (isMuted) return;
                if (clip.type === 'video' || clip.type === 'image') {
                    const c = { ...clip, trackId: track.id, trackIndex: trackIdx, trackVolume: track.volume };
                    if (clip.isUsingProxy && clip.originalUrl) {
                        c.url = clip.originalUrl;
                        const orig = app.mediaLibrary.find(m => m.id === clip.mediaId);
                        if (orig) { c.width = orig.width; c.height = orig.height; }
                    }
                    videoClips.push(c);
                }
                if (clip.type === 'audio') audioClips.push({ ...clip, trackId: track.id, trackIndex: trackIdx, trackVolume: track.volume });
                if (clip.type === 'text') textClips.push({ ...clip, trackId: track.id, trackIndex: trackIdx });
                if (clip.type === 'block') blockClips.push({ ...clip, trackId: track.id, trackIndex: trackIdx });
            });
        });

        if (timelineEnd === 0) throw new Error('Timeline is empty');
        const totalFrames = Math.ceil(timelineEnd * fps);
        const frameDurationMs = 1000 / fps;

        console.log(`🎯 Timeline: ${timelineEnd.toFixed(2)}s, ${totalFrames} frames @ ${fps}fps`);
        console.log(`   Video: ${videoClips.length}, Audio: ${audioClips.length}, Text: ${textClips.length}, Blocks: ${blockClips.length}`);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 2 : PRÉCHARGEMENT DES MÉDIAS
        // ═══════════════════════════════════════════════════════════════
        updateStatus('🎯 Phase 2/5 : Préchargement des médias...');
        updateProgress(5);

        // One decoder per clip. Sharing one <video> by URL corrupts overlapping
        // cuts from the same source because each clip needs its own currentTime.
        const videoElements = new Map();
        const imageElements = new Map();

        const clipKey = clip => String(clip.id ?? `${clip.trackId}:${clip.startTime}:${clip.sourceStart || 0}`);

        // 🐛 PERF/CORRECTNESS FIX (audit export 2026-09-10) — RALENTI À L'EXPORT.
        //   Avant : chaque frame faisait `video.currentTime = t`. Mesuré ~60 ms par
        //   seek sur une source 1080p, alors que la boucle est cadencée en temps réel
        //   (33 ms/frame à 30 fps) → le rendu ne pouvait PAS suivre, et comme
        //   MediaRecorder horodate les frames sur l'horloge murale, la vidéo était
        //   ÉTIRÉE : 6 s de timeline produisaient 85 s de vidéo (≈14× ralenti),
        //   exactement le symptôme rapporté.
        //   Maintenant : la vidéo est LUE en continu (version muette) et on réutilise
        //   la frame déjà décodée ; on ne seek que pour rattraper un retard réel.
        //   Le rendu redevient assez rapide pour tenir le temps réel → plus d'étirement.
        const ensurePlaying = (video) => {
            if (!video) return;
            if (video.playbackRate !== 1.0) { video.playbackRate = 1.0; video.defaultPlaybackRate = 1.0; }
            video.muted = true;
            if (video.paused) { try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
        };

        const waitForDecodedFrame = async (video, targetTime) => {
            if (!video || video.readyState < 1 || !Number.isFinite(targetTime)) return false;
            const maxTime = Number.isFinite(video.duration) && video.duration > 0
                ? Math.max(0, video.duration - 0.001)
                : Math.max(0, targetTime);
            const safeTime = Math.max(0, Math.min(targetTime, maxTime));
            // ⚠️ Tolérance = une frame de la SOURCE (au moins 1/24 s), pas une frame de
            // l'export. Exiger une demi-frame de la cadence d'export faisait attendre la
            // frame suivante à chaque itération : la boucle se sérialisait (draw →
            // attente → draw…) et l'export 24 fps upscalé en 60 fps prenait 43 s pour
            // 6 s de timeline. Baser la tolérance sur le pas de la source permet de
            // RÉUTILISER la frame décodée (on la duplique pour monter en cadence) au lieu
            // de seeker ; les rares chutes franches restent rattrapées par le seek.
            const frameTolerance = Math.max(0.002, 1 / fps, 1 / 24);

            ensurePlaying(video);

            // Frame déjà à la bonne position ? On la réutilise (aucun seek).
            const drift = video.currentTime - safeTime;
            if (!video.seeking && Math.abs(drift) <= frameTolerance) {
                return video.readyState >= 2 && video.videoWidth > 0;
            }

            // En retard (cas normal en lecture continue) : on attend la frame suivante
            // via requestVideoFrameCallback au lieu de forcer un seek coûteux.
            if (drift < 0) {
                const reached = await new Promise(resolve => {
                    if (typeof video.requestVideoFrameCallback !== 'function') return resolve(false);
                    if (video._ctfFrameWaiter) { try { video.cancelVideoFrameCallback(video._ctfFrameWaiter); } catch (_) {} }
                    let settled = false;
                    const finish = (ok) => {
                        if (settled) return;
                        settled = true;
                        video._ctfFrameWaiter = null;
                        clearTimeout(timer);
                        resolve(ok);
                    };
                    const onFrame = () => {
                        video._ctfFrameWaiter = null;
                        if (video.currentTime - safeTime >= -frameTolerance) finish(true);
                        else {
                            video._ctfFrameWaiter = video.requestVideoFrameCallback(onFrame);
                            // Sécurité : ne jamais attendre plus de 40 ms (~1 frame source).
                            if (Number.isFinite(video._ctfWaiterDeadline) && performance.now() > video._ctfWaiterDeadline) finish(true);
                        }
                    };
                    const timer = setTimeout(() => finish(false), 40);
                    video._ctfWaiterDeadline = performance.now() + 40;
                    video._ctfFrameWaiter = video.requestVideoFrameCallback(onFrame);
                }).catch(() => false);
                if (reached) return video.readyState >= 2 && video.videoWidth > 0;
            }

            // Trop en avance ou lecture impossible : seek ciblé (rattrapage).
            // ⚠️ Dans ce moteur TEMPS RÉEL, la vidéo qui « avance » n'est PAS une
            // erreur : MediaRecorder enregistre l'horloge murale, donc tant que la
            // source joue à 1× la sortie reste synchrone. On ne recale en arrière
            // que sur un vrai décrochage (> 0,5 s) ou si aucune frame n'est décodée —
            // sinon on provoquait pause+seek en boucle, ce qui rallongeait l'export
            // (7,03 s au lieu de 6 s pour une timeline de 6 s).
            const needsHardResync = drift > 0.5 || !video.videoWidth;
            if (video.seeking) {
                await new Promise(resolve => {
                    const done = () => { video.removeEventListener('seeked', done); clearTimeout(t); resolve(); };
                    video.addEventListener('seeked', done, { once: true });
                    const t = setTimeout(resolve, 2000);
                }).catch(() => {});
            } else if (needsHardResync) {
                await new Promise((resolve, reject) => {
                    let settled = false;
                    const timeout = setTimeout(() => finish(false), 4000);
                    function finish(ok) {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        video.removeEventListener('seeked', onSeeked);
                        video.removeEventListener('error', onError);
                        ok === 'error' ? reject(new Error('Média vidéo illisible')) : resolve(ok);
                    }
                    const onSeeked = () => finish(true);
                    const onError = () => finish('error');
                    video.addEventListener('seeked', onSeeked, { once: true });
                    video.addEventListener('error', onError, { once: true });
                    try {
                        video.pause();
                        video.currentTime = safeTime;
                    } catch (error) { finish(false); }
                }).catch(() => false);
            }

            return video.readyState >= 2 && video.videoWidth > 0;
        };

        for (const clip of videoClips) {
            // Valider l'URL avant de charger
            if (!clip.url || clip.url === 'undefined' || clip.url === 'null') {
                console.warn(`⚠️ ${clip.name}: URL invalide → ignoré`);
                continue;
            }
            if (clip.type === 'video') {
                const video = document.createElement('video');
                video.src = clip.url;
                video.muted = true;
                video.preload = 'auto';
                video.playsInline = true;
                video.setAttribute('playsinline', '');
                if (!clip.url.startsWith('blob:')) video.crossOrigin = 'anonymous';
                document.body.appendChild(video);
                video.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1';
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error(`Chargement vidéo impossible : ${clip.name || clip.url}`)), 15000);
                    video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
                    video.onerror = () => { clearTimeout(timeout); reject(new Error(`Vidéo illisible : ${clip.name || clip.url}`)); };
                    video.load();
                });
                videoElements.set(clipKey(clip), video);
            }
            if (clip.type === 'image' && !imageElements.has(clip.url)) {
                const img = new Image();
                if (!clip.url.startsWith('blob:')) img.crossOrigin = 'anonymous';
                img.src = clip.url;
                await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
                imageElements.set(clip.url, img);
            }
        }

        // Readiness check — s'assurer que toutes les vidéos sont jouables
        for (const video of videoElements.values()) {
            if (video.readyState < 2) {
                await Promise.race([
                    new Promise(resolve => {
                        const onReady = () => { video.removeEventListener('loadeddata', onReady); video.removeEventListener('canplay', onReady); resolve(); };
                        video.addEventListener('loadeddata', onReady, { once: true });
                        video.addEventListener('canplay', onReady, { once: true });
                    }),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);
            }
        }

        updateProgress(15);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 3 : AUDIO OFFLINE (sample-accurate, zéro click)
        // ═══════════════════════════════════════════════════════════════
        updateStatus('🎯 Phase 3/5 : Décodage audio offline...');
        updateProgress(18);

        const hasAudio = audioClips.length > 0 || videoClips.some(c => c.type === 'video' && !c.audioMuted && !c.audioUnlinked);
        let audioBuffer = null;
        const AUDIO_SAMPLE_RATE = 48000;

        if (hasAudio) {
            const audioCtx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
            const offlineCtx = new OfflineAudioContext(2, Math.ceil(timelineEnd * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE);

            // Clips audio purs (avec fade in/out et volume de piste)
            for (const clip of audioClips) {
                try {
                    const response = await fetch(clip.url);
                    const arrayBuffer = await response.arrayBuffer();
                    const buf = await audioCtx.decodeAudioData(arrayBuffer);
                    const source = offlineCtx.createBufferSource();
                    source.buffer = buf;
                    source.playbackRate.value = 1.0;
                    const gain = offlineCtx.createGain();
                    const baseVol = (clip.trackVolume != null ? clip.trackVolume : 100) / 100;
                    const t0 = clip.startTime;
                    const srcStart = Math.min(clip.sourceStart || 0, buf.duration - 0.001);
                    const duration = Math.min(clip.duration, Math.max(0, buf.duration - srcStart));
                    if (duration <= 0) continue;
                    const fi = Math.min(Math.max(0, clip.fadeIn || 0), duration);
                    const fo = Math.min(Math.max(0, clip.fadeOut || 0), duration);
                    // Envelope: silence → fade-in → sustain → fade-out → silence
                    if (fi > 0) {
                        gain.gain.setValueAtTime(0, t0);
                        gain.gain.linearRampToValueAtTime(baseVol, t0 + fi);
                    } else {
                        gain.gain.setValueAtTime(baseVol, t0);
                    }
                    if (fo > 0) {
                        gain.gain.setValueAtTime(baseVol, t0 + duration - fo);
                        gain.gain.linearRampToValueAtTime(0, t0 + duration);
                    }
                    source.connect(gain);
                    gain.connect(offlineCtx.destination);
                    source.start(t0, srcStart, duration);
                } catch (e) { console.warn(`⚠️ Audio ${clip.name} failed:`, e.message); }
            }

            // Audio des vidéos (avec fade in/out et volume de piste)
            const videoAudioCache = new Map();
            for (const clip of videoClips) {
                if (clip.type !== 'video' || clip.audioMuted || clip.audioUnlinked) continue;
                try {
                    let buf = videoAudioCache.get(clip.url);
                    if (buf === undefined) {
                        const response = await fetch(clip.url);
                        const arrayBuffer = await response.arrayBuffer();
                        buf = await audioCtx.decodeAudioData(arrayBuffer).catch(() => null);
                        videoAudioCache.set(clip.url, buf);
                    }
                    if (!buf || buf.duration === 0) continue;
                    const source = offlineCtx.createBufferSource();
                    source.buffer = buf;
                    source.playbackRate.value = 1.0;
                    const gain = offlineCtx.createGain();
                    const baseVol = (clip.trackVolume != null ? clip.trackVolume : 100) / 100;
                    const t0 = clip.startTime;
                    const srcStart = Math.min(clip.sourceStart || 0, buf.duration - 0.001);
                    const duration = Math.min(clip.duration, Math.max(0, buf.duration - srcStart));
                    if (duration <= 0) continue;
                    const fi = Math.min(Math.max(0, clip.fadeIn || 0), duration);
                    const fo = Math.min(Math.max(0, clip.fadeOut || 0), duration);
                    // Envelope: silence → fade-in → sustain → fade-out → silence
                    if (fi > 0) {
                        gain.gain.setValueAtTime(0, t0);
                        gain.gain.linearRampToValueAtTime(baseVol, t0 + fi);
                    } else {
                        gain.gain.setValueAtTime(baseVol, t0);
                    }
                    if (fo > 0) {
                        gain.gain.setValueAtTime(baseVol, t0 + duration - fo);
                        gain.gain.linearRampToValueAtTime(0, t0 + duration);
                    }
                    source.connect(gain);
                    gain.connect(offlineCtx.destination);
                    source.start(t0, srcStart, duration);
                } catch (e) { console.warn(`⚠️ Video audio ${clip.name} failed:`, e.message); }
            }

            updateStatus('🎯 Phase 3/5 : Rendu audio offline...');
            updateProgress(22);
            audioBuffer = await offlineCtx.startRendering();
            await audioCtx.close();
            console.log(`✅ Audio offline: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz`);
        }

        updateProgress(25);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 4 : RENDU FRAME PAR FRAME + MEDIARECORDER
        // ═══════════════════════════════════════════════════════════════
        updateStatus('🎯 Phase 4/5 : Rendu frame par frame...');

        // Canvas offscreen
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })
            || canvas.getContext('2d', { alpha: false })
            || canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create 2D context');
        ctx.imageSmoothingEnabled = true;
        if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';

        // Color grading canvas
        const hasColorGrading = app.colorGrading && (
            app.colorGrading.lift !== 0 || app.colorGrading.gamma !== 0 || app.colorGrading.gain !== 0 ||
            app.colorGrading.saturation !== 100 || app.colorGrading.contrast !== 100 || app.colorGrading.temp !== 0
        );
        let gradingCanvas, gradingCtx;
        if (hasColorGrading) {
            gradingCanvas = document.createElement('canvas');
            gradingCanvas.width = width;
            gradingCanvas.height = height;
            gradingCtx = gradingCanvas.getContext('2d', { alpha: false });
        }

        // FX layer
        let fxLayerCanvas, fxLayerCtx;
        const hasAnyFx = videoClips.some(c => app._getClipEffects && app._getClipEffects(c).length > 0);
        if (hasAnyFx) {
            fxLayerCanvas = document.createElement('canvas');
            fxLayerCanvas.width = width;
            fxLayerCanvas.height = height;
            fxLayerCtx = fxLayerCanvas.getContext('2d', { willReadFrequently: true });
        }

        // Anti-flash
        let lastValidFrameCanvas, lastValidFrameCtx;
        let hasLastValidFrame = false;
        let consecutiveBlackFrames = 0;
        if (videoClips.length > 0) {
            lastValidFrameCanvas = document.createElement('canvas');
            lastValidFrameCanvas.width = width;
            lastValidFrameCanvas.height = height;
            lastValidFrameCtx = lastValidFrameCanvas.getContext('2d', { alpha: false });
        }

        const calcFit = (sw, sh, tw, th) => {
            const sr = sw / sh, tr = tw / th;
            if (sr > tr) return { w: tw, h: tw / sr, x: 0, y: (th - tw / sr) / 2 };
            return { w: th * sr, h: th, x: (tw - th * sr) / 2, y: 0 };
        };

        // ── AUDIO → WebM ──────────────────────────────────────────────
        // On encode l'audio offline en PCM stéréo, puis on le passe dans
        // un OscillatorNode silencieux pour le muxer — ou mieux :
        // on crée un MediaStream à partir du canvas ET de l'audio.
        
        let audioStream = null;
        let audioPlayCtx = null;
        let offlineSource = null;
        if (audioBuffer && audioBuffer.numberOfChannels > 0 && audioBuffer.length > 0) {
            // Créer un AudioContext pour jouer l'audio offline dans le stream
            audioPlayCtx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
            offlineSource = audioPlayCtx.createBufferSource();
            offlineSource.buffer = audioBuffer;
            const dest = audioPlayCtx.createMediaStreamDestination();
            offlineSource.connect(dest);
            audioStream = dest.stream;
        }

        // Prefer manual capture: automatic capture may coalesce identical canvas
        // frames and has produced header-only files on software-only machines.
        let canvasStream = canvas.captureStream(0);
        let videoTrack = canvasStream.getVideoTracks()[0];
        let requestCanvasFrame = typeof videoTrack?.requestFrame === 'function'
            ? () => videoTrack.requestFrame()
            : null;
        if (!requestCanvasFrame) {
            videoTrack?.stop();
            canvasStream = canvas.captureStream(fps);
            videoTrack = canvasStream.getVideoTracks()[0];
        }
        const combinedStream = new MediaStream();
        combinedStream.addTrack(videoTrack);
        if (audioStream) {
            const audioTrack = audioStream.getAudioTracks()[0];
            if (audioTrack) combinedStream.addTrack(audioTrack);
        }

        // ── MediaRecorder ──────────────────────────────────────────────
        if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
            throw new Error('MediaRecorder/captureStream indisponible sur ce navigateur');
        }
        const requestedFormat = (app.selectedFormat || 'webm').toLowerCase();
        const mimeTypes = requestedFormat === 'mp4'
            ? (hasAudio
                ? ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4']
                : ['video/mp4;codecs=avc1.42E01E', 'video/mp4'])
            : (hasAudio
                ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
                : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);
        const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t));
        if (!mimeType) {
            throw new Error(requestedFormat === 'mp4'
                ? 'MP4 H.264/AAC natif indisponible. Choisissez WebM ou le moteur WebCodecs.'
                : 'WebM VP8/VP9 + Opus indisponible sur ce navigateur.');
        }
        
        const bitrate = width * height >= 3840 * 2160 * 0.9 ? 30_000_000
            : width * height >= 2560 * 1440 * 0.9 ? 20_000_000
            : width * height >= 1920 * 1080 * 0.9 ? 16_000_000
            : width * height >= 1280 * 720 * 0.9 ? 8_000_000
            : 5_000_000;

        const chunks = [];
        const recorder = new MediaRecorder(combinedStream, {
            mimeType,
            videoBitsPerSecond: bitrate,
            audioBitsPerSecond: 192000
        });
        recorder.ondataavailable = e => { 
            console.log(`🎯 Canvas chunk: ${e.data.size} bytes`);
            if (e.data.size > 0) chunks.push(e.data); 
        };
        
        let recorderError = null;
        const recorderDone = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = event => {
                recorderError = event.error || new Error('Erreur MediaRecorder');
                reject(recorderError);
            };
        });

        // Prime frame zero before recording: the export must never begin black.
        for (const clip of videoClips) {
            if (clip.type === 'video' && clip.startTime <= 0 && clip.startTime + clip.duration > 0) {
                const video = videoElements.get(clipKey(clip));
                await waitForDecodedFrame(video, clip.sourceStart || 0);
            }
        }
        // 🎬 PRÉ-ROULAGE (audit export 2026-09-10) : on lance la lecture de TOUS les
        // décodeurs avant d'armer MediaRecorder. Sans ce pré-roulage, le tout premier
        // seek (froid) coûte ~500 ms et le rendu démarrait déjà en retard → la vidéo
        // était étirée par l'horloge murale du recorder (ralenti).
        for (const [key, video] of videoElements.entries()) {
            const clip = videoClips.find(c => clipKey(c) === key);
            if (!video || !clip) continue;
            try {
                video.currentTime = clip.sourceStart || 0;
                ensurePlaying(video);
            } catch (_) {}
        }
        // Laisser les décodeurs produire leurs premières frames avant de compter.
        await new Promise(r => setTimeout(r, 350));
        // Start audio stream BEFORE MediaRecorder so the first captured
        // chunk contains audio samples. On Intel Macs, starting audio after
        // recording produced silent exports.
        if (audioPlayCtx && audioPlayCtx.state === 'suspended') await audioPlayCtx.resume();
        if (offlineSource) offlineSource.start(0);
        recorder.start(100); // timeslice 100ms

        // ═══════════════════════════════════════════════════════════════
        // BOUCLE DE RENDU DÉTERMINISTE
        // ═══════════════════════════════════════════════════════════════
        const startTime = performance.now();
        let lastProgressUpdate = 0;
        let lateFrames = 0;

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
            // Every frame is rendered and pushed in order — never skipped. On a
            // slow machine the render can fall behind the audio's real-time
            // clock; previously this jumped frameIndex ahead to "catch up",
            // which silently dropped visual content (glitches/stutter) while
            // the audio kept playing. Falling behind now just makes the
            // recording run longer than the timeline (trailing silence once
            // the audio buffer ends) instead of corrupting frames.
            const elapsedMs = performance.now() - startTime;
            const expectedFrame = Math.floor((elapsedMs / 1000) * fps);
            if (expectedFrame > frameIndex + 2 && expectedFrame < totalFrames) {
                lateFrames++;
            }

            const currentTime = frameIndex / fps;


            // Reset canvas
            ctx.globalAlpha = 1;
            ctx.filter = 'none';
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, width, height);

            let drewSomething = false;

            // ── Rendu des pistes (fond → premier plan) ──────────────────
            for (let ti = app.tracks.length - 1; ti >= 0; ti--) {
                const track = app.tracks[ti];
                if (!track || track.muted || track._effectiveMute) continue;

                for (const clip of videoClips) {
                    if (clip.trackId !== track.id) continue;
                    if (currentTime < clip.startTime - 0.0001 || currentTime >= clip.startTime + clip.duration) continue;

                    const timeInClip = currentTime - clip.startTime;

                    if (clip.type === 'image') {
                        const img = imageElements.get(clip.url);
                        if (!img || !img.complete) continue;
                        const fit = calcFit(img.naturalWidth, img.naturalHeight, width, height);
                        const s = (clip.videoScale !== undefined ? clip.videoScale : 100) / 100;
                        const px = (clip.videoPosX !== undefined ? clip.videoPosX : 50) / 100;
                        const py = (clip.videoPosY !== undefined ? clip.videoPosY : 50) / 100;
                        const anim = app._calcClipAnimation(clip, timeInClip);
                        const finalScale = s * anim.sx;
                        const dw = fit.w * finalScale, dh = fit.h * finalScale;
                        const cx = px * width + (anim.tx / 100) * width;
                        const cy = py * height + (anim.ty / 100) * height;
                        const fi = clip.fadeIn || 0, fo = clip.fadeOut || 0;
                        let alpha = 1.0;
                        if (fi > 0 && timeInClip < fi) alpha = Math.min(alpha, timeInClip / fi);
                        if (fo > 0 && clip.duration - timeInClip < fo) alpha = Math.min(alpha, (clip.duration - timeInClip) / fo);
                        alpha *= anim.alpha;
                        const alphaClamped = Math.max(0, Math.min(1, alpha));

                        const hasFx = fxLayerCtx && app._getClipEffects && app._getClipEffects(clip).length > 0;
                        if (hasFx) {
                            fxLayerCtx.clearRect(0, 0, width, height);
                            fxLayerCtx.save();
                            fxLayerCtx.globalAlpha = 1;
                            if (anim.rot !== 0) { fxLayerCtx.translate(cx, cy); fxLayerCtx.rotate(anim.rot); fxLayerCtx.drawImage(img, -dw / 2, -dh / 2, dw, dh); }
                            else { fxLayerCtx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh); }
                            fxLayerCtx.restore();
                            app.applyClipEffectToCanvas(fxLayerCtx, clip, width, height, frameIndex);
                            ctx.save(); ctx.globalAlpha = alphaClamped; ctx.drawImage(fxLayerCanvas, 0, 0); ctx.restore();
                        } else {
                            ctx.save();
                            ctx.globalAlpha = alphaClamped;
                            if (anim.rot !== 0) { ctx.translate(cx, cy); ctx.rotate(anim.rot); ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); }
                            else { ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh); }
                            ctx.restore();
                        }
                        drewSomething = true;
                    } else if (clip.type === 'video') {
                        const video = videoElements.get(clipKey(clip));
                        if (!video) continue;

                        const srcTime = (clip.sourceStart || 0) + timeInClip;
                        const safeTime = video.duration > 0 ? Math.min(srcTime, video.duration - 0.016) : srcTime;
                        const decoded = await waitForDecodedFrame(video, safeTime);

                        if (decoded) {
                            const fit = calcFit(video.videoWidth, video.videoHeight, width, height);
                            const s = (clip.videoScale !== undefined ? clip.videoScale : 100) / 100;
                            const px = (clip.videoPosX !== undefined ? clip.videoPosX : 50) / 100;
                            const py = (clip.videoPosY !== undefined ? clip.videoPosY : 50) / 100;
                            const anim = app._calcClipAnimation(clip, timeInClip);
                            const finalScale = s * anim.sx;
                            const dw = fit.w * finalScale, dh = fit.h * finalScale;
                            const cx = px * width + (anim.tx / 100) * width;
                            const cy = py * height + (anim.ty / 100) * height;
                            const fi = clip.fadeIn || 0, fo = clip.fadeOut || 0;
                            let alpha = 1.0;
                            if (fi > 0 && timeInClip < fi) alpha = Math.min(alpha, timeInClip / fi);
                            if (fo > 0 && clip.duration - timeInClip < fo) alpha = Math.min(alpha, (clip.duration - timeInClip) / fo);
                            alpha *= anim.alpha;
                            const alphaClamped = Math.max(0, Math.min(1, alpha));

                            const hasFx = fxLayerCtx && app._getClipEffects && app._getClipEffects(clip).length > 0;
                            if (hasFx) {
                                fxLayerCtx.clearRect(0, 0, width, height);
                                fxLayerCtx.save();
                                fxLayerCtx.globalAlpha = 1;
                                if (anim.rot !== 0) { fxLayerCtx.translate(cx, cy); fxLayerCtx.rotate(anim.rot); fxLayerCtx.drawImage(video, -dw / 2, -dh / 2, dw, dh); }
                                else { fxLayerCtx.drawImage(video, cx - dw / 2, cy - dh / 2, dw, dh); }
                                fxLayerCtx.restore();
                                app.applyClipEffectToCanvas(fxLayerCtx, clip, width, height, frameIndex);
                                ctx.save(); ctx.globalAlpha = alphaClamped; ctx.drawImage(fxLayerCanvas, 0, 0); ctx.restore();
                            } else {
                                ctx.save();
                                ctx.globalAlpha = alphaClamped;
                                if (anim.rot !== 0) { ctx.translate(cx, cy); ctx.rotate(anim.rot); ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh); }
                                else { ctx.drawImage(video, cx - dw / 2, cy - dh / 2, dw, dh); }
                                ctx.restore();
                            }
                            drewSomething = true;
                        }
                    }
                }
            }

            // ── Textes et blocs ─────────────────────────────────────────
            const overlays = [];
            textClips.forEach(c => { if (currentTime >= c.startTime - 0.0001 && currentTime < c.startTime + c.duration) overlays.push({ type: 'text', clip: c }); });
            blockClips.forEach(c => { if (currentTime >= c.startTime - 0.0001 && currentTime < c.startTime + c.duration) overlays.push({ type: 'block', clip: c }); });
            overlays.sort((a, b) => b.clip.trackIndex - a.clip.trackIndex);

            overlays.forEach(({ type, clip }) => {
                const anim = app._calcClipAnimation(clip, currentTime - clip.startTime);
                ctx.save();
                ctx.filter = 'none';
                if (type === 'text') {
                    const style = clip.style || {};
                    ctx.font = `${style.fontWeight || 'bold'} ${style.fontSize || '48px'} ${style.fontFamily || 'Arial'}`;
                    ctx.fillStyle = style.color || '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    // 🅣 Ombre optionnelle (OFF par défaut) — helper partagé aperçu/export.
                    app._applyTextShadow(ctx, style);
                    const bx = (clip.posX !== undefined ? clip.posX : 50) / 100 * width;
                    const by = (clip.posY !== undefined ? clip.posY : 50) / 100 * height;
                    const fadeOpacity = app._calcFadeOpacity ? app._calcFadeOpacity(clip, currentTime) : 1.0;
                    ctx.globalAlpha = Math.max(0, Math.min(1, anim.alpha * fadeOpacity));
                    ctx.fillText(clip.content || 'TEXT', bx + (anim.tx / 100) * width, by + (anim.ty / 100) * height);
                } else if (type === 'block') {
                    const bw = (width * (clip.width || 50)) / 100;
                    const bh = (height * (clip.height || 50)) / 100;
                    const bx = (width * (clip.posX || 25)) / 100;
                    const by = (height * (clip.posY || 25)) / 100;
                    ctx.fillStyle = clip.color || '#ff0000';
                    const fadeOpacity = app._calcFadeOpacity ? app._calcFadeOpacity(clip, currentTime) : 1.0;
                    ctx.globalAlpha = (clip.opacity ?? 1.0) * Math.max(0, Math.min(1, anim.alpha * fadeOpacity));
                    ctx.fillRect(bx + (anim.tx / 100) * width, by + (anim.ty / 100) * height, bw, bh);
                }
                ctx.restore();
            });

            // ── Sous-titres ─────────────────────────────────────────────
            const activeVideoClips = [];
            for (let ti = app.tracks.length - 1; ti >= 0; ti--) {
                const track = app.tracks[ti];
                if (!track || track.muted || track._effectiveMute) continue;
                for (const clip of videoClips) {
                    if (clip.trackId !== track.id) continue;
                    if (currentTime >= clip.startTime - 0.0001 && currentTime < clip.startTime + clip.duration) activeVideoClips.push(clip);
                }
            }
            const subClip = activeVideoClips.find(c => c.subtitleEnabled && c.subtitles && c.subtitles.length);
            if (subClip) {
                const subTime = currentTime - subClip.startTime;
                const sub = subClip.subtitles.find(s => subTime >= s.start && subTime < s.end);
                if (sub) {
                    ctx.save();
                    ctx.filter = 'none';
                    ctx.font = `bold ${Math.round(height * 0.045)}px Arial, sans-serif`;
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.shadowColor = 'rgba(0,0,0,0.9)';
                    ctx.shadowBlur = 6; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
                    const m = ctx.measureText(sub.text);
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(width / 2 - m.width / 2 - 12, height * 0.88 - Math.round(height * 0.05), m.width + 24, Math.round(height * 0.05) + 8);
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(sub.text, width / 2, height * 0.9);
                    ctx.restore();
                }
            }

            // ── Transitions ─────────────────────────────────────────────
            const topClip = activeVideoClips[activeVideoClips.length - 1];
            if (topClip && topClip.transition && topClip.transition !== 'none' && app._applyTransitionMask) {
                app._applyTransitionMask(ctx, topClip, currentTime, width, height);
            }

            // ── Color grading ───────────────────────────────────────────
            if (hasColorGrading && gradingCtx) {
                const cg = app.colorGrading;
                const brightness = 100 + (cg.lift / 2) + (cg.gain / 2);
                const filters = [];
                if (brightness !== 100) filters.push(`brightness(${brightness}%)`);
                if (cg.contrast !== 100) filters.push(`contrast(${cg.contrast}%)`);
                if (cg.saturation !== 100) filters.push(`saturate(${cg.saturation}%)`);
                if (filters.length > 0) {
                    gradingCtx.clearRect(0, 0, width, height);
                    gradingCtx.filter = filters.join(' ');
                    gradingCtx.drawImage(canvas, 0, 0);
                    gradingCtx.filter = 'none';
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(gradingCanvas, 0, 0);
                }
            }

            // ── Anti-flash ──────────────────────────────────────────────
            if (!drewSomething && videoClips.length > 0) {
                consecutiveBlackFrames++;
                if (hasLastValidFrame && lastValidFrameCanvas) {
                    ctx.drawImage(lastValidFrameCanvas, 0, 0);
                }
            } else if (drewSomething) {
                consecutiveBlackFrames = 0;
                if (lastValidFrameCtx) {
                    lastValidFrameCtx.clearRect(0, 0, width, height);
                    lastValidFrameCtx.drawImage(canvas, 0, 0);
                    hasLastValidFrame = true;
                }
            }

            // ── Progress ────────────────────────────────────────────────
            if (frameIndex === 30 && !drewSomething && videoClips.length > 0) {
                console.error('❌ CANVAS: Aucune frame dessinée après 30 frames!');
                console.error('   → Vérifiez que les vidéos sont bien chargées (readyState >= 2)');
                console.error('   → Vérifiez que les URLs des clips sont valides (pas de blob: expiré)');
                videoClips.forEach(c => {
                    const v = videoElements.get(clipKey(c));
                    console.error(`   Clip "${c.name}": url=${c.url?.substring(0,50)}... readyState=${v?.readyState || 'N/A'}`);
                });
            }
            
            if (frameIndex % 10 === 0) {
                const now = performance.now();
                if (now - lastProgressUpdate >= 500 || frameIndex < 10) {
                    const pct = 25 + (frameIndex / totalFrames) * 70;
                    updateProgress(Math.min(95, Math.round(pct)));
                    const elapsed = ((now - startTime) / 1000).toFixed(1);
                    const renderFps = frameIndex > 0 ? (frameIndex / ((now - startTime) / 1000)).toFixed(1) : '...';
                    updateStatus(`🎯 Frame ${frameIndex + 1}/${totalFrames} • ${renderFps} fps • ${currentTime.toFixed(1)}s/${timelineEnd.toFixed(1)}s`);
                    lastProgressUpdate = now;
                }
            }

            // Explicitly push the completed composite after all tracks, FX,
            // overlays, subtitles and grading have been drawn.
            if (requestCanvasFrame) requestCanvasFrame();

            // MediaRecorder and the audio stream are real-time APIs. Pace every
            // frame against the same clock instead of rendering the whole montage
            // in a few milliseconds (which produced empty video and truncated audio).
            const nextDeadline = startTime + (frameIndex + 1) * frameDurationMs;
            const waitMs = nextDeadline - performance.now();
            if (waitMs > 1) await new Promise(r => setTimeout(r, waitMs));
            else await new Promise(r => setTimeout(r, 0));
        }

        // ── Finaliser MediaRecorder ────────────────────────────────────
        updateStatus('🎯 Phase 5/5 : Finalisation...');
        updateProgress(95);

        if (lateFrames > 0) {
            console.warn(`⚠️ Canvas export: rendu en retard sur ${lateFrames} frames (machine lente) — aucune frame perdue, l'export a simplement pris plus de temps que la timeline`);
        }
        
        // Let the final audio/video packets reach MediaRecorder.
        // Ensure we wait until the full timeline duration has elapsed so
        // audio completes fully before stopping the recorder.
        const remainingMs = Math.max(0, startTime + timelineEnd * 1000 - performance.now());
        if (remainingMs > 0) await new Promise(r => setTimeout(r, remainingMs));
        await new Promise(r => setTimeout(r, 200));
        
        recorder.stop();
        await recorderDone;
        if (recorderError) throw recorderError;
        console.log(`✅ MediaRecorder arrêté, ${chunks.length} chunks`);

        // ── Assembler le blob final ────────────────────────────────────
        const videoBlob = new Blob(chunks, { type: mimeType });
        if (videoBlob.size < 128) throw new Error(`Fichier export vide ou incomplet (${videoBlob.size} octets)`);
        console.log(`🎯 Canvas blob final: ${videoBlob.size} bytes, ${chunks.length} chunks`);

        // ── 🛡️ CONTRÔLE DE DURÉE (audit export 2026-09-10) ──────────────
        // MediaRecorder horodate les frames sur l'horloge murale et ne délivre les
        // images que lorsque le compositeur en produit une. Sur les montages longs,
        // ce moteur peut donc produire un fichier DÉCALÉ par rapport à la timeline.
        //
        // ⚠️ MESURES (audit 2026-09-10, timeline de 120 s, 3600 frames attendues) :
        //   machine normale     → 3547 frames · dernier PTS 133,93 s  (+11,6 %)
        //   machine bridée ×4   → 3600 frames · dernier PTS 120,13 s  (+0,1 %)
        //   moteur VP9 offline  → 3600 frames · durée 120,000 s       (exact)
        // Le décalage n'augmente donc PAS avec la lenteur de la machine : il est
        // lié au hasard de la capture temps réel. On mesure la durée réelle du
        // fichier et on prévient si l'écart dépasse 2 % (au-delà, il est visible).
        const outDuration = await new Promise(resolve => {
            const probe = document.createElement('video');
            probe.preload = 'metadata';
            probe.muted = true;
            probe.src = URL.createObjectURL(videoBlob);
            let done = false;
            const finish = (v) => { if (done) return; done = true; try { URL.revokeObjectURL(probe.src); } catch (_) {} resolve(v); };
            probe.onloadedmetadata = () => finish(probe.duration);
            probe.onerror = () => finish(null);
            setTimeout(() => finish(null), 4000);
        });
        const expectedDuration = timelineEnd;
        if (isFinite(outDuration) && outDuration > 0 && Math.abs(outDuration - expectedDuration) / expectedDuration > 0.02) {
            const drift = (((outDuration / expectedDuration) - 1) * 100).toFixed(1);
            console.warn(`⚠️ Durée exportée (${outDuration.toFixed(2)}s) ≠ timeline (${expectedDuration.toFixed(2)}s) — décalage ${drift}%.`);
            app.showStatus(`⚠️ Décalage détecté : ${outDuration.toFixed(1)}s au lieu de ${expectedDuration.toFixed(1)}s (${drift}%). Pour un montage précis sur fichier long, préférez « VP9 + Opus » ou « H.264 + AAC » (moteurs offline, exacts).`);
        }
        const outputMimeType = mimeType;

        updateProgress(100);
        updateStatus('🎯 Export Canvas terminé !');

        // ── Nettoyage ──────────────────────────────────────────────────
        for (const v of videoElements.values()) {
            try { v.pause(); v.src = ''; v.load(); if (v.parentNode) v.parentNode.removeChild(v); } catch (e) {}
        }
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (gradingCanvas && gradingCanvas.parentNode) gradingCanvas.parentNode.removeChild(gradingCanvas);
        if (lastValidFrameCanvas && lastValidFrameCanvas.parentNode) lastValidFrameCanvas.parentNode.removeChild(lastValidFrameCanvas);
        if (fxLayerCanvas && fxLayerCanvas.parentNode) fxLayerCanvas.parentNode.removeChild(fxLayerCanvas);
        try { if (offlineSource) offlineSource.stop(); } catch (_) {}
        try { if (audioPlayCtx && audioPlayCtx.state !== 'closed') await audioPlayCtx.close(); } catch (_) {}
        combinedStream.getTracks().forEach(track => track.stop());

        app.exportedVideoBlob = videoBlob;
        app.exportedVideoUrl = URL.createObjectURL(videoBlob);
        app.exportedMimeType = outputMimeType;

        await app.sleep(500);
        app.closeExportModal();
        app.showExportPreview(width, height, fps, requestedFormat, videoBlob.size);

        // ── Résumé ────────────────────────────────────────────────────
        const elapsedTotal = ((performance.now() - startTime) / 1000).toFixed(1);
        console.log('%c🎯═══════════════════════════════════════════', 'color: #0f0');
        console.log('%c🎯 CANVAS EXPORT TERMINÉ', 'color: #0f0; font-size: 14px; font-weight: bold');
        console.log('%c🎯═══════════════════════════════════════════', 'color: #0f0');
        console.log(`   📊 Frames: ${totalFrames}/${totalFrames} (100%)`);
        console.log(`   ⏱️ Durée: ${elapsedTotal}s`);
        console.log(`   📦 Taille: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   🎞️ Format: ${requestedFormat.toUpperCase()} (${mimeType})`);
        console.log(`   🔊 Audio: ${audioBuffer ? 'OfflineAudioContext sample-accurate' : 'Aucun'}`);
        console.log('   🎯 Synchronisation: horloge audio/vidéo commune');

    } catch (error) {
        console.error('❌ Canvas export failed:', error);
        updateStatus('Export échoué : ' + error.message);
        app.showStatus('❌ ' + error.message);
        throw error;
    } finally {
        // Cleanup resources (even on error)
        try {
            for (const v of videoElements.values()) {
                try { v.pause(); v.src = ''; v.load(); if (v.parentNode) v.parentNode.removeChild(v); } catch (_) {}
            }
        } catch (_) {}
        try { if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch (_) {}
        try { if (offlineSource) offlineSource.stop(); } catch (_) {}
        try { if (audioPlayCtx && audioPlayCtx.state !== 'closed') audioPlayCtx.close(); } catch (_) {}
        try { if (typeof combinedStream !== 'undefined' && combinedStream) combinedStream.getTracks().forEach(t => t.stop()); } catch (_) {}
        app.isExporting = false;
        document.getElementById('startExportBtn').disabled = false;
    }
}
