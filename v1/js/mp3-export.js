/**
 * 🎵 EXPORT MP3 — extraction audio seule (moteur offline, déterministe)
 * =====================================================================
 *
 * POURQUOI CE MOTEUR
 * ------------------
 * Les exports vidéo (MP4 / WebM) embarquent l'audio mixé, mais il n'existait
 * aucun moyen de récupérer la BANDE SON SEULE — utile pour un podcast, un
 * envoi à un client, une musique de fond, une voix off…
 *
 * MOTEUR AUDIO UTILISÉ
 * --------------------
 *   • Décodage   : `AudioContext.decodeAudioData` (décodeur natif du navigateur,
 *                  identique à celui des moteurs MP4/WebM → même qualité de départ).
 *   • Mixage     : sommation des pistes avec volume de piste, fondu entrant/sortant
 *                  et bornes temporelles — EXACTEMENT la même interprétation que la
 *                  preview et que les moteurs vidéo.
 *   • Encodage   : **LAME 3.100** (vendor/lamejs.min.js), l'encodeur MP3 de
 *                  référence — le même que celui utilisé par Audacity / ffmpeg
 *                  (`libmp3lame`). Ce n'est PAS un ré-encodage d'AAC ou d'Opus :
 *                  la sortie est un vrai MP3 44,1/48 kHz.
 *
 * Aucune dépendance au temps réel : le résultat est identique sur toutes les
 * machines, seul le temps de calcul change.
 */

async function startMp3Export(app) {
    console.log('%c🎵━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #fa0');
    console.log('%c🎵 EXPORT MP3 (LAME) — audio seul', 'color: #fa0; font-size: 16px; font-weight: bold');
    console.log('%c🎵━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #fa0');

    const updateProgress = (pct) => {
        const fill = document.getElementById('exportProgressFill');
        if (fill) { fill.style.width = pct + '%'; const t = fill.querySelector('.progress-text'); if (t) t.textContent = Math.round(pct) + '%'; }
    };
    const updateStatus = (msg) => {
        const el = document.getElementById('exportStatus');
        if (el) el.textContent = msg;
    };

    app.isExporting = true;
    const progressEl = document.getElementById('exportProgress');
    if (progressEl) progressEl.style.display = 'block';
    const startBtn = document.getElementById('startExportBtn');
    if (startBtn) startBtn.disabled = true;

    try {
        if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
            throw new Error('Encodeur MP3 (lamejs) non chargé — vérifiez vendor/lamejs.min.js.');
        }

        const AUDIO_SAMPLE_RATE = 48000;
        const AUDIO_CHANNELS = 2;
        const MP3_KBPS = 192; // qualité « transparente » pour de la musique / voix

        updateStatus('Analyse de la timeline…');
        updateProgress(4);

        app._invalidateTimelineEndCache();
        const timelineEnd = app.getTimelineEndTime();
        if (!timelineEnd || timelineEnd <= 0) throw new Error('Timeline vide — rien à exporter.');

        // ── Collecte des sources audio (mêmes règles que les moteurs vidéo) ──────
        const audioClips = [];
        const videoClips = [];
        app.tracks.forEach((track) => {
            if (track.muted || track._effectiveMute) return;
            track.clips.forEach((clip) => {
                if (clip.type === 'audio') audioClips.push({ ...clip, trackId: track.id });
                // L'audio d'un clip vidéo fait partie de la bande son, SAUF si la piste
                // est coupée ou si l'audio a été détaché (outil « Separate Audio »).
                if (clip.type === 'video' && !clip.audioMuted && !clip.audioUnlinked) {
                    videoClips.push({ ...clip, trackId: track.id, _isVideoAudio: true });
                }
            });
        });

        const sources = [...audioClips, ...videoClips];
        if (sources.length === 0) {
            throw new Error('Aucune piste audio dans ce montage — l\'export MP3 n\'a rien à encoder.');
        }

        updateStatus('Décodage de l\'audio…');
        updateProgress(10);

        const totalSamples = Math.ceil(timelineEnd * AUDIO_SAMPLE_RATE);
        // Entrelacé L/R : c'est le format attendu par lamejs.
        const mix = new Float32Array(totalSamples * AUDIO_CHANNELS);

        const decodeCtx = app._getDecodeAudioContext();
        if (!decodeCtx) throw new Error('Décodage audio indisponible (AudioContext).');
        // Un AudioContext peut démarrer suspendu : decodeAudioData fonctionne quand
        // même, mais on le réveille pour éviter les blocages sur certains navigateurs.
        if (decodeCtx.state === 'suspended') { try { await decodeCtx.resume(); } catch (_) {} }

        let decoded = 0;
        for (const clip of sources) {
            try {
                let arrayBuf = null;
                if (clip.file && clip.file instanceof Blob) {
                    arrayBuf = await clip.file.arrayBuffer();
                } else if (clip.url) {
                    arrayBuf = await (await fetch(clip.url)).arrayBuffer();
                }
                if (!arrayBuf) continue;

                const audioBuf = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
                if (!audioBuf || !audioBuf.duration) continue;

                const srcSR = audioBuf.sampleRate;
                const srcCh = audioBuf.numberOfChannels;
                const chans = [];
                for (let c = 0; c < srcCh; c++) chans.push(audioBuf.getChannelData(c));

                const track = app.tracks.find(t => t.id === clip.trackId);
                const trackVol = track ? (track.volume !== undefined ? track.volume : 100) / 100 : 1;
                const gain = Math.max(0, trackVol);
                const fi = clip.fadeIn || 0;
                const fo = clip.fadeOut || 0;

                const clipStartSample = Math.round(clip.startTime * AUDIO_SAMPLE_RATE);
                const clipLenSamples = Math.round(clip.duration * AUDIO_SAMPLE_RATE);
                const srcStartSample = (clip.sourceStart || 0) * srcSR;
                const ratio = srcSR / AUDIO_SAMPLE_RATE;

                let wrote = 0;
                for (let s = 0; s < clipLenSamples; s++) {
                    const outIdx = clipStartSample + s;
                    if (outIdx < 0) continue;
                    if (outIdx >= totalSamples) break;

                    // Rééchantillonnage par INTERPOLATION LINÉAIRE (le plus proche
                    // voisin des anciens moteurs créait un souffle audible sur les
                    // sources 44,1 kHz converties en 48 kHz).
                    const srcPos = srcStartSample + s * ratio;
                    const i0 = Math.floor(srcPos);
                    if (i0 < 0 || i0 >= audioBuf.length) continue;
                    const i1 = Math.min(audioBuf.length - 1, i0 + 1);
                    const frac = srcPos - i0;

                    const tSec = s / AUDIO_SAMPLE_RATE;
                    let fadeGain = 1;
                    if (fi > 0 && tSec < fi) fadeGain = Math.min(fadeGain, tSec / fi);
                    if (fo > 0 && tSec > clip.duration - fo) fadeGain = Math.min(fadeGain, (clip.duration - tSec) / fo);
                    const g = gain * fadeGain;

                    for (let ch = 0; ch < AUDIO_CHANNELS; ch++) {
                        const src = chans[ch % srcCh];
                        const a = src[i0];
                        const b = src[i1];
                        mix[outIdx * AUDIO_CHANNELS + ch] += (a + (b - a) * frac) * g;
                    }
                    wrote++;
                }
                decoded++;
                console.log(`🔊 ${clip.name} — ${(wrote / AUDIO_SAMPLE_RATE).toFixed(2)}s mixés${clip._isVideoAudio ? ' [audio vidéo]' : ''}`);
            } catch (e) {
                console.warn('⚠️ Audio ignoré (décodage impossible) :', clip.name, e && e.message);
            }
        }

        if (decoded === 0) throw new Error('Aucune source audio n\'a pu être décodée.');

        // ── Normalisation anti-saturation ────────────────────────────────────────
        // On ne monte JAMAIS le son (ça changerait le mixage voulu) : on ne fait que
        // protéger contre l'écrêtage quand plusieurs pistes s'additionnent.
        let peak = 0;
        for (let i = 0; i < mix.length; i++) {
            const a = mix[i] < 0 ? -mix[i] : mix[i];
            if (a > peak) peak = a;
        }
        if (peak > 0.99) {
            const norm = 0.99 / peak;
            for (let i = 0; i < mix.length; i++) mix[i] *= norm;
            console.warn(`⚠️ Mixage écrêté (pic ${(20 * Math.log10(peak)).toFixed(1)} dB) → atténué de ${(20 * Math.log10(norm)).toFixed(1)} dB`);
        }

        // ── Encodage MP3 (LAME) ─────────────────────────────────────────────────
        updateStatus('Encodage MP3 (LAME)…');
        updateProgress(30);

        // ⏱️ Compensation du DÉLAI DE CODAGE MP3.
        // MPEG-1 Layer III introduit un décalage constant : l'encodeur « amorce » avec
        // 576 échantillons et le décodeur en restitue 529 → ~1105 échantillons (23 ms à
        // 48 kHz). Un fichier MP3 SANS en-tête Xing/Info (c'est notre cas : lamejs n'en
        // écrit pas) n'annonce pas ce délai, donc le son sort ~20 ms TROP TARD.
        // Mesuré en comparant les bascules de fréquence du MP4 et du MP3 exportés :
        // MP4 = 2,005 s / 4,005 s / 6,005 s ; MP3 = 2,025 / 4,025 / 6,025 → +20 ms
        // constants. On retire donc ces échantillons du début : le MP3 se recale au
        // millième sur la piste audio du MP4 (et rien d'audible n'est perdu — 23 ms).
        const MP3_ENCODER_DELAY = 1105;
        const headSkip = Math.min(MP3_ENCODER_DELAY, Math.max(0, totalSamples - 1));
        const pcmStart = headSkip;

        const encoder = new lamejs.Mp3Encoder(AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, MP3_KBPS);
        const MP3_BLOCK = 1152; // taille de trame MPEG-1 Layer III
        const chunks = [];

        // lamejs attend des Int16Array entrelacés ou des tableaux par canal.
        const left = new Int16Array(MP3_BLOCK);
        const right = new Int16Array(MP3_BLOCK);

        const toInt16 = (v) => {
            const s = v < -1 ? -1 : (v > 1 ? 1 : v);
            return s < 0 ? s * 0x8000 : s * 0x7FFF;
        };

        let blockCount = 0;
        for (let offset = pcmStart; offset < totalSamples; offset += MP3_BLOCK) {
            const len = Math.min(MP3_BLOCK, totalSamples - offset);
            for (let i = 0; i < len; i++) {
                left[i] = toInt16(mix[(offset + i) * AUDIO_CHANNELS]);
                right[i] = toInt16(mix[(offset + i) * AUDIO_CHANNELS + 1]);
            }
            // La dernière trame est complétée par des zéros (sinon LAME tronque).
            if (len < MP3_BLOCK) { left.fill(0, len); right.fill(0, len); }

            const buf = encoder.encodeBuffer(left, right);
            if (buf && buf.length) chunks.push(new Uint8Array(buf));

            blockCount++;
            if ((blockCount & 0x3F) === 0) {
                updateProgress(30 + 60 * ((offset - pcmStart) / (totalSamples - pcmStart)));
                updateStatus(`Encodage MP3… ${Math.round(100 * (offset - pcmStart) / (totalSamples - pcmStart))} %`);
                // Rend la main : l'encodage MP3 est synchrone et peut durer plusieurs
                // secondes sur un long montage.
                await new Promise(r => setTimeout(r, 0));
            }
        }
        const tail = encoder.flush();
        if (tail && tail.length) chunks.push(new Uint8Array(tail));

        const blob = new Blob(chunks, { type: 'audio/mpeg' });
        if (blob.size < 512) throw new Error(`MP3 vide ou incomplet (${blob.size} octets)`);

        updateProgress(100);
        updateStatus('Export MP3 terminé !');
        console.log(`✅ MP3 encodé : ${chunks.length} trames, ${(blob.size / 1024 / 1024).toFixed(2)} MB, ${MP3_KBPS} kbps ${AUDIO_SAMPLE_RATE} Hz stéréo`);

        // ── Livraison (mêmes conventions que les moteurs vidéo) ──────────────────
        app.exportedVideoBlob = blob;
        app.exportedVideoUrl = URL.createObjectURL(blob);
        app.exportedMimeType = 'audio/mpeg';

        await app.sleep(300);
        app.closeExportModal();
        app.showExportPreview(0, 0, 0, 'mp3', blob.size);
        app.showStatus('✅ MP3 prêt — ' + (blob.size / 1024 / 1024).toFixed(1) + ' MB, ' + MP3_KBPS + ' kbps', 'info', 6000);

    } catch (error) {
        console.error('❌ Export MP3 échoué :', error);
        const errMsg = error ? (error.message || String(error)) : 'Erreur inconnue';
        updateStatus('Échec de l\'export MP3 : ' + errMsg);
        app.showStatus('❌ Export MP3 : ' + errMsg, 'error', 9000);
        throw error;
    } finally {
        app.isExporting = false;
        if (startBtn) startBtn.disabled = false;
    }
}
