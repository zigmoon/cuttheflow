// WebCodecs H.264 + AAC Export Module
// Ultra-quality hardware-accelerated export with audio muxing

/**
 * 🎵 Construit la boîte MP4 `esds` (ES_Descriptor) requise pour une piste AAC.
 *
 * POURQUOI CE CODE EXISTE (correctif 2026-09-10) :
 *   La piste audio des exports MP4 était **indécodable** — `ffprobe` la voyait comme
 *   `unknown,video` et aucun lecteur ne pouvait la lire. Trois causes cumulées dans
 *   ce bundle de MP4Box :
 *
 *   1. Il ne sait **PAS ÉCRIRE** la boîte `esds` (aucun writer `esdsBox` dans le
 *      fichier minifié : l'API ne fait que la *parser*). Passer l'AudioSpecificConfig
 *      brut en `description` faisait donc planter la sérialisation avec
 *      `TypeError: this.boxes[e].write is not a function` — l'export MP4 avec audio
 *      échouait entièrement.
 *   2. `addTrack()` sélectionne le type de *sample entry* via son FourCC : il faut
 *      `'mp4a'`. Le code passait `'audio'` (qui est le *handler*, pas le 4CC) :
 *      `BoxParser['audioSampleEntry']` n'existe pas → MP4Box retombait sur le sample
 *      entry VISUEL (`e.type || 'avc1'`) → piste déclarée `vide` avec codec inconnu.
 *   3. Le taux d'échantillonnage doit être fourni dans **`samplerate`** (entier en Hz,
 *      MP4Box l'écrit en 16.16 via `samplerate << 16`). Le code passait `sample_rate`,
 *      ignoré → repli sur 65536 → piste invalide.
 *
 * On sérialise donc la boîte nous-mêmes, conformément à l'ISO/IEC 14496-1 :
 *
 *   esds (FullBox)
 *     └─ ES_Descriptor (0x03)
 *          ├─ ES_ID (2 octets) + flags (1 octet)
 *          ├─ DecoderConfigDescriptor (0x04)
 *          │     ├─ objectTypeIndication = 0x40  (MPEG-4 Audio)
 *          │     ├─ streamType 0x05 (audio) / upStream 0 / reserved 1  → 0x15
 *          │     ├─ bufferSizeDB (3 octets) + maxBitrate (4) + avgBitrate (4)
 *          │     └─ DecoderSpecificInfo (0x05) = AudioSpecificConfig
 *          └─ SLConfigDescriptor (0x06) = 0x02 (prédéfini, MP4)
 *
 * @param {ArrayBuffer|Uint8Array} audioSpecificConfig - ASC fourni par l'AudioEncoder
 * @param {{bitrate?:number}} [opts]
 * @returns {{type:string,size:number,data:Uint8Array,write:Function}} boîte lisible par MP4Box
 */
function createEsdsBox(audioSpecificConfig, opts) {
    const asc = Array.from(
        audioSpecificConfig instanceof Uint8Array
            ? audioSpecificConfig
            : new Uint8Array(audioSpecificConfig)
    );
    const bitrate = (opts && opts.bitrate) || 192000;

    // Descripteur MPEG-4 : tag + longueur en base-128 (1 à 4 octets) + charge utile.
    const descriptor = (tag, payload) => {
        const lengthBytes = [payload.length & 0x7F];
        let rest = payload.length >> 7;
        while (rest > 0) {
            lengthBytes.unshift((rest & 0x7F) | 0x80);
            rest >>= 7;
        }
        return [tag, ...lengthBytes, ...payload];
    };

    // DecoderConfigDescriptor (0x04) : audio MPEG-4, buffer et débits.
    const bufferSizeDB = 6144;
    const decoderConfig = [
        0x40,                                     // ObjectTypeIndication : MPEG-4 Audio
        0x15,                                     // streamType 5 (audio) | upStream 0 | reserved 1
        (bufferSizeDB >> 16) & 0xFF, (bufferSizeDB >> 8) & 0xFF, bufferSizeDB & 0xFF,
        (bitrate >>> 24) & 0xFF, (bitrate >>> 16) & 0xFF, (bitrate >>> 8) & 0xFF, bitrate & 0xFF,
        (bitrate >>> 24) & 0xFF, (bitrate >>> 16) & 0xFF, (bitrate >>> 8) & 0xFF, bitrate & 0xFF,
        // DecoderSpecificInfo = AudioSpecificConfig transmis tel quel par WebCodecs
        ...descriptor(0x05, asc)
    ];

    // ES_Descriptor (0x03) : ES_ID = 1, aucun drapeau, puis DCD et SLConfig.
    const esDescriptor = descriptor(0x03, [
        0x00, 0x01, 0x00,
        ...descriptor(0x04, decoderConfig),
        ...descriptor(0x06, [0x02])               // SLConfigDescriptor : prédéfini n°2
    ]);

    // Charge utile du FullBox : version(1) + flags(3) + descripteurs.
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, ...esDescriptor]);

    return {
        type: 'esds',
        size: 8 + data.length,   // 8 = en-tête MP4 (taille + type), écrit ci-dessous
        data,
        // `sampleEntry.writeFooter()` appelle `.write(stream)` sur chaque boîte de
        // `description`. On écrit l'en-tête puis la charge utile (identique à ce que
        // fait `BoxParser.Box.prototype.writeHeader` pour une taille < 4 Go).
        write(stream) {
            this.size = 8 + this.data.length;
            stream.writeUint32(this.size);
            stream.writeString(this.type, null, 4);
            stream.writeUint8Array(this.data);
        }
    };
}

async function startWebCodecsExport(app) {
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #f0f');
    console.log('%c🎬 WEBCODECS H.264 + AAC EXPORT', 'color: #f0f; font-size: 16px; font-weight: bold');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #f0f');

    const [width, height] = (app.selectedResolution || '1920x1080').split('x').map(v => Number(v));
    const fps = Number(app.selectedFps) || 30;
    if (!width || !height) {
        throw new Error('Invalid export resolution');
    }
    
    app.isExporting = true;
    
    // Show progress
    document.getElementById('exportProgress').style.display = 'block';
    document.getElementById('startExportBtn').disabled = true;

    const updateProgress = (percent) => {
        const fill = document.getElementById('exportProgressFill');
        if (fill) { fill.style.width = percent + '%'; const t = fill.querySelector('.progress-text'); if (t) t.textContent = Math.round(percent) + '%'; }
    };

    const updateStatus = (text) => {
        const el = document.getElementById('exportStatus');
        if (el) el.textContent = text;
    };

    // Hoisted so the `finally` block can always release hardware resources,
    // even when the encoder failed to construct/configure.
    let encoder = null;
    let canvas = null;
    let lastValidFrameCanvas = null;
    let lastValidFrameCtx = null;
    let hasLastValidFrame = false;
    let consecutiveBlackFrames = 0;
    let skippedFrames = 0;   // images sans source exploitable (diagnostic + message final)
    // 🔬 clipKey → CTFFrameSource. Une source DÉDIÉE par clip, laissée EN PAUSE :
    //    l'extraction se fait par seek exact (voir js/frame-source.js et les mesures
    //    qui y sont documentées). L'ancien code laissait les vidéos JOUER en temps
    //    réel, ce qui décalait l'image de 0,88 s en moyenne (2,08 s au pire).
    const frameSources = new Map();

    try {
        updateStatus('Analyzing timeline...');
        updateProgress(5);

        // Collect clips
        let timelineEnd = 0;
        const videoClips = [];
        const audioClips = [];
        const textClips = [];
        const blockClips = [];

        app.tracks.forEach((track, trackIndex) => {
            track.clips.forEach(clip => {
                // Ensure numbers
                const start = parseFloat(clip.startTime);
                const dur = parseFloat(clip.duration);
                const end = start + dur;
                
                if (end > timelineEnd) timelineEnd = end;
                
                const isTrackMuted = track.muted || track._effectiveMute;
                if (!isTrackMuted) {
                    if (clip.type === 'video' || clip.type === 'image') {
                        const c = { ...clip, trackId: track.id, trackIndex, trackVolume: track.volume };
                        if (clip.isUsingProxy && clip.originalUrl) {
                            c.url = clip.originalUrl;
                            const orig = app.mediaLibrary.find(m => m.id === clip.mediaId);
                            if (orig) { c.width = orig.width; c.height = orig.height; }
                        }
                        videoClips.push(c);
                    }
                    if (clip.type === 'audio') {
                        audioClips.push({ ...clip, trackId: track.id, trackIndex, trackVolume: track.volume });
                    }
                    // Text & colour-block overlays must be rendered too — without these
                    // the advanced (WebCodecs) export was missing visual layers that the
                    // preview and the MediaRecorder export both show.
                    if (clip.type === 'text') {
                        textClips.push({ ...clip, trackId: track.id, trackIndex });
                    }
                    if (clip.type === 'block') {
                        blockClips.push({ ...clip, trackId: track.id, trackIndex });
                    }
                }
            });
        });

        if (timelineEnd === 0) {
            throw new Error('Timeline is empty');
        }

        console.log(`Timeline: ${timelineEnd.toFixed(2)}s, Clips: ${videoClips.length} video, ${audioClips.length} audio`);

        updateProgress(10);
        updateStatus('Configuring WebCodecs encoder...');

        // WebCodecs H.264 Encoder
        const encodedChunks = [];
        let avcDescription = null;
        let encoderError = null;
        encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                const chunkData = new Uint8Array(chunk.byteLength);
                chunk.copyTo(chunkData);
                encodedChunks.push({
                    type: chunk.type,
                    timestamp: chunk.timestamp,
                    duration: chunk.duration,
                    data: chunkData
                });
                // Capture avcC decoder description for MP4 muxing
                if (!avcDescription && metadata?.decoderConfig?.description) {
                    const rawDesc = metadata.decoderConfig.description;
                    avcDescription = rawDesc instanceof ArrayBuffer ? rawDesc : new Uint8Array(rawDesc).buffer;
                }
            },
            error: (e) => {
                console.error('❌ VideoEncoder error:', e);
                encoderError = e;
            }
        });

        // 🎯 Adaptive bitrate by resolution (aligned with the MediaRecorder path).
        // Fixed 10 Mbps under-served 4K (visible artefacts) and over-sized 720p files.
        // H.264 is more efficient than VP9, so these YouTube-class VP9 targets leave
        // generous headroom for clean output. Scaled up slightly for high fps (>30).
        const _pixelCount = width * height;
        let _bitrate;
        if (_pixelCount >= 3840 * 2160 * 0.9) {
            _bitrate = 30_000_000;        // 4K (UHD)
        } else if (_pixelCount >= 2560 * 1440 * 0.9) {
            _bitrate = 20_000_000;        // 1440p (2K)
        } else if (_pixelCount >= 1920 * 1080 * 0.9) {
            _bitrate = 16_000_000;        // 1080p
        } else if (_pixelCount >= 1280 * 720 * 0.9) {
            _bitrate = 8_000_000;         // 720p
        } else {
            _bitrate = 5_000_000;         // SD / smaller
        }
        // High frame rates carry more data per second — scale up to keep quality.
        if (fps > 30) {
            _bitrate = Math.round(_bitrate * Math.min(1.5, fps / 30));
        }

        const config = {
            codec: 'avc1.42E028',
            width: width,
            height: height,
            bitrate: _bitrate,
            framerate: fps,
            hardwareAcceleration: (app.useGpuExport ?? app.prefs?.gpuExport) ? 'prefer-hardware' : 'prefer-software',
            latencyMode: 'quality' // Prioritize quality over speed
        };

        // Probe a level suitable for the requested dimensions. Level 3.0 was
        // invalid for 1080p/4K and caused false "H.264 unsupported" failures.
        // 🐛 ROOT-CAUSE FIX (audit export 2026-09-10): the candidate list used to
        // be short and started with `avc1.42E01E` — a Baseline/Level-3.0 string
        // that some machines reject outright, aborting the whole MP4 export even
        // though `avc1.42E028` / `avc1.640028` encode fine (verified on this box:
        // 42E01E = false, 42E028 = true). We now probe a wider, better-ordered set
        // AND retry in software when the hardware probe fails, so a missing GPU
        // encoder never disables MP4 export.
        const codecCandidates = width * height >= 3840 * 2160 * 0.9
            ? ['avc1.640033', 'avc1.4D4033', 'avc1.42E033', 'avc1.640034']
            : width * height >= 1920 * 1080 * 0.9 || fps > 30
                ? ['avc1.640028', 'avc1.4D4028', 'avc1.42E028', 'avc1.42E01F']
                : ['avc1.42E028', 'avc1.42E01F', 'avc1.4D401F', 'avc1.640028', 'avc1.42E01E'];
        const _preferHardware = !!(app.useGpuExport ?? app.prefs?.gpuExport);
        const _accelStrategies = _preferHardware ? ['prefer-hardware', null, 'prefer-software'] : ['prefer-software', null];
        let supported = null;
        probeH264:
        for (const accel of _accelStrategies) {
            for (const codec of codecCandidates) {
                const candidate = { ...config, codec };
                if (accel) candidate.hardwareAcceleration = accel;
                const probe = await Promise.race([
                    VideoEncoder.isConfigSupported(candidate),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                ]).catch(() => null);
                if (probe?.supported) {
                    supported = probe;
                    Object.assign(config, probe.config || candidate);
                    console.log(`✅ H.264 codec retenu: ${codec} · accélération: ${accel || 'auto'}`);
                    break probeH264;
                }
            }
        }
        if (!supported?.supported) {
            console.warn('⚠️ H.264 non supporté → fallback Canvas');
            throw new Error('MP4_H264_UNSUPPORTED');
        }

        const isH264Codec = true;
        encoder.configure(config);
        // Vérifier que l'encodeur n'a pas crashé pendant configure()
        if (encoderError) {
            throw new Error('VideoEncoder configure() a échoué : ' + (encoderError.message || encoderError));
        }
        if (encoder.state !== 'configured') {
            throw new Error('VideoEncoder state incorrect après configure() : ' + encoder.state);
        }
        console.log(`✅ VideoEncoder configured: ${width}x${height} @ ${fps}fps · ${(_bitrate / 1e6).toFixed(1)} Mbps`, config);

        updateProgress(15);
        updateStatus('Preloading media...');

        // Create canvas for rendering
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        // 🛡️ FALLBACKS ROBUSTES - essayer plusieurs configs
        let ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
        
        if (!ctx) {
            console.warn('⚠️ Fallback 1...');
            ctx = canvas.getContext('2d', { alpha: false });
        }
        
        if (!ctx) {
            console.warn('⚠️ Fallback 2...');
            ctx = canvas.getContext('2d', { willReadFrequently: false });
        }
        
        if (!ctx) {
            console.warn('⚠️ Fallback 3 (basique)...');
            ctx = canvas.getContext('2d');
        }
        
        if (!ctx) {
            throw new Error('Impossible de créer un contexte 2D (tous les fallbacks échoués)');
        }
        
        console.log('✅ Canvas context créé pour WebCodecs');

        // For each clip, prefer the original full-quality URL over the editing proxy.
        for (const clip of videoClips) {
            if (clip.isUsingProxy && clip.originalUrl) {
                clip.url = clip.originalUrl;
            }
        }

        // ── 🔬 OUVERTURE DES SOURCES (une par clip) ─────────────────────────────
        // On ouvre le média et on laisse l'élément EN PAUSE. Aucune lecture : la
        // frame est extraite par seek exact au moment où on en a besoin.
        const clipKey = clip => String(clip.id ?? `${clip.trackId}:${clip.startTime}:${clip.sourceStart || 0}`);
        if (typeof window.CTFCreateFrameSource !== 'function') {
            throw new Error('Module frame-source.js non chargé — extraction vidéo impossible.');
        }
        for (const clip of videoClips) {
            if (clip.type !== 'video') continue;
            try {
                frameSources.set(clipKey(clip), await window.CTFCreateFrameSource(clip.url, fps));
            } catch (e) {
                // Une source illisible ne doit pas faire échouer tout l'export : elle
                // sera simplement absente (l'anti-flash garde la dernière bonne frame).
                console.warn(`⚠️ Source illisible, clip ignoré : ${clip.name || clip.url} — ${e.message}`);
            }
        }
        console.log(`🔬 ${frameSources.size} source(s) vidéo ouverte(s) en mode frame-exact`);

        // Preload images
        const imageElements = new Map();
        for (const clip of videoClips) {
            if (clip.type === 'image' && !imageElements.has(clip.url)) {
                const img = new Image();
                img.src = clip.url;
                await new Promise((resolve) => {
                    img.onload = resolve;
                    img.onerror = resolve;
                });
                imageElements.set(clip.url, img);
            }
        }

        updateProgress(20);
        updateStatus('Encoding audio...');

        // ── AUDIO ENCODING (AAC via WebCodecs AudioEncoder) ───────────────────
        // Decoded/encoded BEFORE the (potentially long) video loop below: an audio
        // failure must never discard video work that hasn't been rendered yet.
        // Any failure here degrades gracefully to a silent MP4 instead of throwing
        // and losing the whole export.
        let audioEncodedChunks = [];
        let aacDescription = null;
        let audioExportWarning = null;
        const AUDIO_SAMPLE_RATE = 48000;
        const AUDIO_CHANNELS = 2; // Stereo
        const wantsAudio = audioClips.length > 0 || videoClips.some(c => c.type === 'video' && !c.audioMuted && !c.audioUnlinked);

        if (wantsAudio && typeof AudioEncoder !== 'undefined') {
            let audioEncoder = null;
            try {
                // 1. Decode all audio clips into one Float32Array mixdown
                const totalSamples = Math.ceil(timelineEnd * AUDIO_SAMPLE_RATE);
                const mixBuffer = new Float32Array(AUDIO_CHANNELS * totalSamples);

                // ── Construire la liste de TOUS les clips audio (purs + audio des vidéos) ──
                const allAudioForMix = [
                    ...audioClips.map(c => ({ ...c, _isVideoAudio: false })),
                    ...videoClips.filter(c => c.type === 'video' && !c.audioMuted && !c.audioUnlinked)
                        .map(c => ({ ...c, _isVideoAudio: true }))
                ];

                const decodeCtx = app._getDecodeAudioContext();
                if (decodeCtx) {
                    for (const clip of allAudioForMix) {
                        try {
                            // ── Récupérer les données audio (fetch URL ou File API) ──
                            let arrayBuf;
                            if (clip.file && clip.file instanceof Blob) {
                                arrayBuf = await clip.file.arrayBuffer();
                            } else if (clip.url) {
                                const response = await fetch(clip.url);
                                arrayBuf = await response.arrayBuffer();
                            } else {
                                console.warn(`⚠️ Audio skip: no file/url for ${clip.name}`);
                                continue;
                            }
                            const audioBuf = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
                            if (!audioBuf || audioBuf.duration === 0) continue;
                            const srcSR = audioBuf.sampleRate;
                            const srcCh = audioBuf.numberOfChannels;
                            // 🔬 Les canaux sont extraits UNE FOIS. `getChannelData()` était
                            // appelé à chaque échantillon et pour chaque canal (≈ 2,5 millions
                            // d'appels pour 13 s de mix) : la méthode refait une recherche dans
                            // la liste des canaux à chaque appel. Le résultat est identique, le
                            // mixage va simplement beaucoup plus vite sur un long montage.
                            const srcChans = [];
                            for (let c = 0; c < srcCh; c++) srcChans.push(audioBuf.getChannelData(c));
                            const clipStartSample = Math.round(clip.startTime * AUDIO_SAMPLE_RATE);
                            const clipSrcStart = Math.round((clip.sourceStart || 0) * srcSR);
                            const clipLenSamples = Math.round(clip.duration * AUDIO_SAMPLE_RATE);

                            // Track volume (0..200, 100 = normal)
                            const track = app.tracks.find(t => t.id === clip.trackId);
                            const trackVol = track ? (track.volume !== undefined ? track.volume : 100) / 100 : 1;
                            const gain = Math.max(0, trackVol);

                            // Fade in/out
                            const fi = clip.fadeIn || 0;
                            const fo = clip.fadeOut || 0;

                            for (let s = 0; s < clipLenSamples; s++) {
                                const outIdx = clipStartSample + s;
                                if (outIdx < 0 || outIdx >= totalSamples) continue;

                                // 🎧 RÉÉCHANTILLONNAGE PAR INTERPOLATION LINÉAIRE (2026-09-17)
                                // Avant : `Math.round(s * srcSR / AUDIO_SAMPLE_RATE)` = plus
                                // proche voisin → souffle et repliement audibles sur les sources
                                // 44,1 kHz converties en 48 kHz (le cas le plus courant : vidéo
                                // de téléphone ou musique MP3/AAC). Le moteur MP3 faisait déjà
                                // l'interpolation linéaire : les moteurs vidéo étaient donc
                                // INCOHÉRENTS entre eux, et une même source ne sonnait pas pareil
                                // en MP4 et en MP3. Formule désormais identique à mp3-export.js.
                                const srcPosF = s * srcSR / AUDIO_SAMPLE_RATE;
                                const i0 = Math.floor(srcPosF);
                                const frac = srcPosF - i0;

                                // Fade envelope
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
                            console.log(`🔊 Mixed audio: ${clip.name} (${clip.duration.toFixed(1)}s)${clip._isVideoAudio ? ' [from video]' : ''}`);
                        } catch (e) {
                            console.warn('Audio decode failed for clip:', clip.name, e);
                        }
                    }

                    // Normalize to prevent clipping
                    // 🎚️ MÊME SEUIL QUE mp3-export.js (0,99) : un même montage doit sortir
                    // au même niveau en MP4, WebM et MP3. Les moteurs vidéo atténuaient à
                    // 0,95 alors que le MP3 atténuait à 0,99 — soit 0,36 dB d'écart entre
                    // deux exports du même projet.
                    let peak = 0;
                    for (let i = 0; i < mixBuffer.length; i++) {
                        const a = mixBuffer[i] < 0 ? -mixBuffer[i] : mixBuffer[i];
                        if (a > peak) peak = a;
                    }
                    if (peak > 0.99) {
                        const norm = 0.99 / peak;
                        for (let i = 0; i < mixBuffer.length; i++) mixBuffer[i] *= norm;
                    }

                    // 2. Encode PCM → AAC via AudioEncoder
                    audioEncoder = new AudioEncoder({
                        output: (chunk, metadata) => {
                            const chunkData = new Uint8Array(chunk.byteLength);
                            chunk.copyTo(chunkData);
                            audioEncodedChunks.push({
                                type: chunk.type,
                                timestamp: chunk.timestamp,
                                duration: chunk.duration,
                                data: chunkData
                            });
                            if (!aacDescription && metadata?.decoderConfig?.description) {
                                const rawDesc = metadata.decoderConfig.description;
                                aacDescription = rawDesc instanceof ArrayBuffer ? rawDesc : new Uint8Array(rawDesc).buffer;
                            }
                        },
                        error: (e) => {
                            console.error('❌ AudioEncoder error:', e);
                        }
                    });

                    const aacConfig = {
                        codec: 'mp4a.40.2', // AAC-LC
                        numberOfChannels: AUDIO_CHANNELS,
                        sampleRate: AUDIO_SAMPLE_RATE,
                        bitrate: 192000 // 192 kbps — good quality for stereo
                    };

                    const aacSupported = await AudioEncoder.isConfigSupported(aacConfig);
                    if (aacSupported && aacSupported.supported) {
                        audioEncoder.configure(aacConfig);
                        console.log('✅ AudioEncoder configured: AAC-LC 48kHz stereo 192kbps');

                        // Feed PCM frames (1024 samples per frame = ~21.3ms @ 48kHz)
                        const AAC_FRAME_SIZE = 1024;
                        let audioFrameIdx = 0;
                        while (audioFrameIdx * AAC_FRAME_SIZE < totalSamples) {
                            const offset = audioFrameIdx * AAC_FRAME_SIZE;
                            const frameLen = Math.min(AAC_FRAME_SIZE, totalSamples - offset);

                            // AudioData requires one contiguous BufferSource. For
                            // f32-planar, channel planes are laid out consecutively.
                            const planar = new Float32Array(AUDIO_CHANNELS * AAC_FRAME_SIZE);
                            for (let ch = 0; ch < AUDIO_CHANNELS; ch++) {
                                for (let s = 0; s < frameLen; s++) {
                                    planar[ch * AAC_FRAME_SIZE + s] = mixBuffer[(offset + s) * AUDIO_CHANNELS + ch];
                                }
                            }

                            const audioData = new AudioData({
                                format: 'f32-planar',
                                sampleRate: AUDIO_SAMPLE_RATE,
                                numberOfFrames: AAC_FRAME_SIZE,
                                numberOfChannels: AUDIO_CHANNELS,
                                timestamp: Math.round(offset / AUDIO_SAMPLE_RATE * 1_000_000),
                                data: planar.buffer
                            });
                            audioEncoder.encode(audioData);
                            audioData.close();
                            audioFrameIdx++;

                            // Backpressure
                            if (audioEncoder.encodeQueueSize > 8) {
                                while (audioEncoder.encodeQueueSize > 4) {
                                    await new Promise(r => setTimeout(r, 0));
                                }
                            }
                        }
                        await audioEncoder.flush();
                        console.log(`✅ Encoded ${audioEncodedChunks.length} audio chunks (AAC)`);
                    } else {
                        throw new Error('AAC-LC indisponible sur ce navigateur.');
                    }
                }
            } catch (e) {
                // Never let an audio failure discard the video: fall back to a
                // silent MP4 and surface a warning instead of throwing.
                console.error('❌ Audio encoding failed — exporting video without sound:', e);
                audioExportWarning = 'Le son n\'a pas pu être encodé (' + (e?.message || e) + ') — export vidéo sans audio.';
                audioEncodedChunks = [];
                aacDescription = null;
            } finally {
                try { if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close(); } catch (_) {}
            }
        } else if (wantsAudio) {
            audioExportWarning = 'AudioEncoder indisponible sur ce navigateur — export vidéo sans audio (essayez WebM pour conserver le son).';
            console.warn('⚠️', audioExportWarning);
        }

        updateProgress(25);
        updateStatus('Encoding frames with WebCodecs...');

        // Scratch canvas used to apply colour grading to the whole composited frame
        // (ctx.filter cannot be applied to a canvas drawing onto itself in-place).
        const gradingCanvas = document.createElement('canvas');
        gradingCanvas.width = width;
        gradingCanvas.height = height;
        const gradingCtx = gradingCanvas.getContext('2d', { alpha: false });

        // 🎚️ CUMUL FX + FADE (audit 2026-06-04): isolated FX layer. A clip with
        // effects is rendered here at FULL opacity, its FX stack is baked, then the
        // whole result is composited with the fade alpha — so fades stay clean even
        // with additive effects (invert/noise/duotone/teal-orange/vhs…) and the FX
        // no longer bleed onto other tracks or the text/block overlays.
        const fxLayerCanvas = document.createElement('canvas');
        fxLayerCanvas.width = width;
        fxLayerCanvas.height = height;
        const fxLayerCtx = fxLayerCanvas.getContext('2d', { willReadFrequently: true });

        // ── 🛡️ ANTI-FLASH: fallback frame (dernière frame valide) ──────────────
        lastValidFrameCanvas = null;
        lastValidFrameCtx = null;
        hasLastValidFrame = false;
        consecutiveBlackFrames = 0;
        if (videoClips.length > 0) {
            lastValidFrameCanvas = document.createElement('canvas');
            lastValidFrameCanvas.width = width;
            lastValidFrameCanvas.height = height;
            lastValidFrameCtx = lastValidFrameCanvas.getContext('2d', { alpha: false });
        }

        // Render and encode frames
        const totalFrames = Math.ceil(timelineEnd * fps);

        // ⏱️ Horodatage des frames : CALCULÉ, jamais accumulé.
        //    `frameIndex * (1e6/fps)` produit un flottant (33333,333… µs à 30 fps) que
        //    WebCodecs doit arrondir ; sur des milliers de frames l'erreur s'accumule.
        //    On calcule donc chaque horodatage par arrondi direct de l'index.
        const frameTimestamp = (i) => Math.round(i * 1_000_000 / fps);
        // Durée transmise = écart avec la frame suivante (vaut exactement 33333 ou
        // 33334 µs à 30 fps selon la frame : la somme reste juste).
        const frameDurationAt = (i) => frameTimestamp(i + 1) - frameTimestamp(i);

        // 🎬 AMORÇAGE (prime) — ouvre le décodeur de la source active au temps 0 pour
        // que la toute première frame ne soit pas noire. Les autres sources
        // s'amorcent à la demande (1er seek à froid) : ouvrir toutes les sources
        // d'un montage long en même temps coûterait des centaines de Mo de décodeurs.
        {
            let primer = null; let primerTime = 0;
            for (const clip of videoClips) {
                if (clip.type !== 'video') continue;
                const src = frameSources.get(clipKey(clip));
                if (src && clip.startTime <= 0.0001 && (!primer || clip.startTime < primerTime)) {
                    primer = src; primerTime = clip.startTime;
                }
            }
            if (primer) {
                updateStatus('Amorçage du décodeur…');
                await primer.prime(0);
            }
        }

        console.log(`🎬 Starting Frame-by-Frame Rendering (${totalFrames} frames)`);
                
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
            const currentTime = frameIndex / fps;
            
            // Clear canvas — reset any context state an FX/grading pass may have left
            // (globalAlpha/filter) so it never bleeds into the next frame's background.
            ctx.globalAlpha = 1;
            ctx.filter = 'none';
            ctx._lastFilter = 'none';
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, width, height);
            
            // 1. IDENTIFY ACTIVE CLIPS
            // Draw background first (highest index), foreground last (index 0 = top of UI)
            const activeClips = [];
            
            for (let ti = app.tracks.length - 1; ti >= 0; ti--) {
                const track = app.tracks[ti];
                if (track.muted || track._effectiveMute) continue;
                
                const clips = videoClips.filter(c => c.trackId === track.id);
                for (const clip of clips) {
                    if (currentTime >= clip.startTime - 0.0001 && currentTime < clip.startTime + clip.duration) {
                        activeClips.push(clip);
                    }
                }
            }

            let drewSomething = false;
            
            // 2. PREPARE & DRAW CLIPS
            for (const clip of activeClips) {
                if (clip.type === 'video') {
                    const frameSrc = frameSources.get(clipKey(clip));
                    const video = frameSrc && frameSrc.video;
                    if (frameSrc && video) {
                        const timeInClip = currentTime - clip.startTime;
                        const sourceTime = (clip.sourceStart || 0) + timeInClip;

                        // 🔬 Extraction frame-exacte : l'élément est mis EN PAUSE sur la
                        // frame voulue (seek + `seeked`), donc `drawImage` dessine
                        // exactement l'image de `sourceTime`. Voir js/frame-source.js.
                        const decoded = await frameSrc.frameAt(sourceTime);

                        if (decoded) {
                            // Aspect-ratio preserving (contain) draw — mirrors the
                            // logic used in the MediaRecorder path so video clips
                            // are never stretched.
                            const srcRatio = video.videoWidth / video.videoHeight;
                            const dstRatio = width / height;
                            let drawW, drawH;
                            if (srcRatio > dstRatio) { drawW = width;  drawH = width  / srcRatio; }
                            else                     { drawH = height; drawW = height * srcRatio; }
                            const _s  = (clip.videoScale !== undefined ? clip.videoScale : 100) / 100;
                            const _px = (clip.videoPosX  !== undefined ? clip.videoPosX  : 50)  / 100;
                            const _py = (clip.videoPosY  !== undefined ? clip.videoPosY  : 50)  / 100;
                            // 🎬 Animation preset (identity when none) — mirrors MediaRecorder export
                            const _vAnim = app._calcClipAnimation(clip, timeInClip);
                            const _vFinalScale = _s * _vAnim.sx;
                            const _vdw = drawW * _vFinalScale;
                            const _vdh = drawH * _vFinalScale;
                            const _vCx = _px * width  + (_vAnim.tx / 100) * width;
                            const _vCy = _py * height + (_vAnim.ty / 100) * height;
                            // Fade opacity
                            const _vfi = clip.fadeIn || 0, _vfo = clip.fadeOut || 0;
                            const _vel = currentTime - clip.startTime;
                            const _vrm = (clip.startTime + clip.duration) - currentTime;
                            let _vfa = 1.0;
                            if (_vfi > 0 && _vel < _vfi) _vfa = Math.min(_vfa, _vel / _vfi);
                            if (_vfo > 0 && _vrm < _vfo) _vfa = Math.min(_vfa, _vrm / _vfo);
                            _vfa *= _vAnim.alpha;
                            const _vfaC = Math.max(0, Math.min(1, _vfa));
                            if (app._getClipEffects(clip).length) {
                                fxLayerCtx.clearRect(0, 0, width, height);
                                fxLayerCtx.save();
                                fxLayerCtx.globalAlpha = 1;
                                if (_vAnim.rot !== 0) {
                                    fxLayerCtx.translate(_vCx, _vCy);
                                    fxLayerCtx.rotate(_vAnim.rot);
                                    fxLayerCtx.drawImage(video, -_vdw / 2, -_vdh / 2, _vdw, _vdh);
                                } else {
                                    fxLayerCtx.drawImage(video, _vCx - _vdw / 2, _vCy - _vdh / 2, _vdw, _vdh);
                                }
                                fxLayerCtx.restore();
                                app.applyClipEffectToCanvas(fxLayerCtx, clip, width, height, frameIndex);
                                ctx.save();
                                ctx.globalAlpha = _vfaC;
                                ctx.drawImage(fxLayerCanvas, 0, 0);
                                ctx.restore();
                                drewSomething = true;
                            } else {
                                ctx.save();
                                ctx.globalAlpha = _vfaC;
                                if (_vAnim.rot !== 0) {
                                    ctx.translate(_vCx, _vCy);
                                    ctx.rotate(_vAnim.rot);
                                    ctx.drawImage(video, -_vdw / 2, -_vdh / 2, _vdw, _vdh);
                                } else {
                                    ctx.drawImage(video, _vCx - _vdw / 2, _vCy - _vdh / 2, _vdw, _vdh);
                                }
                                ctx.restore();
                                drewSomething = true;
                            }
                        } else {
                            console.warn(`⚠️ Frame skipped for ${clip.name} (not ready)`);
                        }
                    }
                } else if (clip.type === 'image') {
                    const img = imageElements.get(clip.url);
                    if (img && img.complete && img.naturalWidth > 0) {
                        // Contain fit — preserve aspect ratio
                        const srcRatio = img.naturalWidth / img.naturalHeight;
                        const dstRatio = width / height;
                        let drawW, drawH;
                        if (srcRatio > dstRatio) { drawW = width;  drawH = width  / srcRatio; }
                        else                     { drawH = height; drawW = height * srcRatio; }
                        // Apply clip spatial transform
                        const _s  = (clip.videoScale  !== undefined ? clip.videoScale  : 100) / 100;
                        const _px = (clip.videoPosX   !== undefined ? clip.videoPosX   : 50)  / 100;
                        const _py = (clip.videoPosY   !== undefined ? clip.videoPosY   : 50)  / 100;
                        // 🎬 Animation preset (identity when none)
                        const _iAnim = app._calcClipAnimation(clip, currentTime - clip.startTime);
                        const _iFinalScale = _s * _iAnim.sx;
                        const _idw = drawW * _iFinalScale;
                        const _idh = drawH * _iFinalScale;
                        const _iCx = _px * width  + (_iAnim.tx / 100) * width;
                        const _iCy = _py * height + (_iAnim.ty / 100) * height;
                        // Fade opacity
                        const _ifi = clip.fadeIn || 0, _ifo = clip.fadeOut || 0;
                        const _iel = currentTime - clip.startTime;
                        const _irm = (clip.startTime + clip.duration) - currentTime;
                        let _ifa = 1.0;
                        if (_ifi > 0 && _iel < _ifi) _ifa = Math.min(_ifa, _iel / _ifi);
                        if (_ifo > 0 && _irm < _ifo) _ifa = Math.min(_ifa, _irm / _ifo);
                        _ifa *= _iAnim.alpha;
                        const _ifaC = Math.max(0, Math.min(1, _ifa));
                        if (app._getClipEffects(clip).length) {
                            fxLayerCtx.clearRect(0, 0, width, height);
                            fxLayerCtx.save();
                            fxLayerCtx.globalAlpha = 1;
                            if (_iAnim.rot !== 0) {
                                fxLayerCtx.translate(_iCx, _iCy);
                                fxLayerCtx.rotate(_iAnim.rot);
                                fxLayerCtx.drawImage(img, -_idw / 2, -_idh / 2, _idw, _idh);
                            } else {
                                fxLayerCtx.drawImage(img, _iCx - _idw / 2, _iCy - _idh / 2, _idw, _idh);
                            }
                            fxLayerCtx.restore();
                            app.applyClipEffectToCanvas(fxLayerCtx, clip, width, height, frameIndex);
                            ctx.save();
                            ctx.globalAlpha = _ifaC;
                            ctx.drawImage(fxLayerCanvas, 0, 0);
                            ctx.restore();
                            drewSomething = true;
                        } else {
                            ctx.save();
                            ctx.globalAlpha = _ifaC;
                            if (_iAnim.rot !== 0) {
                                ctx.translate(_iCx, _iCy);
                                ctx.rotate(_iAnim.rot);
                                ctx.drawImage(img, -_idw / 2, -_idh / 2, _idw, _idh);
                            } else {
                                ctx.drawImage(img, _iCx - _idw / 2, _iCy - _idh / 2, _idw, _idh);
                            }
                            ctx.restore();
                            drewSomething = true;
                        }
                    }
                }
            }
            
            // 3. NOTE: clip FX are now baked per-clip during the draw phase above
            //    (isolated FX layer composited with the fade alpha — see fxLayerCtx),
            //    so fades stay clean with additive effects and FX no longer bleed onto
            //    other tracks or the text/block overlays.

            // 4. TEXT & COLOUR-BLOCK OVERLAYS (sorted: background track first, foreground last)
            const activeOverlays = [];
            textClips.forEach(clip => {
                if (currentTime >= clip.startTime - 0.0001 && currentTime < clip.startTime + clip.duration) {
                    activeOverlays.push({ type: 'text', clip });
                }
            });
            blockClips.forEach(clip => {
                if (currentTime >= clip.startTime - 0.0001 && currentTime < clip.startTime + clip.duration) {
                    activeOverlays.push({ type: 'block', clip });
                }
            });
            activeOverlays.sort((a, b) => b.clip.trackIndex - a.clip.trackIndex);
            activeOverlays.forEach(({ type, clip }) => {
                const _ovAnim = app._calcClipAnimation(clip, currentTime - clip.startTime);
                if (type === 'text') {
                    const style = clip.style || {};
                    ctx.save();
                    ctx.filter = 'none';
                    ctx.font = `${style.fontWeight || 'bold'} ${style.fontSize || '48px'} ${style.fontFamily || 'Arial'}`;
                    ctx.fillStyle = style.color || '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    // 🅣 Ombre optionnelle (OFF par défaut) — helper partagé : l'export
                    // respecte désormais la même ombre que l'aperçu.
                    app._applyTextShadow(ctx, style);
                    const baseX = (clip.posX !== undefined ? clip.posX : 50) / 100 * width;
                    const baseY = (clip.posY !== undefined ? clip.posY : 50) / 100 * height;
                    const textX = baseX + (_ovAnim.tx / 100) * width;
                    const textY = baseY + (_ovAnim.ty / 100) * height;
                    // Fade in/out × animation alpha (matches preview overlay opacity)
                    const _txtFade = app._calcFadeOpacity ? app._calcFadeOpacity(clip, currentTime) : 1.0;
                    ctx.globalAlpha = Math.max(0, Math.min(1, _ovAnim.alpha * _txtFade));
                    if (_ovAnim.sx !== 1 || _ovAnim.rot !== 0) {
                        ctx.translate(textX, textY);
                        if (_ovAnim.rot !== 0) ctx.rotate(_ovAnim.rot);
                        if (_ovAnim.sx !== 1) ctx.scale(_ovAnim.sx, _ovAnim.sx);
                        ctx.fillText(clip.content || 'TEXT', 0, 0);
                    } else {
                        ctx.fillText(clip.content || 'TEXT', textX, textY);
                    }
                    ctx.restore();
                } else if (type === 'block') {
                    ctx.save();
                    ctx.filter = 'none';
                    const blockWidth = (width * (clip.width || 50)) / 100;
                    const blockHeight = (height * (clip.height || 50)) / 100;
                    const baseBX = (width * (clip.posX || 25)) / 100;
                    const baseBY = (height * (clip.posY || 25)) / 100;
                    const blockX = baseBX + (_ovAnim.tx / 100) * width;
                    const blockY = baseBY + (_ovAnim.ty / 100) * height;
                    ctx.fillStyle = clip.color || '#ff0000';
                    // Fade in/out × opacity × animation alpha (matches preview overlay opacity)
                    const _blkFade = app._calcFadeOpacity ? app._calcFadeOpacity(clip, currentTime) : 1.0;
                    ctx.globalAlpha = (clip.opacity ?? 1.0) * Math.max(0, Math.min(1, _ovAnim.alpha * _blkFade));
                    if (_ovAnim.sx !== 1 || _ovAnim.rot !== 0) {
                        const cx = blockX + blockWidth / 2;
                        const cy = blockY + blockHeight / 2;
                        ctx.translate(cx, cy);
                        if (_ovAnim.rot !== 0) ctx.rotate(_ovAnim.rot);
                        if (_ovAnim.sx !== 1) ctx.scale(_ovAnim.sx, _ovAnim.sx);
                        ctx.fillRect(-blockWidth / 2, -blockHeight / 2, blockWidth, blockHeight);
                    } else {
                        ctx.fillRect(blockX, blockY, blockWidth, blockHeight);
                    }
                    ctx.restore();
                }
            });

            // 5. COLOUR GRADING on the whole composited frame (only when non-neutral).
            const cg = app.colorGrading;
            if (cg && (cg.lift !== 0 || cg.gamma !== 0 || cg.gain !== 0 ||
                       cg.saturation !== 100 || cg.contrast !== 100 || cg.temp !== 0)) {
                gradingCtx.clearRect(0, 0, width, height);
                gradingCtx.drawImage(canvas, 0, 0);
                ctx.save();
                app.applyColorGradingToContext(ctx);
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(gradingCanvas, 0, 0);
                ctx.restore();
                ctx.filter = 'none';
                ctx._lastFilter = 'none';
            }

            // 5a. 🎤 Subtitle rendering (auto-generated per clip)
            const _wcSubClip = activeClips.find(c => c.subtitleEnabled && c.subtitles && c.subtitles.length);
            if (_wcSubClip) {
                const _wcSubTime = currentTime - _wcSubClip.startTime;
                const _wcSub = _wcSubClip.subtitles.find(s => _wcSubTime >= s.start && _wcSubTime < s.end);
                if (_wcSub) {
                    ctx.save();
                    ctx.filter = 'none';
                    ctx.font = `bold ${Math.round(height * 0.045)}px Arial, sans-serif`;
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.shadowColor = 'rgba(0,0,0,0.9)';
                    ctx.shadowBlur = 6;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    const _wcm = ctx.measureText(_wcSub.text);
                    const _wctw = _wcm.width;
                    const _wcth = Math.round(height * 0.05);
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(width / 2 - _wctw / 2 - 12, height * 0.88 - _wcth, _wctw + 24, _wcth + 8);
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(_wcSub.text, width / 2, height * 0.9);
                    ctx.restore();
                }
            }

            // 5b. 🎞️ Apply clip transitions (crossfade, wipe, etc.) on the composited frame.
            const _wcTopClip = activeClips[activeClips.length - 1];
            if (_wcTopClip && _wcTopClip.transition && _wcTopClip.transition !== 'none') {
                app._applyTransitionMask(ctx, _wcTopClip, currentTime, width, height);
            }

            // ── 🛡️ ANTI-FLASH ────────────────────────────────────────────────────
            // Depuis le passage à l'extraction frame-exacte, cette branche ne devrait
            // plus se déclencher que sur un cas réel : un trou dans la timeline, ou une
            // source momentanément indécodable. On ne laisse JAMAIS un noir apparaître
            // au milieu d'un clip : on reconduit la dernière image valide (une image
            // figée est bien moins visible qu'un flash noir), et on compte les
            // occurrences pour les remonter à l'utilisateur à la fin.
            if (!drewSomething && videoClips.length > 0) {
                consecutiveBlackFrames++;
                skippedFrames++;
                if (hasLastValidFrame && lastValidFrameCanvas) {
                    ctx.drawImage(lastValidFrameCanvas, 0, 0);
                    if (consecutiveBlackFrames === 10) {
                        console.warn(`⚠️ WebCodecs: 10 images sans source à ${currentTime.toFixed(2)}s — dernière image reconduite`);
                    }
                }
            } else if (drewSomething) {
                consecutiveBlackFrames = 0;
                // Sauvegarder cette frame comme fallback
                if (lastValidFrameCtx) {
                    try {
                        lastValidFrameCtx.clearRect(0, 0, width, height);
                        lastValidFrameCtx.drawImage(canvas, 0, 0);
                        hasLastValidFrame = true;
                    } catch (_) {}
                }
            }
            
            // Create VideoFrame from canvas
            if (encoderError) throw new Error('VideoEncoder failed: ' + (encoderError.message || encoderError));
            if (encoder.state !== 'configured') throw new Error('VideoEncoder state: ' + encoder.state);

            const frame = new VideoFrame(canvas, {
                timestamp: frameTimestamp(frameIndex),
                duration: frameDurationAt(frameIndex)
            });
            
            // Encode frame — keyframe once per second.
            const keyFrame = frameIndex % fps === 0;
            try {
                encoder.encode(frame, { keyFrame });
            } finally {
                frame.close(); // Toujours close() le VideoFrame
            }

            // ⏳ CONTRÔLE DE FLUX + RENDEZ LA MAIN — sans cela la file d'encodage (et le
            //    tableau de chunks en mémoire) gonflent, l'onglet se fige et la barre de
            //    progression n'avance plus pendant que flush() vide tout d'un coup.
            //
            // 🛡️ GARDE-FOU OBLIGATOIRE (constaté le 2026-09-17) : cette boucle attendait
            //    sans limite de temps. Si l'encodeur matériel se bloque (file qui ne
            //    descend plus — « Codec reclaimed due to inactivity » et autres), le
            //    `while` tournait INDÉFINIMENT : le thread principal restait libre (donc
            //    l'interface répondait encore, la barre affichait un pourcentage figé)
            //    mais l'export ne finissait JAMAIS. Un blocage silencieux est le pire des
            //    symptômes : on échoue maintenant explicitement au bout de 20 s.
            if (encoder.encodeQueueSize > 8) {
                const _bpStart = performance.now();
                while (encoder.encodeQueueSize > 4) {
                    if (performance.now() - _bpStart > 20000) {
                        throw new Error(
                            `Encodeur vidéo bloqué : ${encoder.encodeQueueSize} images en attente depuis 20 s ` +
                            `(image ${frameIndex}/${totalFrames}). Réessayez, ou désactivez l'accélération matérielle.`
                        );
                    }
                    await new Promise(r => setTimeout(r, 1));
                }
            } else if ((frameIndex & 7) === 0) {
                // Micro-pause périodique même quand la file est courte (une timeline
                // d'images ne passe jamais par un seek vidéo) : l'interface reste fluide.
                await new Promise(r => setTimeout(r, 0));
            }
            
            // Check for encoder error
            if (encoderError) {
                throw new Error('VideoEncoder failed: ' + (encoderError.message || encoderError));
            }
            
            // Update progress
            if (frameIndex % 10 === 0) {
                const percent = 20 + ((frameIndex / totalFrames) * 70);
                updateProgress(percent);
                updateStatus(`Encoding: ${frameIndex + 1}/${totalFrames} frames...`);
            }
        }

        // Flush encoder
        await encoder.flush();
        encoder.close();
        encoder = null;

        updateProgress(90);
        updateStatus('Muxing MP4...');

        console.log(`✅ Encoded ${encodedChunks.length} video chunks`);

        updateProgress(95);
        
        let videoBlob;
        let outputMimeType;
        const appFormat = app.selectedFormat || 'mp4';

        if (isH264Codec) {
            // ── H.264 → MP4 via MP4Box ─────────────────────────────────
            updateStatus('Creating MP4 file...');

            if (typeof MP4Box === 'undefined') {
                throw new Error('MP4Box.js is required for WebCodecs export but was not loaded');
            }
            if (!avcDescription) {
                throw new Error('No avcDecoderConfigRecord captured — cannot mux MP4');
            }

            outputMimeType = 'video/mp4';
            const mp4File = MP4Box.createFile();
            const TIMESCALE = 90000;
            // ⏱️ Horodatage CALCULÉ par arrondi direct (et non `n × ticksPerFrame`) :
            //    à 29,97 / 59,94 fps l'écart entier n'est pas constant, et une valeur
            //    unique répétée dérive de plusieurs dizaines de ms sur un long montage.
            const ticksAt = (n) => Math.round(n * TIMESCALE / fps);
            const videoTrackId = mp4File.addTrack({
                timescale: TIMESCALE,
                width: width,
                height: height,
                nb_samples: encodedChunks.length,
                codec: config.codec,
                avcDecoderConfigRecord: avcDescription
            });

            encodedChunks.forEach((chunk, sampleNumber) => {
                const buffer = new ArrayBuffer(chunk.data.byteLength);
                new Uint8Array(buffer).set(chunk.data);
                buffer.fileStart = 0;
                const t0 = ticksAt(sampleNumber);
                mp4File.addSample(videoTrackId, buffer, {
                    duration: Math.max(1, ticksAt(sampleNumber + 1) - t0),
                    is_sync: chunk.type === 'key',
                    cts: t0,
                    dts: t0
                });
            });

            // ── Mux audio track if we have AAC data ─────────────────────
            let hasAudio = false;
            if (audioEncodedChunks.length > 0 && aacDescription) {
                const AUDIO_TIMESCALE = AUDIO_SAMPLE_RATE;
                // 🐛 CORRECTIF (2026-09-10) — la piste audio était INDÉCODABLE
                // (`ffprobe` la voyait en `unknown,video`). Détail des 3 causes et de
                // la boîte `esds` construite à la main : voir `createEsdsBox()` en
                // tête de fichier. Résumé des paramètres corrects :
                //   • `type: 'mp4a'`   → FourCC du sample entry (PAS le handler 'audio',
                //                        qui faisait retomber MP4Box sur l'entrée VISUELLE)
                //   • `hdlr: 'soun'`   → handler réel de la piste (défaut MP4Box = 'vide')
                //   • `samplerate: Hz` → clé attendue par MP4Box (et non `sample_rate`)
                //   • `description`    → une vraie boîte `esds`, pas l'ArrayBuffer brut
                const audioTrackId = mp4File.addTrack({
                    timescale: AUDIO_TIMESCALE,
                    type: 'mp4a',
                    hdlr: 'soun',
                    nb_samples: audioEncodedChunks.length,
                    codec: 'mp4a.40.2',
                    channel_count: AUDIO_CHANNELS,
                    samplerate: AUDIO_SAMPLE_RATE,
                    samplesize: 16,
                    description: createEsdsBox(aacDescription, { bitrate: 192000 })
                });
                audioEncodedChunks.forEach((chunk, i) => {
                    const buffer = new ArrayBuffer(chunk.data.byteLength);
                    new Uint8Array(buffer).set(chunk.data);
                    buffer.fileStart = 0;
                    mp4File.addSample(audioTrackId, buffer, {
                        duration: Math.max(1, Math.round((chunk.duration || (1024 * 1_000_000 / AUDIO_SAMPLE_RATE)) * AUDIO_TIMESCALE / 1_000_000)),
                        is_sync: true,
                        cts: Math.round((chunk.timestamp ?? (i * 1024 * 1_000_000 / AUDIO_SAMPLE_RATE)) * AUDIO_TIMESCALE / 1_000_000),
                        dts: Math.round((chunk.timestamp ?? (i * 1024 * 1_000_000 / AUDIO_SAMPLE_RATE)) * AUDIO_TIMESCALE / 1_000_000)
                    });
                });
                hasAudio = true;
                console.log(`🔊 Audio track muxed: ${audioEncodedChunks.length} AAC frames`);
            }

            const arrayBuffer = mp4File.getBuffer();
            videoBlob = new Blob([arrayBuffer], { type: outputMimeType });
            if (videoBlob.size < 1024) throw new Error(`MP4 vide ou incomplet (${videoBlob.size} octets)`);
            console.log(`✅ MP4 muxed (${hasAudio ? 'video + audio' : 'video only'}) — timescale=${TIMESCALE}, ${TIMESCALE}/${fps} ticks/frame`);
        }

        updateProgress(100);
        updateStatus(audioExportWarning ? 'Export terminé (sans audio)' : 'Export complete!');

        // Store export
        app.exportedVideoBlob = videoBlob;
        app.exportedVideoUrl = URL.createObjectURL(videoBlob);
        app.exportedMimeType = outputMimeType;
        
        await app.sleep(500);

        // Close modal and show preview
        app.closeExportModal();
        app.showExportPreview(width, height, fps, 'mp4', videoBlob.size);
        // Surface audio degradation after the preview opens — the export itself
        // succeeded, so this must never look like a failure.
        if (audioExportWarning) app.showStatus('⚠️ ' + audioExportWarning);

        // 📊 Contrôle de qualité de l'export : combien d'images ont été reconduites
        //    faute de source décodable ? 0 = l'export est exactement la timeline.
        const _srcStats = [...frameSources.values()].reduce((acc, s) => {
            acc.seeks += s.stats.seeks; acc.failures += s.stats.failures;
            acc.late += s.stats.lateFrames; acc.timeouts += s.stats.timeouts;
            acc.errSum += s.stats.errSum; acc.errMax = Math.max(acc.errMax, s.stats.errMax);
            acc.samples += s.stats.samples;
            acc.duplicates += s.stats.duplicates; acc.skips += s.stats.skips;
            return acc;
        }, { seeks: 0, failures: 0, late: 0, timeouts: 0, errSum: 0, errMax: 0, samples: 0, duplicates: 0, skips: 0 });
        const _errAvgMs = _srcStats.samples ? (_srcStats.errSum / _srcStats.samples * 1000) : 0;
        console.log(`📊 Extraction : ${_srcStats.seeks} seeks · ${skippedFrames} image(s) reconduite(s) · cadence : ${_srcStats.duplicates} duplication(s), ${_srcStats.skips} saut(s) · erreur d'image moyenne ${_errAvgMs.toFixed(1)} ms / max ${(_srcStats.errMax * 1000).toFixed(1)} ms · ${_srcStats.failures} échec(s)`);
        if (skippedFrames > 0) {
            app.showStatus('⚠️ ' + skippedFrames + ' image(s) n\'ont pas pu être extraites et ont été remplacées par l\'image précédente.', 'warning', 9000);
        }

        console.log('%c✅ WEBCODECS EXPORT COMPLETE', 'color: #0f0; font-size: 14px; font-weight: bold');
        console.log(`📦 Size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
        console.error('❌ WebCodecs export failed:', error);
        const errMsg = error ? (error.message || String(error)) : 'Unknown error';
        updateStatus('Export failed: ' + errMsg);
        app.showStatus('❌ Export failed: ' + errMsg);
        
        // Re-throw REAL errors; drop the synthetic “H.264 absent” sentinel
        // so handleExport() can cascade to Canvas.
        if (error.message !== 'MP4_H264_UNSUPPORTED') throw error;
    } finally {
        try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (_) {}
        try { canvas?.remove(); } catch (_) {}
        try { if (lastValidFrameCanvas?.parentNode) lastValidFrameCanvas.remove(); } catch (_) {}
        for (const frameSrc of frameSources.values()) {
            try { frameSrc.release(); } catch (_) {}
        }
        app.isExporting = false;
        document.getElementById('startExportBtn').disabled = false;
    }
}
