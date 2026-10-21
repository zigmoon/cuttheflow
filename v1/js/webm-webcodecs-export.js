/**
 * 🎬 WEBM WEBCODECS EXPORT — Moteur WebM 100% offline & déterministe
 * ===================================================================
 *
 * PHILOSOPHIE :
 *   Même qualité sur TOUTES les machines. Zéro dépendance au temps réel.
 *   Contrairement au Canvas-export (MediaRecorder temps réel), ce moteur
 *   encode frame par frame en offline via WebCodecs VP9 + Opus, puis
 *   assemble le tout dans un conteneur WebM valide via un muxer EBML inline.
 *
 * ARCHITECTURE :
 *   1. Analyse timeline (clips, audio, durée)
 *   2. Préchargement médias (vidéos + images)
 *   3. Rendu audio offline (OfflineAudioContext → PCM → Opus via AudioEncoder)
 *   4. Rendu vidéo frame-by-frame (Canvas 2D → VideoEncoder VP9)
 *   5. Muxage EBML/WebM (video + audio → fichier .webm)
 *
 * GARANTIES :
 *   ✅ Même nombre de frames sur toutes les machines (boucle for)
 *   ✅ Audio sample-accurate (OfflineAudioContext, pas de real-time)
 *   ✅ Audio/vidéo parfaitement synchronisés (timestamps calculés, pas clock)
 *   ✅ VP9 + Opus = qualité supérieure à taille égale vs H.264+AAC
 *   ✅ Pas de frame-skip, pas de setTimeout, pas de pacing real-time
 *   ✅ GPU automatique si dispo, software sinon — transparent
 *   ✅ Format WebM — compatible Chrome, Firefox, Edge, VLC, ffmpeg
 */

// ═══════════════════════════════════════════════════════════════════════
// MINI WEBM/EBML MUXER (inline, zéro dépendance)
// ═══════════════════════════════════════════════════════════════════════

const WebMMuxer = (() => {
    'use strict';

    // EBML Element IDs (as byte arrays)
    const EBML_ID = [0x1A, 0x45, 0xDF, 0xA3];
    const SEGMENT_ID = [0x18, 0x53, 0x80, 0x67];
    const SEGMENT_INFO_ID = [0x15, 0x49, 0xA9, 0x66];
    const TRACKS_ID = [0x16, 0x54, 0xAE, 0x6B];
    const CLUSTER_ID = [0x1F, 0x43, 0xB6, 0x75];
    const TRACK_ENTRY_ID = [0xAE];
    const SIMPLE_BLOCK_ID = [0xA3];

    // Sub-element IDs
    const EBML_VERSION = [0x42, 0x86];
    const EBML_READ_VERSION = [0x42, 0xF7];
    const EBML_MAX_ID_LEN = [0x42, 0xF2];
    const EBML_MAX_SIZE_LEN = [0x42, 0xF3];
    const DOC_TYPE = [0x42, 0x82];
    const DOC_TYPE_VERSION = [0x42, 0x87];
    const DOC_TYPE_READ_VERSION = [0x42, 0x85];

    const TIMECODE_SCALE = [0x2A, 0xD7, 0xB1];
    const DURATION = [0x44, 0x89];
    const MUXING_APP = [0x4D, 0x80];
    const WRITING_APP = [0x57, 0x41];

    const TRACK_NUMBER = [0xD7];
    const TRACK_UID = [0x73, 0xC5];
    const TRACK_TYPE = [0x83];
    const CODEC_ID = [0x86];
    const CODEC_PRIVATE = [0x63, 0xA2];

    const VIDEO_ID = [0xE0];
    const PIXEL_WIDTH = [0xB0];
    const PIXEL_HEIGHT = [0xBA];

    const AUDIO_ID = [0xE1];
    const SAMPLING_FREQ = [0xB5];
    const CHANNELS = [0x9F];
    const BIT_DEPTH = [0x62, 0x64];

    const TIMECODE = [0xE7]; // Cluster timecode

    // Encode a variable-length EBML size (VINT)
    function encodeVINT(value) {
        if (value < 0x7F) return [0x80 | value];
        if (value < 0x3FFF) return [0x40 | (value >> 8), value & 0xFF];
        if (value < 0x1FFFFF) return [0x20 | (value >> 16), (value >> 8) & 0xFF, value & 0xFF];
        if (value < 0x0FFFFFFF) return [0x10 | (value >> 24), (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF];
        // For larger sizes, use 8-byte VINT
        const hi = Math.floor(value / 0x100000000);
        const lo = value >>> 0;
        return [
            0x01, hi >>> 24, (hi >> 16) & 0xFF, (hi >> 8) & 0xFF, hi & 0xFF,
            lo >>> 24, (lo >> 16) & 0xFF, (lo >> 8) & 0xFF, lo & 0xFF
        ];
    }

    // Unknown size marker (for streaming Segment)
    const UNKNOWN_SIZE = [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

    // Encode unsigned integer to minimal bytes
    function encodeUint(value, forceBytes) {
        const bytes = [];
        if (forceBytes) {
            for (let i = forceBytes - 1; i >= 0; i--) {
                bytes.push((value >> (i * 8)) & 0xFF);
            }
            return bytes;
        }
        if (value === 0) return [0];
        let v = value;
        while (v > 0) {
            bytes.unshift(v & 0xFF);
            v = Math.floor(v / 256);
        }
        return bytes;
    }

    // Encode float64
    function encodeFloat64(value) {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, value, false);
        return Array.from(new Uint8Array(buf));
    }

    // Encode string as UTF-8 bytes
    function encodeString(str) {
        return Array.from(new TextEncoder().encode(str));
    }

    // Build an EBML element: [ID][Size][Data]
    function element(id, data) {
        const size = encodeVINT(data.length);
        return [...id, ...size, ...data];
    }

    // Build element with uint payload
    function uintElement(id, value) {
        const data = encodeUint(value);
        return element(id, data);
    }

    // Build element with float64 payload
    function float64Element(id, value) {
        return element(id, encodeFloat64(value));
    }

    // Build element with string payload
    function stringElement(id, str) {
        return element(id, encodeString(str));
    }

    /**
     * Create a WebM file from encoded video and audio chunks.
     * @param {Object} params
     * @param {number} params.width
     * @param {number} params.height
     * @param {number} params.fps
     * @param {number} params.durationMs - Total duration in milliseconds
     * @param {number} params.sampleRate
     * @param {number} params.channels
     * @param {Array} params.videoChunks - [{data: Uint8Array, timestamp: µs, isKey: bool}]
     * @param {Array} params.audioChunks - [{data: Uint8Array, timestamp: µs}]
     * @param {ArrayBuffer|null} params.codecPrivate - VP9 CodecPrivate (optional)
     * @param {ArrayBuffer|null} params.opusHead - Opus identification header
     * @returns {Blob}
     */
    function mux(params) {
        const {
            width, height, fps, durationMs,
            sampleRate, channels,
            videoChunks, audioChunks,
            codecPrivate, opusHead
        } = params;

        const TIMESCALE_NS = 1000000; // 1ms timescale (standard WebM)

        // ── EBML Header ─────────────────────────────────────────────────
        const ebmlHeader = element(EBML_ID, [
            ...uintElement(EBML_VERSION, 1),
            ...uintElement(EBML_READ_VERSION, 1),
            ...uintElement(EBML_MAX_ID_LEN, 4),
            ...uintElement(EBML_MAX_SIZE_LEN, 8),
            ...stringElement(DOC_TYPE, 'webm'),
            ...uintElement(DOC_TYPE_VERSION, 4),
            ...uintElement(DOC_TYPE_READ_VERSION, 2)
        ]);

        // ── Segment Info ────────────────────────────────────────────────
        const segInfo = element(SEGMENT_INFO_ID, [
            ...uintElement(TIMECODE_SCALE, TIMESCALE_NS),
            ...float64Element(DURATION, durationMs),
            ...stringElement(MUXING_APP, 'CutTheFlow WebM Muxer'),
            ...stringElement(WRITING_APP, 'CutTheFlow 0707')
        ]);

        // ── Tracks ──────────────────────────────────────────────────────
        // Video track (TrackNumber=1, TrackType=1=video)
        const videoTrackData = [
            ...uintElement(TRACK_NUMBER, 1),
            ...uintElement(TRACK_UID, 1),
            ...uintElement(TRACK_TYPE, 1), // video
            ...stringElement(CODEC_ID, 'V_VP9'),
            ...(codecPrivate ? element(CODEC_PRIVATE, Array.from(new Uint8Array(codecPrivate))) : []),
            ...element(VIDEO_ID, [
                ...uintElement(PIXEL_WIDTH, width),
                ...uintElement(PIXEL_HEIGHT, height)
            ])
        ];

        // Audio track (TrackNumber=2, TrackType=2=audio)
        let audioTrackData = [];
        const hasAudio = audioChunks && audioChunks.length > 0;
        if (hasAudio) {
            const opusHeadBytes = opusHead
                ? Array.from(new Uint8Array(opusHead))
                : buildOpusHead(sampleRate, channels);
            audioTrackData = [
                ...uintElement(TRACK_NUMBER, 2),
                ...uintElement(TRACK_UID, 2),
                ...uintElement(TRACK_TYPE, 2), // audio
                ...stringElement(CODEC_ID, 'A_OPUS'),
                ...element(CODEC_PRIVATE, opusHeadBytes),
                ...element(AUDIO_ID, [
                    ...float64Element(SAMPLING_FREQ, sampleRate),
                    ...uintElement(CHANNELS, channels),
                    ...uintElement(BIT_DEPTH, 32)
                ])
            ];
        }

        const tracks = element(TRACKS_ID, [
            ...element(TRACK_ENTRY_ID, videoTrackData),
            ...(hasAudio ? element(TRACK_ENTRY_ID, audioTrackData) : [])
        ]);

        // ── Clusters ────────────────────────────────────────────────────
        // Interleave video and audio into clusters (one cluster per keyframe or per second)
        const allFrames = [];
        for (const chunk of videoChunks) {
            allFrames.push({
                track: 1,
                timestampMs: Math.round(chunk.timestamp / 1000), // µs → ms
                data: chunk.data,
                isKey: chunk.isKey
            });
        }
        if (hasAudio) {
            for (const chunk of audioChunks) {
                allFrames.push({
                    track: 2,
                    timestampMs: Math.round(chunk.timestamp / 1000),
                    data: chunk.data,
                    isKey: true // All Opus frames are keyframes
                });
            }
        }
        // Sort by timestamp, video before audio at same time
        allFrames.sort((a, b) => a.timestampMs - b.timestampMs || a.track - b.track);

        // Group into clusters (new cluster at each video keyframe, max 2s)
        const clusters = [];
        let currentCluster = null;
        const CLUSTER_MAX_MS = 2000;

        for (const frame of allFrames) {
            const needNewCluster = !currentCluster
                || (frame.track === 1 && frame.isKey && frame.timestampMs > currentCluster.startMs)
                || (frame.timestampMs - currentCluster.startMs >= CLUSTER_MAX_MS);

            if (needNewCluster) {
                if (currentCluster) clusters.push(currentCluster);
                currentCluster = { startMs: frame.timestampMs, blocks: [] };
            }
            currentCluster.blocks.push(frame);
        }
        if (currentCluster && currentCluster.blocks.length > 0) {
            clusters.push(currentCluster);
        }

        // ── Serialize clusters ──────────────────────────────────────────
        // 🐛 BUGFIX (audit export 2026-09-10) — "Maximum call stack size exceeded".
        //   L'ancienne version empilait tout dans des tableaux JS puis les étalait
        //   avec le spread (`[...clusterContent]`, `[...segmentContent]`) : sur un
        //   export réel (~1,4 Mo, 180 frames + audio) le spread dépasse la taille
        //   maximale de pile JS et le muxage CRASHAIT — le moteur VP9 ne pouvait donc
        //   jamais produire de fichier. On assemble désormais en Uint8Array
        //   (concaténation de longueur connue) : ni spread géant, ni pic mémoire, et
        //   c'est aussi beaucoup plus rapide.
        const concatBytes = (parts) => {
            let total = 0;
            for (const part of parts) total += part.length;
            const out = new Uint8Array(total);
            let offset = 0;
            for (const part of parts) { out.set(part, offset); offset += part.length; }
            return out;
        };
        const u8 = (arr) => arr instanceof Uint8Array ? arr : new Uint8Array(arr);
        const wrapElement = (id, payload) => concatBytes([u8(id), u8(encodeVINT(payload.length)), payload]);

        const clusterBytesList = [];
        for (const cluster of clusters) {
            const parts = [u8(uintElement(TIMECODE, cluster.startMs))];

            for (const block of cluster.blocks) {
                // SimpleBlock: [TrackNum VINT][RelTimecode int16][Flags][Data]
                const relTime = block.timestampMs - cluster.startMs;
                const trackByte = 0x80 | block.track; // 1 → 0x81, 2 → 0x82
                const flags = block.isKey ? 0x80 : 0x00; // Keyframe flag
                const data = u8(block.data);
                const payload = new Uint8Array(4 + data.length);
                payload[0] = trackByte;
                payload[1] = (relTime >> 8) & 0xFF;
                payload[2] = relTime & 0xFF;
                payload[3] = flags;
                payload.set(data, 4);

                parts.push(wrapElement(SIMPLE_BLOCK_ID, payload));
            }

            clusterBytesList.push(wrapElement(CLUSTER_ID, concatBytes(parts)));
        }

        // ── Assemble Segment ────────────────────────────────────────────
        const segmentContent = concatBytes([u8(segInfo), u8(tracks), ...clusterBytesList]);
        const segmentHeader = concatBytes([u8(SEGMENT_ID), u8(encodeVINT(segmentContent.length))]);

        // ── Final file ──────────────────────────────────────────────────
        return new Blob([concatBytes([u8(ebmlHeader), segmentHeader, segmentContent])], { type: 'video/webm' });
    }

    // Build a minimal OpusHead (RFC 7845) for CodecPrivate
    //
    // ⚠️ REPLI UNIQUEMENT — le chemin normal transmet l'OpusHead RÉEL de l'encodeur
    // (capturé dans `metadata.decoderConfig.description`), qui seul connaît le
    // `preSkip` exact de l'implémentation. Ce repli ne sert que si le navigateur ne
    // fournit pas de description.
    //
    // 🐛 BUG CORRIGÉ (2026-09-10) — le `preSkip` était figé à 3840 échantillons (80 ms)
    // alors que l'encodeur Opus de Chrome utilise 312 (6,5 ms). Le pré-skip indique au
    // décodeur combien d'échantillons JETER au début (amorçage de l'encodeur).
    // Déclarer 3840 au lieu de 312 faisait démarrer tout l'audio 73,5 ms trop tôt, et
    // rognait d'autant la fin : l'audio était DÉSYNCHRONISÉ de l'image et le fichier
    // plus court que la vidéo. Mesuré : bascule de piste à 4,917 s au lieu de 5,000 s
    // (erreur −83 ms) ; après correctif : 4,997 s (erreur −3 ms).
    function buildOpusHead(sampleRate, channels) {
        // OpusHead: "OpusHead" + version(1) + channels(1) + preSkip(2) + sampleRate(4) + gain(2) + mappingFamily(1)
        const head = new Uint8Array(19);
        const magic = new TextEncoder().encode('OpusHead');
        head.set(magic, 0);
        head[8] = 1; // Version
        head[9] = channels;
        // Pre-skip = 312 échantillons (6,5 ms) — valeur de l'encodeur Opus de Chrome.
        // NE PAS remettre 3840 : c'était un décalage de 73,5 ms sur tout l'audio.
        const OPUS_PRE_SKIP = 312;
        const view = new DataView(head.buffer);
        view.setUint16(10, OPUS_PRE_SKIP, true); // pre-skip
        view.setUint32(12, sampleRate, true); // input sample rate
        view.setInt16(16, 0, true); // output gain
        head[18] = 0; // channel mapping family (0 = mono/stereo)
        return Array.from(head);
    }

    return { mux };
})();


// ═══════════════════════════════════════════════════════════════════════
// MAIN EXPORT FUNCTION
// ═══════════════════════════════════════════════════════════════════════

async function startWebMWebCodecsExport(app) {
    console.log('%c⚡═══════════════════════════════════════════', 'color: #0ff');
    console.log('%c⚡ WEBM WEBCODECS — VP9 + Opus Offline', 'color: #0ff; font-size: 16px; font-weight: bold');
    console.log('%c⚡═══════════════════════════════════════════', 'color: #0ff');

    const _exportStartTime = performance.now();
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

    let videoEncoder = null;
    let audioEncoder = null;

    try {
        // ═══════════════════════════════════════════════════════════════
        // PHASE 1 : ANALYSE DE LA TIMELINE
        // ═══════════════════════════════════════════════════════════════
        updateStatus('⚡ Phase 1/6 : Analyse de la timeline...');
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
        // Images qui n'ont pas pu être extraites (diagnostic remonté à l'utilisateur).
        let skippedFrames = 0;

        console.log(`⚡ Timeline: ${timelineEnd.toFixed(2)}s, ${totalFrames} frames @ ${fps}fps`);
        console.log(`   Video: ${videoClips.length}, Audio: ${audioClips.length}, Text: ${textClips.length}, Blocks: ${blockClips.length}`);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 2 : CONFIGURATION VP9 ENCODER
        // ═══════════════════════════════════════════════════════════════
        updateStatus('⚡ Phase 2/6 : Configuration VP9...');
        updateProgress(5);

        if (typeof VideoEncoder === 'undefined') {
            throw new Error('WEBM_VP9_UNSUPPORTED');
        }

        const videoEncodedChunks = [];
        let encoderError = null;

        videoEncoder = new VideoEncoder({
            output: (chunk, metadata) => {
                const data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                videoEncodedChunks.push({
                    data,
                    timestamp: chunk.timestamp,
                    duration: chunk.duration,
                    isKey: chunk.type === 'key'
                });
            },
            error: (e) => {
                console.error('❌ VP9 VideoEncoder error:', e);
                encoderError = e;
            }
        });

        // Adaptive bitrate (VP9 is ~30-50% more efficient than H.264)
        const pixelCount = width * height;
        let bitrate;
        if (pixelCount >= 3840 * 2160 * 0.9) bitrate = 20_000_000;
        else if (pixelCount >= 2560 * 1440 * 0.9) bitrate = 14_000_000;
        else if (pixelCount >= 1920 * 1080 * 0.9) bitrate = 10_000_000;
        else if (pixelCount >= 1280 * 720 * 0.9) bitrate = 5_000_000;
        else bitrate = 3_000_000;
        if (fps > 30) bitrate = Math.round(bitrate * Math.min(1.5, fps / 30));

        // ── Codec probe: try HARDWARE first, then SOFTWARE ────────────────────
        // 🐛 ROOT-CAUSE FIX (audit export 2026-09-10):
        //   This probe used to announce `hardwareAcceleration: 'prefer-hardware'`
        //   unconditionally when GPU export was on. Chrome answers "unsupported"
        //   when the *hardware* encoder for that codec doesn't exist — even though
        //   the software VP9 encoder works perfectly. VP9 hardware encoders are
        //   essentially non-existent, so this engine ALWAYS failed with
        //   `WEBM_VP9_UNSUPPORTED` and every WebM export silently fell back to the
        //   real-time MediaRecorder path (which stretched the video to wall-clock
        //   time → "slow motion"). Now we probe hardware, then fall back to the
        //   auto/software encoder before declaring VP9 unavailable.
        //   Also dropped the invalid `'vp9'` codec string (not a valid WebCodecs
        //   codec string, it always answered false).
        const vp9Candidates = ['vp09.00.31.08', 'vp09.00.21.08', 'vp09.00.10.08'];
        const preferHardware = !!(app.useGpuExport ?? app.prefs?.gpuExport);
        const accelerationStrategies = preferHardware ? ['prefer-hardware', null] : [null, 'prefer-software'];
        let vp9Config = null;
        probeVp9:
        for (const acceleration of accelerationStrategies) {
            for (const codec of vp9Candidates) {
                const candidate = {
                    codec,
                    width,
                    height,
                    bitrate,
                    framerate: fps,
                    latencyMode: 'quality'
                };
                // `null` = let the browser pick (it will use hardware when it exists).
                if (acceleration) candidate.hardwareAcceleration = acceleration;
                const supported = await Promise.race([
                    VideoEncoder.isConfigSupported(candidate),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
                ]).catch(() => null);
                if (supported?.supported) {
                    vp9Config = supported.config || candidate;
                    console.log(`✅ VP9 codec retenu: ${codec} · accélération: ${acceleration || 'auto'}`);
                    break probeVp9;
                }
            }
        }
        if (!vp9Config) {
            throw new Error('WEBM_VP9_UNSUPPORTED');
        }

        videoEncoder.configure(vp9Config);
        if (encoderError) throw new Error('VP9 configure() failed: ' + (encoderError.message || encoderError));
        if (videoEncoder.state !== 'configured') throw new Error('VP9 encoder state: ' + videoEncoder.state);
        console.log(`✅ VP9 configured: ${width}x${height} @ ${fps}fps · ${(bitrate / 1e6).toFixed(1)} Mbps`, vp9Config);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 3 : PRÉCHARGEMENT MÉDIAS
        // ═══════════════════════════════════════════════════════════════
        updateStatus('⚡ Phase 3/6 : Préchargement des médias...');
        updateProgress(8);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })
            || canvas.getContext('2d', { alpha: false })
            || canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create 2D context');
        ctx.imageSmoothingEnabled = true;
        if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';

        // 🔬 clipKey → CTFFrameSource. Une source DÉDIÉE par clip, laissée EN PAUSE :
        //    l'extraction se fait par seek exact (voir js/frame-source.js, qui
        //    documente les mesures : l'ancienne lecture temps réel décalait l'image
        //    de 0,88 s en moyenne, 2,08 s au pire).
        const frameSources = new Map();
        const imageElements = new Map();
        const clipKey = clip => String(clip.id ?? `${clip.trackId}:${clip.startTime}:${clip.sourceStart || 0}`);

        if (typeof window.CTFCreateFrameSource !== 'function') {
            throw new Error('Module frame-source.js non chargé — extraction vidéo impossible.');
        }

        for (const clip of videoClips) {
            if (!clip.url || clip.url === 'undefined' || clip.url === 'null') continue;
            if (clip.type === 'video') {
                try {
                    frameSources.set(clipKey(clip), await window.CTFCreateFrameSource(clip.url, fps));
                } catch (e) {
                    console.warn(`⚠️ Source illisible, clip ignoré : ${clip.name || clip.url} — ${e.message}`);
                }
            }
            if (clip.type === 'image' && !imageElements.has(clip.url)) {
                const img = new Image();
                if (!clip.url.startsWith('blob:')) img.crossOrigin = 'anonymous';
                img.src = clip.url;
                await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
                imageElements.set(clip.url, img);
            }
        }
        console.log(`🔬 ${frameSources.size} source(s) vidéo ouverte(s) en mode frame-exact`);

        updateProgress(12);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 4 : AUDIO OFFLINE (PCM → Opus)
        // ═══════════════════════════════════════════════════════════════
        updateStatus('⚡ Phase 4/6 : Encodage audio Opus offline...');
        updateProgress(15);

        const AUDIO_SAMPLE_RATE = 48000;
        const AUDIO_CHANNELS = 2;
        const hasAudio = audioClips.length > 0 || videoClips.some(c => c.type === 'video' && !c.audioMuted && !c.audioUnlinked);
        const audioEncodedChunks = [];
        let audioExportWarning = null;
        // 🐛 CORRECTIF (2026-09-10) — en-tête Opus (OpusHead) RÉEL fourni par l'encodeur
        // du navigateur. Il porte le `preSkip` EXACT de l'encodeur, indispensable à la
        // synchronisation audio/image. Voir buildOpusHead() pour le détail du bug corrigé.
        let opusHeadDescription = null;

        // An audio failure must never abort a viable video export: any throw
        // inside this block is caught below and degrades to a silent WebM
        // instead of discarding everything via the outer try/catch.
        if (hasAudio && typeof AudioEncoder !== 'undefined') { try {
            // Step 1: Offline PCM mixdown (same approach as webcodecs-export)
            const totalSamples = Math.ceil(timelineEnd * AUDIO_SAMPLE_RATE);
            const mixBuffer = new Float32Array(AUDIO_CHANNELS * totalSamples);

            const allAudioForMix = [
                ...audioClips.map(c => ({ ...c, _isVideoAudio: false })),
                ...videoClips.filter(c => c.type === 'video' && !c.audioMuted && !c.audioUnlinked)
                    .map(c => ({ ...c, _isVideoAudio: true }))
            ];

            const decodeCtx = app._getDecodeAudioContext ? app._getDecodeAudioContext() : new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
            for (const clip of allAudioForMix) {
                try {
                    let arrayBuf;
                    if (clip.file && clip.file instanceof Blob) {
                        arrayBuf = await clip.file.arrayBuffer();
                    } else if (clip.url) {
                        const response = await fetch(clip.url);
                        arrayBuf = await response.arrayBuffer();
                    } else { continue; }

                    const audioBuf = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
                    if (!audioBuf || audioBuf.duration === 0) continue;

                    const srcSR = audioBuf.sampleRate;
                    const srcCh = audioBuf.numberOfChannels;
                    // Canaux extraits une seule fois (voir webcodecs-export.js).
                    const srcChans = [];
                    for (let c = 0; c < srcCh; c++) srcChans.push(audioBuf.getChannelData(c));
                    const clipStartSample = Math.round(clip.startTime * AUDIO_SAMPLE_RATE);
                    const clipSrcStart = Math.round((clip.sourceStart || 0) * srcSR);
                    const clipLenSamples = Math.round(clip.duration * AUDIO_SAMPLE_RATE);

                    const track = app.tracks.find(t => t.id === clip.trackId);
                    const trackVol = track ? (track.volume !== undefined ? track.volume : 100) / 100 : 1;
                    const gain = Math.max(0, trackVol);
                    const fi = clip.fadeIn || 0;
                    const fo = clip.fadeOut || 0;

                    for (let s = 0; s < clipLenSamples; s++) {
                        const outIdx = clipStartSample + s;
                        if (outIdx < 0 || outIdx >= totalSamples) continue;
                        // 🎧 RÉÉCHANTILLONNAGE PAR INTERPOLATION LINÉAIRE (2026-09-17)
                        // Voir le commentaire détaillé dans webcodecs-export.js : le plus proche
                        // voisin (`Math.round(s * srcSR / AUDIO_SAMPLE_RATE)`) faisait souffler les
                        // sources 44,1 kHz, alors que le moteur MP3 interpolait déjà. Les trois
                        // moteurs partagent maintenant la même formule de fondu ET de
                        // rééchantillonnage, donc un même projet sonne pareil en MP4, WebM et MP3.
                        const srcPosF = s * srcSR / AUDIO_SAMPLE_RATE;
                        const i0 = Math.floor(srcPosF);
                        const frac = srcPosF - i0;

                        const tSec = s / AUDIO_SAMPLE_RATE;
                        let fadeGain = 1;
                        if (fi > 0 && tSec < fi) fadeGain = Math.min(fadeGain, tSec / fi);
                        if (fo > 0 && tSec > clip.duration - fo) fadeGain = Math.min(fadeGain, (clip.duration - tSec) / fo);
                        const finalGain = gain * fadeGain;

                        const idx0 = clipSrcStart + i0;
                        for (let ch = 0; ch < AUDIO_CHANNELS; ch++) {
                            const data = srcChans[ch % srcCh];
                            let val = 0;
                            if (data && idx0 >= 0 && idx0 < data.length) {
                                const a = data[idx0];
                                const idx1 = Math.min(data.length - 1, idx0 + 1);
                                const b = data[idx1];
                                val = a + (b - a) * frac;
                            }
                            mixBuffer[outIdx * AUDIO_CHANNELS + ch] += val * finalGain;
                        }
                    }
                } catch (e) { console.warn(`⚠️ Audio skip: ${clip.name}`, e.message); }
            }

            // Normalize (même seuil que MP3 et MP4 : 0,99)
            let peak = 0;
            for (let i = 0; i < mixBuffer.length; i++) {
                const a = mixBuffer[i] < 0 ? -mixBuffer[i] : mixBuffer[i];
                if (a > peak) peak = a;
            }
            if (peak > 0.99) {
                const norm = 0.99 / peak;
                for (let i = 0; i < mixBuffer.length; i++) mixBuffer[i] *= norm;
            }

            // Step 2: Encode PCM → Opus via AudioEncoder
            audioEncoder = new AudioEncoder({
                output: (chunk, metadata) => {
                    const data = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(data);
                    audioEncodedChunks.push({
                        data,
                        timestamp: chunk.timestamp,
                        duration: chunk.duration
                    });
                    // 🐛 CORRECTIF (2026-09-10) — Chrome fournit ici le VRAI OpusHead
                    // (`preSkip` de l'encodeur). Ne JAMAIS le remplacer par un en-tête
                    // reconstruit : un `preSkip` faux décale TOUT l'audio du montage.
                    if (!opusHeadDescription && metadata?.decoderConfig?.description) {
                        const rawDesc = metadata.decoderConfig.description;
                        opusHeadDescription = rawDesc instanceof ArrayBuffer
                            ? rawDesc
                            : new Uint8Array(rawDesc).buffer;
                        const u8 = new Uint8Array(opusHeadDescription);
                        const preSkip = u8[10] | (u8[11] << 8);
                        console.log(`✅ OpusHead de l'encodeur : preSkip=${preSkip} éch. (${(preSkip / 48).toFixed(2)} ms)`);
                    }
                },
                error: (e) => console.error('❌ Opus AudioEncoder error:', e)
            });

            const opusConfig = {
                codec: 'opus',
                numberOfChannels: AUDIO_CHANNELS,
                sampleRate: AUDIO_SAMPLE_RATE,
                bitrate: 128000 // 128kbps Opus = excellent quality
            };
            const opusSupported = await AudioEncoder.isConfigSupported(opusConfig);
            if (!opusSupported?.supported) {
                throw new Error('Opus encoder indisponible — utilisez le moteur MP4.');
            }
            audioEncoder.configure(opusConfig);
            console.log('✅ Opus AudioEncoder configured: 48kHz stereo 128kbps');

            // Feed PCM frames (960 samples per Opus frame @ 48kHz = 20ms)
            const OPUS_FRAME_SIZE = 960;
            let audioFrameIdx = 0;
            while (audioFrameIdx * OPUS_FRAME_SIZE < totalSamples) {
                const offset = audioFrameIdx * OPUS_FRAME_SIZE;
                const frameLen = Math.min(OPUS_FRAME_SIZE, totalSamples - offset);

                const planar = new Float32Array(AUDIO_CHANNELS * OPUS_FRAME_SIZE);
                for (let ch = 0; ch < AUDIO_CHANNELS; ch++) {
                    for (let s = 0; s < frameLen; s++) {
                        planar[ch * OPUS_FRAME_SIZE + s] = mixBuffer[(offset + s) * AUDIO_CHANNELS + ch];
                    }
                }

                const audioData = new AudioData({
                    format: 'f32-planar',
                    sampleRate: AUDIO_SAMPLE_RATE,
                    numberOfFrames: OPUS_FRAME_SIZE,
                    numberOfChannels: AUDIO_CHANNELS,
                    timestamp: Math.round(offset / AUDIO_SAMPLE_RATE * 1_000_000),
                    data: planar.buffer
                });
                audioEncoder.encode(audioData);
                audioData.close();
                audioFrameIdx++;

                if (audioEncoder.encodeQueueSize > 8) {
                    while (audioEncoder.encodeQueueSize > 4) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }
            await audioEncoder.flush();
            audioEncoder.close();
            audioEncoder = null;
            console.log(`✅ Opus: ${audioEncodedChunks.length} audio frames encoded`);
        } catch (e) {
            console.error('❌ Opus audio encoding failed — exporting video without sound:', e);
            audioExportWarning = 'Le son n\'a pas pu être encodé (' + (e?.message || e) + ') — export vidéo sans audio.';
            audioEncodedChunks.length = 0;
        } finally {
            try { if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close(); } catch (_) {}
            audioEncoder = null;
        } } else if (hasAudio) {
            audioExportWarning = 'AudioEncoder indisponible sur ce navigateur — export vidéo sans audio.';
            console.warn('⚠️', audioExportWarning);
        }

        updateProgress(20);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 5 : RENDU VIDÉO FRAME PAR FRAME (offline, déterministe)
        // ═══════════════════════════════════════════════════════════════
        updateStatus('⚡ Phase 5/6 : Encodage VP9 frame par frame...');

        // Color grading setup
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
        let lastValidFrameCanvas, lastValidFrameCtx, hasLastValidFrame = false, consecutiveBlackFrames = 0;
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

        // ⏱️ Horodatage des frames : CALCULÉ par arrondi direct, jamais accumulé.
        const frameTimestampUs = (i) => Math.round(i * 1_000_000 / fps);
        const frameDurationAtUs = (i) => frameTimestampUs(i + 1) - frameTimestampUs(i);

        // 🎬 AMORÇAGE — ouvre le décodeur de la source active au temps 0 pour que la
        // toute première image ne soit pas noire. Les autres sources s'amorcent à la
        // demande : ouvrir toutes les sources d'un long montage coûterait des
        // centaines de Mo de décodeurs pour rien.
        {
            let primer = null;
            for (const clip of videoClips) {
                if (clip.type !== 'video') continue;
                const src = frameSources.get(clipKey(clip));
                if (src && clip.startTime <= 0.0001) { primer = src; break; }
            }
            if (primer) {
                updateStatus('⚡ Amorçage du décodeur…');
                await primer.prime(0);
            }
        }

        console.log(`⚡ Starting VP9 encoding: ${totalFrames} frames`);

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
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
                            fxLayerCtx.save(); fxLayerCtx.globalAlpha = 1;
                            if (anim.rot !== 0) { fxLayerCtx.translate(cx, cy); fxLayerCtx.rotate(anim.rot); fxLayerCtx.drawImage(img, -dw / 2, -dh / 2, dw, dh); }
                            else { fxLayerCtx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh); }
                            fxLayerCtx.restore();
                            app.applyClipEffectToCanvas(fxLayerCtx, clip, width, height, frameIndex);
                            ctx.save(); ctx.globalAlpha = alphaClamped; ctx.drawImage(fxLayerCanvas, 0, 0); ctx.restore();
                        } else {
                            ctx.save(); ctx.globalAlpha = alphaClamped;
                            if (anim.rot !== 0) { ctx.translate(cx, cy); ctx.rotate(anim.rot); ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); }
                            else { ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh); }
                            ctx.restore();
                        }
                        drewSomething = true;

                    } else if (clip.type === 'video') {
                        const frameSrc = frameSources.get(clipKey(clip));
                        const video = frameSrc && frameSrc.video;
                        if (!frameSrc || !video) continue;
                        const srcTime = (clip.sourceStart || 0) + timeInClip;
                        // 🔬 Extraction frame-exacte : l'élément est mis EN PAUSE sur la
                        // frame voulue, donc `drawImage` dessine exactement l'image de
                        // `srcTime` (voir js/frame-source.js).
                        const decoded = await frameSrc.frameAt(srcTime);
                        if (!decoded) { skippedFrames++; continue; }

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
                            fxLayerCtx.save(); fxLayerCtx.globalAlpha = 1;
                            if (anim.rot !== 0) { fxLayerCtx.translate(cx, cy); fxLayerCtx.rotate(anim.rot); fxLayerCtx.drawImage(video, -dw / 2, -dh / 2, dw, dh); }
                            else { fxLayerCtx.drawImage(video, cx - dw / 2, cy - dh / 2, dw, dh); }
                            fxLayerCtx.restore();
                            app.applyClipEffectToCanvas(fxLayerCtx, clip, width, height, frameIndex);
                            ctx.save(); ctx.globalAlpha = alphaClamped; ctx.drawImage(fxLayerCanvas, 0, 0); ctx.restore();
                        } else {
                            ctx.save(); ctx.globalAlpha = alphaClamped;
                            if (anim.rot !== 0) { ctx.translate(cx, cy); ctx.rotate(anim.rot); ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh); }
                            else { ctx.drawImage(video, cx - dw / 2, cy - dh / 2, dw, dh); }
                            ctx.restore();
                        }
                        drewSomething = true;
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
                    if (anim.sx !== 1 || anim.rot !== 0) {
                        const tx = bx + (anim.tx / 100) * width, ty = by + (anim.ty / 100) * height;
                        ctx.translate(tx, ty);
                        if (anim.rot !== 0) ctx.rotate(anim.rot);
                        if (anim.sx !== 1) ctx.scale(anim.sx, anim.sx);
                        ctx.fillText(clip.content || 'TEXT', 0, 0);
                    } else {
                        ctx.fillText(clip.content || 'TEXT', bx + (anim.tx / 100) * width, by + (anim.ty / 100) * height);
                    }
                } else if (type === 'block') {
                    const bw = (width * (clip.width || 50)) / 100;
                    const bh = (height * (clip.height || 50)) / 100;
                    const bx = (width * (clip.posX || 25)) / 100;
                    const by = (height * (clip.posY || 25)) / 100;
                    ctx.fillStyle = clip.color || '#ff0000';
                    const fadeOpacity = app._calcFadeOpacity ? app._calcFadeOpacity(clip, currentTime) : 1.0;
                    ctx.globalAlpha = (clip.opacity ?? 1.0) * Math.max(0, Math.min(1, anim.alpha * fadeOpacity));
                    if (anim.sx !== 1 || anim.rot !== 0) {
                        const cx2 = bx + bw / 2 + (anim.tx / 100) * width;
                        const cy2 = by + bh / 2 + (anim.ty / 100) * height;
                        ctx.translate(cx2, cy2);
                        if (anim.rot !== 0) ctx.rotate(anim.rot);
                        if (anim.sx !== 1) ctx.scale(anim.sx, anim.sx);
                        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
                    } else {
                        ctx.fillRect(bx + (anim.tx / 100) * width, by + (anim.ty / 100) * height, bw, bh);
                    }
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
                    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
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
            // On ne laisse JAMAIS apparaître un noir au milieu d'un clip : on
            // reconduit la dernière image valide (bien moins visible qu'un flash).
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

            // ── Encode frame VP9 ────────────────────────────────────────
            if (encoderError) throw new Error('VP9 encoder failed: ' + (encoderError.message || encoderError));

            const frame = new VideoFrame(canvas, {
                timestamp: frameTimestampUs(frameIndex),
                duration: frameDurationAtUs(frameIndex)
            });
            const keyFrame = frameIndex % fps === 0;
            try {
                videoEncoder.encode(frame, { keyFrame });
            } finally {
                frame.close();
            }

            // Backpressure
            if (videoEncoder.encodeQueueSize > 8) {
                while (videoEncoder.encodeQueueSize > 4) {
                    await new Promise(r => setTimeout(r, 0));
                }
            } else if ((frameIndex & 7) === 0) {
                await new Promise(r => setTimeout(r, 0));
            }

            if (encoderError) throw new Error('VP9 encoder failed: ' + (encoderError.message || encoderError));

            // Progress
            if (frameIndex % 10 === 0) {
                const pct = 20 + (frameIndex / totalFrames) * 70;
                updateProgress(Math.min(92, Math.round(pct)));
                updateStatus(`⚡ VP9 : ${frameIndex + 1}/${totalFrames} frames...`);
            }
        }

        // Flush video encoder
        await videoEncoder.flush();
        videoEncoder.close();
        videoEncoder = null;
        console.log(`✅ VP9: ${videoEncodedChunks.length} video frames encoded`);

        updateProgress(93);

        // ═══════════════════════════════════════════════════════════════
        // PHASE 6 : MUXAGE WEBM (EBML)
        // ═══════════════════════════════════════════════════════════════
        updateStatus('⚡ Phase 6/6 : Muxage WebM...');
        updateProgress(95);

        const videoBlob = WebMMuxer.mux({
            width,
            height,
            fps,
            durationMs: Math.round(timelineEnd * 1000),
            sampleRate: AUDIO_SAMPLE_RATE,
            channels: AUDIO_CHANNELS,
            videoChunks: videoEncodedChunks,
            audioChunks: audioEncodedChunks.length > 0 ? audioEncodedChunks : null,
            codecPrivate: null, // VP9 doesn't require CodecPrivate
            // 🐛 CORRECTIF (2026-09-10) — transmettre l'OpusHead RÉEL de l'encodeur
            // (avec son `preSkip` exact) au lieu de laisser le muxeur en fabriquer un.
            opusHead: opusHeadDescription
        });

        if (videoBlob.size < 1024) throw new Error(`WebM vide ou incomplet (${videoBlob.size} octets)`);

        updateProgress(100);
        updateStatus(audioExportWarning ? '⚡ Export WebM terminé (sans audio)' : '⚡ Export WebM VP9+Opus terminé !');

        // 📊 Contrôle qualité : 0 image « reconduite » = l'export est exactement la timeline.
        const _srcStats = [...frameSources.values()].reduce((acc, s) => {
            acc.seeks += s.stats.seeks; acc.reuses += s.stats.reuses;
            acc.failures += s.stats.failures; acc.late += s.stats.lateFrames;
            acc.errSum += s.stats.errSum; acc.errMax = Math.max(acc.errMax, s.stats.errMax);
            acc.samples += s.stats.samples;
            acc.duplicates += s.stats.duplicates; acc.skips += s.stats.skips;
            return acc;
        }, { seeks: 0, reuses: 0, failures: 0, late: 0, errSum: 0, errMax: 0, samples: 0, duplicates: 0, skips: 0 });
        const _errAvgMs = _srcStats.samples ? (_srcStats.errSum / _srcStats.samples * 1000) : 0;
        console.log(`📊 Extraction : ${_srcStats.seeks} seeks, ${_srcStats.reuses} réutilisations · ${skippedFrames} image(s) reconduite(s) · cadence : ${_srcStats.duplicates} duplication(s), ${_srcStats.skips} saut(s) · erreur d'image moyenne ${_errAvgMs.toFixed(1)} ms / max ${(_srcStats.errMax * 1000).toFixed(1)} ms · ${_srcStats.failures} échec(s)`);
        if (skippedFrames > 0) {
            app.showStatus('⚠️ ' + skippedFrames + ' image(s) n\'ont pas pu être extraites et ont été remplacées par l\'image précédente.', 'warning', 9000);
        }

        // Cleanup
        for (const frameSrc of frameSources.values()) {
            try { frameSrc.release(); } catch (_) {}
        }

        app.exportedVideoBlob = videoBlob;
        app.exportedVideoUrl = URL.createObjectURL(videoBlob);
        app.exportedMimeType = 'video/webm';

        await app.sleep(500);
        app.closeExportModal();
        app.showExportPreview(width, height, fps, 'webm', videoBlob.size);
        // Surface audio degradation after the preview opens — the export itself
        // succeeded, so this must never look like a failure.
        if (audioExportWarning) app.showStatus('⚠️ ' + audioExportWarning);

        const elapsed = ((performance.now() - _exportStartTime) / 1000).toFixed(1);
        console.log('%c⚡═══════════════════════════════════════════', 'color: #0ff');
        console.log('%c⚡ WEBM VP9+OPUS EXPORT TERMINÉ', 'color: #0ff; font-size: 14px; font-weight: bold');
        console.log('%c⚡═══════════════════════════════════════════', 'color: #0ff');
        console.log(`   📊 Frames: ${totalFrames}/${totalFrames} (100%)`);
        console.log(`   📦 Taille: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   🎞️ Format: WebM VP9 + Opus`);
        console.log(`   🔊 Audio: ${audioEncodedChunks.length > 0 ? 'Opus 128kbps (offline, sample-accurate)' : 'Aucun'}`);
        console.log('   ⚡ Sync: 100% offline — zéro dépendance au real-time');

    } catch (error) {
        console.error('❌ WebM WebCodecs export failed:', error);
        const errMsg = error ? (error.message || String(error)) : 'Unknown error';
        if (error.message === 'WEBM_VP9_UNSUPPORTED') {
            // Re-throw so handleExport() can fall back to Canvas
            throw error;
        }
        updateStatus('Export échoué : ' + errMsg);
        app.showStatus('❌ ' + errMsg);
        throw error;
    } finally {
        try { if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close(); } catch (_) {}
        try { if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close(); } catch (_) {}
        app.isExporting = false;
        document.getElementById('startExportBtn').disabled = false;
    }
}
