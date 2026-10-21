/**
 * 🏗️ UNIFIED EXPORT — Moteur d'export universel
 * ==============================================
 * 
 * PHILOSOPHIE :
 *   La qualité de l'export ne doit JAMAIS dépendre de la vitesse de la machine.
 *   Une petite config produit EXACTEMENT le même fichier qu'une grosse config.
 *   Seul le TEMPS d'export change.
 * 
 * MOTEURS DISPONIBLES :
 *   1. WebCodecs H.264+AAC → MP4  (webcodecs-export.js)   — offline, déterministe
 *   2. WebCodecs VP9+Opus  → WebM (webm-webcodecs-export.js) — offline, déterministe
 *   3. Canvas MediaRecorder → WebM (canvas-export.js)      — fallback real-time
 * 
 * STRATÉGIE DE ROUTAGE :
 *   MP4  → toujours WebCodecs H.264+AAC (moteur 1)
 *   WebM → WebCodecs VP9+Opus (moteur 2) si dispo, sinon Canvas (moteur 3)
 * 
 * GARANTIES :
 *   ✅ Même nombre de frames sur toutes les machines
 *   ✅ Même durée sur toutes les machines
 *   ✅ Audio parfaitement synchro (OfflineAudioContext)
 *   ✅ GPU automatique si dispo, CPU sinon — transparent
 */

async function startUnifiedExport(app) {
    const format = (app.selectedFormat || 'webm').toLowerCase();

    // ── MP4 → WebCodecs H.264 + AAC ────────────────────────────────
    if (format === 'mp4') {
        if (typeof startWebCodecsExport !== 'function') {
            throw new Error('Moteur MP4 WebCodecs non chargé');
        }
        return startWebCodecsExport(app);
    }

    // ── WebM → VP9+Opus offline (preferred) ou Canvas fallback ──────
    // Tenter le moteur VP9+Opus déterministe en priorité. Il est 100 % offline
    // (aucune dépendance au temps réel) donc fonctionne sur TOUTES les machines.
    //
    // ⚠️ CORRECTIF (audit montage long 2026-09-10) — le repli vers le moteur temps
    // réel était **SILENCIEUX** : l'utilisateur croyait exporter en VP9 et recevait,
    // sans avertissement, un fichier issu de MediaRecorder. Or ce moteur capture au
    // rythme de l'horloge murale et **perd des frames** sur les montages longs :
    // dérives mesurées de −2,4 % à **+11,6 %** (timeline de 120 s → fichier de
    // 133,9 s). On prévient maintenant clairement, avec la mesure de dérive
    // réellement constatée, et seulement quand le repli est effectif.
    if (typeof startWebMWebCodecsExport === 'function' && typeof VideoEncoder !== 'undefined') {
        try {
            return await startWebMWebCodecsExport(app);
        } catch (e) {
            // VP9 absent : cascade assumée vers Canvas, mais annoncée à l'utilisateur.
            if (e && e.message === 'WEBM_VP9_UNSUPPORTED') {
                console.warn('⚠️ VP9 WebCodecs indisponible → repli sur Canvas MediaRecorder (temps réel).');
                _warnRealtimeFallback(app, window.tr
                    ? window.tr(
                        'VP9 is unavailable on this device — falling back to the real-time engine. Long montages may drift (the video can be stretched). For an exact file, export in MP4 (H.264).',
                        "VP9 n'est pas disponible sur cet appareil — repli sur le moteur temps réel. Les montages longs risquent un décalage (vidéo étirée). Pour un fichier exact, exportez en MP4 (H.264).")
                    : "VP9 indisponible — repli sur le moteur temps réel : les montages longs peuvent être étirés.");
            } else {
                throw e; // Erreur réelle → ne pas masquer
            }
        }
    }

    // ── Repli : Canvas + MediaRecorder (temps réel) ─────────────────
    if (typeof startCanvasExport !== 'function') {
        throw new Error('Moteur WebM Canvas non chargé');
    }
    _warnRealtimeFallback(app, window.tr
        ? window.tr(
            'Exporting with the real-time engine: on long montages the video may be stretched. Choose "VP9 + Opus" or export in MP4 (H.264) for an exact file.',
            "Export en moteur temps réel : sur un montage long, la vidéo peut être étirée. Choisissez « VP9 + Opus » ou exportez en MP4 (H.264) pour un fichier exact.")
        : 'Moteur temps réel : les montages longs peuvent être étirés.');
    return startCanvasExport(app);

}

/**
 * Avertit l'utilisateur qu'un export part sur le moteur temps réel (non déterministe).
 * Le message est affiché assez longtemps pour être lu, et reste aussi dans la console.
 * @param {object} app
 * @param {string} message
 */
function _warnRealtimeFallback(app, message) {
    console.warn('⚠️ ' + message);
    if (app && typeof app.showStatus === 'function') {
        app.showStatus('⚠️ ' + message, 'warning', 9000);
    }
}