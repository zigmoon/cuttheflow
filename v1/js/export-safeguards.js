/**
 * 🛡️ EXPORT SAFEGUARDS - Protection contre les problèmes de performance
 * ======================================================================
 * Système de garde-fous pour garantir des exports réussis même avec des vidéos 4K
 * sur des machines moyennes.
 */

class ExportSafeguards {
    constructor() {
        this.systemInfo = this.detectSystemCapabilities();
        console.log('🛡️ Export Safeguards initialized', this.systemInfo);
    }

    /**
     * Détecte les capacités du système
     */
    detectSystemCapabilities() {
        const info = {
            // Mémoire disponible (si accessible)
            memory: navigator.deviceMemory || 4, // GB (default 4 if not available)
            
            // Nombre de coeurs CPU
            cores: navigator.hardwareConcurrency || 4,
            
            // Type de connexion (pour proxy en ligne)
            connection: navigator.connection?.effectiveType || 'unknown',
            
            // Performance estimée (low, medium, high)
            performanceLevel: 'medium'
        };
        
        // Déterminer le niveau de performance
        if (info.memory >= 8 && info.cores >= 8) {
            info.performanceLevel = 'high';
        } else if (info.memory <= 4 || info.cores <= 2) {
            info.performanceLevel = 'low';
        }
        
        return info;
    }

    /**
     * Vérifie si l'export est viable avec les paramètres donnés
     * 🛡️ MODE STRICT pour garantir des exports parfaits
     */
    validateExportFeasibility(params) {
        const warnings = [];
        const errors = [];
        
        const {
            width,
            height,
            fps,
            duration,
            videoClips,
            format
        } = params;
        
        console.log('%c🛡️ VALIDATION STRICTE - Export Feasibility Check', 'color: #0ff; font-weight: bold; font-size: 14px;');
        
        // 1. Vérifier la résolution totale
        const pixelCount = width * height;
        const totalFrames = Math.ceil(duration * fps);
        const estimatedDataPerFrame = pixelCount * 4; // 4 bytes per pixel (RGBA)
        const estimatedTotalData = (estimatedDataPerFrame * totalFrames) / (1024 * 1024 * 1024); // GB
        
        console.log(`📊 Export Analysis:
  Resolution: ${width}x${height} (${(pixelCount / 1000000).toFixed(1)}MP)
  Duration: ${duration.toFixed(2)}s @ ${fps}fps = ${totalFrames} frames
  Estimated data: ${estimatedTotalData.toFixed(2)} GB
  Performance level: ${this.systemInfo.performanceLevel}`);
        
        // 2. Limites de résolution basées sur les capacités système (MODE STRICT)
        const maxPixels = this.getMaxRecommendedPixels();
        const recommendedPixels = this.getRecommendedPixels();
        
        if (pixelCount > maxPixels * 1.5) {
            // WAY TOO HIGH - bloquer STRICTEMENT sur petites machines
            if (this.systemInfo.performanceLevel === 'low') {
                errors.push({
                    type: 'resolution',
                    message: `🚫 EXPORT BLOQUÉ: Résolution ${width}x${height} TROP ÉLEVÉE pour machine LOW (${this.systemInfo.memory}GB RAM, ${this.systemInfo.cores} cores). Maximum absolu: ${this.getRecommendedResolution()}`,
                    severity: 'critical',
                    suggestion: '🚫 CRITIQUE: Export IMPOSSIBLE. Réduisez OBLIGATOIREMENT la résolution à 720p maximum pour éviter crash et perte de frames.'
                });
            } else {
                warnings.push({
                    type: 'resolution',
                    message: `Resolution ${width}x${height} significantly exceeds recommended (${this.getRecommendedResolution()})`,
                    severity: 'high',
                    suggestion: 'Export will be slow and may fail. Consider lowering resolution for stability.'
                });
            }
        } else if (pixelCount > Math.round(maxPixels * 1.02)) {
            // Au-dessus du max (+ 2% tolerance for non-standard aspect ratios) - bloquer sur LOW
            // BUG3 FIX: 2% buffer avoids false block on near-720p resolutions (e.g. 1280x721)
            if (this.systemInfo.performanceLevel === 'low') {
                errors.push({
                    type: 'resolution',
                    message: `🚫 EXPORT BLOQUÉ: Résolution ${width}x${height} dépasse le maximum pour votre machine. Maximum: ${this.getRecommendedResolution()}`,
                    severity: 'critical',
                    suggestion: '🚫 INTERDIT: Votre machine LOW performance ne peut PAS exporter au-dessus de 720p. Réduisez la résolution.'
                });
            } else {
            warnings.push({
                type: 'resolution',
                message: `Resolution ${width}x${height} may cause performance issues. Recommended max: ${this.getRecommendedResolution()}`,
                severity: 'medium',
                suggestion: 'Export will be slower. Consider using proxies for source videos or lowering export resolution.'
            });
            }
        } else if (pixelCount > recommendedPixels) {
            warnings.push({
                type: 'resolution',
                message: `Resolution ${width}x${height} is above optimal (${this.getOptimalResolution()})`,
                severity: 'low',
                suggestion: 'Export will work but may be slower than optimal.'
            });
        }
        
        // 2b. Blocage spécifique pour 4K sur machines LOW
        const is4KExport = pixelCount >= (3840 * 2160 * 0.9);
        if (is4KExport && this.systemInfo.performanceLevel === 'low') {
            errors.push({
                type: 'resolution',
                message: `🚫 EXPORT 4K INTERDIT sur machine LOW (${this.systemInfo.memory}GB RAM, ${this.systemInfo.cores} cores)`,
                severity: 'critical',
                suggestion: '🚫 BLOCAGE ABSOLU: Les exports 4K sont INTERDITS sur votre machine pour garantir la stabilité. Maximum autorisé: 720p (1280x720).'
            });
        }
        
        // 3. Vérifier les clips vidéo sources
        let hasHighResSource = false;
        let maxSourceWidth = 0;
        let maxSourceHeight = 0;
        
        videoClips.forEach(clip => {
            if (clip.width > maxSourceWidth) maxSourceWidth = clip.width;
            if (clip.height > maxSourceHeight) maxSourceHeight = clip.height;
            
            if (clip.width >= 3840 || clip.height >= 2160) {
                hasHighResSource = true;
            }
        });
        
        if (hasHighResSource) {
            warnings.push({
                type: 'source',
                message: `4K source videos detected (max: ${maxSourceWidth}x${maxSourceHeight}). This may impact export speed.`,
                severity: 'medium',
                suggestion: 'Using proxy versions during export can significantly improve performance.'
            });
        }
        
        // 4. Vérifier la durée vs FPS (MODE STRICT pour petites machines)
        const optimalFPS = this.getOptimalFPS(params);
        
        if (fps > optimalFPS && this.systemInfo.performanceLevel === 'low') {
            warnings.push({
                type: 'fps',
                message: `FPS ${fps} is too high for LOW performance system. Optimal: ${optimalFPS}`,
                severity: 'high',
                suggestion: `IMPORTANT: Reduce FPS to ${optimalFPS} to ensure stable export with all frames rendered correctly.`
            });
        } else if (fps > optimalFPS * 1.5) {
            warnings.push({
                type: 'fps',
                message: `FPS ${fps} is higher than optimal (${optimalFPS}) for your system`,
                severity: 'medium',
                suggestion: `Consider reducing to ${optimalFPS} FPS for faster exports.`
            });
        }
        
        if (duration > 300 && fps > 30) {
            warnings.push({
                type: 'duration',
                message: `Long video (${(duration / 60).toFixed(1)}min) at high FPS (${fps}) will take significant time to export.`,
                severity: 'low',
                suggestion: 'Consider lowering FPS to 24 or 30 for faster exports without noticeable quality loss.'
            });
        }
        
        // 4b. Durée totale excessive pour petites machines
        const totalFramesCount = Math.ceil(duration * fps);
        if (totalFramesCount > 10000 && this.systemInfo.performanceLevel === 'low') {
            warnings.push({
                type: 'duration',
                message: `Total frames (${totalFramesCount}) is very high for LOW performance system`,
                severity: 'high',
                suggestion: 'Consider exporting in smaller segments (e.g., 2-3 minute chunks) to avoid memory issues.'
            });
        }
        
        // 5. Vérifier la mémoire estimée
        const estimatedMemoryUsage = this.estimateMemoryUsage(params);
        const availableMemory = this.systemInfo.memory * 1024; // Convert to MB
        
        if (estimatedMemoryUsage > availableMemory * 0.8) {
            errors.push({
                type: 'memory',
                message: `Estimated memory usage (${estimatedMemoryUsage.toFixed(0)}MB) exceeds available memory (${availableMemory.toFixed(0)}MB).`,
                severity: 'critical',
                suggestion: 'Reduce export resolution or split the video into smaller segments.'
            });
        }
        
        return {
            viable: errors.length === 0,
            warnings,
            errors,
            recommendations: this.generateRecommendations(params, warnings, errors)
        };
    }

    /**
     * Estime l'utilisation mémoire pour l'export
     */
    estimateMemoryUsage(params) {
        const { width, height, fps, videoClips } = params;
        
        // Base memory for canvas buffers (2 canvases: render + preview)
        const renderCanvasMemory = (width * height * 4) / (1024 * 1024); // MB
        const previewCanvasMemory = (320 * 180 * 4) / (1024 * 1024); // MB
        
        // Memory for active video elements (estimate 3 videos active at once)
        const activeVideosMemory = videoClips.slice(0, 3).reduce((sum, clip) => {
            const videoMemory = (clip.width * clip.height * 4) / (1024 * 1024);
            return sum + videoMemory;
        }, 0);
        
        // Memory for MediaRecorder buffers (compressed, not raw pixels)
        const bufferDuration = 10; // seconds
        const estimatedBitrate = params.videoBitrate || 6000000; // default 6 Mbps
        const bufferMemory = (estimatedBitrate * bufferDuration) / 8 / (1024 * 1024); // MB
        
        // Audio memory (minimal)
        const audioMemory = 50; // MB (estimate)
        
        const totalMemory = renderCanvasMemory + previewCanvasMemory + activeVideosMemory + bufferMemory + audioMemory;
        
        console.log(`💾 Memory Estimate:
  Render canvas: ${renderCanvasMemory.toFixed(1)} MB
  Active videos: ${activeVideosMemory.toFixed(1)} MB
  Buffer: ${bufferMemory.toFixed(1)} MB
  Total: ${totalMemory.toFixed(1)} MB`);
        
        return totalMemory;
    }

    /**
     * Obtient le nombre maximum de pixels recommandé (strict)
     */
    getMaxRecommendedPixels() {
        switch (this.systemInfo.performanceLevel) {
            case 'high':
                return 3840 * 2160; // 4K
            case 'medium':
                return 1920 * 1080; // 1080p
            case 'low':
                return 1280 * 720;  // 720p (strict pour petites machines)
            default:
                return 1920 * 1080;
        }
    }
    
    /**
     * Obtient le nombre de pixels optimal (recommandé)
     */
    getRecommendedPixels() {
        switch (this.systemInfo.performanceLevel) {
            case 'high':
                return 1920 * 1080; // 1080p optimal même pour high-end
            case 'medium':
                return 1280 * 720;  // 720p optimal pour medium
            case 'low':
                return 854 * 480;   // 480p optimal pour low
            default:
                return 1280 * 720;
        }
    }

    /**
     * Obtient la résolution recommandée sous forme de string
     */
    getRecommendedResolution() {
        switch (this.systemInfo.performanceLevel) {
            case 'high':
                return '4K (3840x2160)';
            case 'medium':
                return '1080p (1920x1080)';
            case 'low':
                return '720p (1280x720)';
            default:
                return '1080p (1920x1080)';
        }
    }
    
    /**
     * Obtient la résolution optimale sous forme de string
     */
    getOptimalResolution() {
        switch (this.systemInfo.performanceLevel) {
            case 'high':
                return '1080p (1920x1080)';
            case 'medium':
                return '720p (1280x720)';
            case 'low':
                return '480p (854x480)';
            default:
                return '720p (1280x720)';
        }
    }

    /**
     * Génère des recommandations basées sur les warnings et errors
     */
    generateRecommendations(params, warnings, errors) {
        const recommendations = [];
        
        // Si critique, proposer des solutions drastiques
        if (errors.length > 0) {
            recommendations.push({
                priority: 'critical',
                action: 'Lower export resolution',
                description: `Reduce export resolution to ${this.getRecommendedResolution()} or lower`
            });
            
            recommendations.push({
                priority: 'critical',
                action: 'Split video',
                description: 'Export the video in smaller segments (e.g., 5-minute chunks)'
            });
        }
        
        // Si warnings, proposer optimisations
        if (warnings.some(w => w.type === 'source')) {
            recommendations.push({
                priority: 'high',
                action: 'Use proxy videos',
                description: 'Enable proxy mode for 4K source videos to reduce memory usage'
            });
        }
        
        if (warnings.some(w => w.type === 'duration')) {
            recommendations.push({
                priority: 'medium',
                action: 'Reduce FPS',
                description: 'Lower frame rate to 24 or 30 FPS for faster export'
            });
        }
        
        // Recommandations générales
        recommendations.push({
            priority: 'low',
            action: 'Close other applications',
            description: 'Free up system resources by closing unnecessary programs'
        });
        
        return recommendations;
    }

    /**
     * Calcule le FPS optimal pour l'export (MODE STRICT)
     * Garantit que chaque frame sera parfaite même sur petites machines
     */
    getOptimalFPS(params) {
        const { width, height, duration, videoClips } = params;
        const pixelCount = width * height;
        
        // 🛡️ MODE STRICT: Limites conservatrices pour garantir qualité parfaite
        
        // Pour 4K (3840x2160)
        if (pixelCount >= 3840 * 2160) {
            if (this.systemInfo.performanceLevel === 'low') return 24;  // 24fps strict
            if (this.systemInfo.performanceLevel === 'medium') return 24; // 24fps aussi pour medium en 4K
            return 30; // 30fps max même pour high en 4K
        }
        
        // Pour 1080p (1920x1080)
        if (pixelCount >= 1920 * 1080) {
            if (this.systemInfo.performanceLevel === 'low') return 24;  // 24fps pour garantir stabilité
            if (this.systemInfo.performanceLevel === 'medium') return 30; // 30fps pour medium
            return 60; // 60fps OK pour high
        }
        
        // Pour 720p (1280x720)
        if (pixelCount >= 1280 * 720) {
            if (this.systemInfo.performanceLevel === 'low') return 30;  // 30fps safe
            if (this.systemInfo.performanceLevel === 'medium') return 60;
            return 60;
        }
        
        // Pour 480p et moins - pas de limitation
        if (this.systemInfo.performanceLevel === 'low') return 30;
        return 60;
    }

    /**
     * Vérifie la disponibilité des codecs
     */
    checkCodecSupport() {
        const codecs = {
            mp4: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'],
            webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
            mkv: ['video/x-matroska;codecs=vp9,opus', 'video/webm;codecs=vp9,opus']
        };
        
        const support = {};
        
        for (const [format, mimeTypes] of Object.entries(codecs)) {
            support[format] = mimeTypes.find(mime => MediaRecorder.isTypeSupported(mime)) || null;
        }
        
        console.log('🎬 Codec Support:', support);
        return support;
    }

    /**
     * Génère un rapport de pré-export
     */
    generatePreExportReport(params) {
        const validation = this.validateExportFeasibility(params);
        const codecSupport = this.checkCodecSupport();
        const optimalFPS = this.getOptimalFPS(params);
        
        return {
            systemInfo: this.systemInfo,
            validation,
            codecSupport,
            optimalFPS,
            timestamp: new Date().toISOString()
        };
    }
}

// Export global instance
if (typeof window !== 'undefined') {
    window.exportSafeguards = new ExportSafeguards();
    console.log('🛡️ Export Safeguards ready!');
}
