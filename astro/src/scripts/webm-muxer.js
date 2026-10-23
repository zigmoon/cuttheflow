/**
 * Muxeur WebM/EBML — repris tel quel du moteur v1 (js/webm-webcodecs-export.js),
 * qui l'a validé sur des exports réels (ffprobe + ffmpeg). Zéro dépendance.
 *
 * `muxWebM({ width, height, fps, durationMs, sampleRate, channels,
 *            videoChunks, audioChunks, codecPrivate, opusHead })`
 *   videoChunks : [{ data: Uint8Array, timestamp: µs, isKey: boolean }]
 *   audioChunks : [{ data: Uint8Array, timestamp: µs }]
 *   → Blob video/webm
 */
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

export const muxWebM = (params) => WebMMuxer.mux(params);
