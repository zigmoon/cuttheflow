# 🎬 CUT THE FLOW - Guide d'Intégration Moderne
## Solutions d'Export Vidéo Modernes

---

## 📋 Table des Matières

1. [Vue d'Ensemble](#vue-densemble)
2. [Option 1: WebCodecs API (Recommandé)](#option-1-webcodecs-api)
3. [Option 2: MediaRecorder API (Compatible)](#option-2-mediarecorder-api)
4. [Extraction Audio](#extraction-audio)
5. [Intégration dans Cut the Flow](#intégration)
6. [Dépannage](#dépannage)

---

## 🎯 Vue d'Ensemble

### Problèmes Résolus

✅ **Segmentation Audio Correcte**
- Les clips audio ne créent plus de cuts sur la timeline
- Seuls les clips vidéo/image définissent les segments
- L'audio joue en continu sans coupures

✅ **Export Précis**
- Respect parfait des cuts de la timeline
- Synchronisation audio/vidéo parfaite
- Pas de décalage temporel

✅ **Code Moderne**
- WebCodecs API (Chrome 94+)
- MediaRecorder API (fallback)
- Architecture modulaire
- Performance optimisée

---

## 🚀 Option 1: WebCodecs API (Recommandé)

### Avantages
- ⚡ Performance maximale
- 🎯 Contrôle total sur l'encodage
- 📹 Qualité optimale
- 🔧 Flexibilité complète

### Support Navigateurs
- ✅ Chrome/Edge 94+
- ✅ Safari 16.4+
- ❌ Firefox (pas encore supporté)

### Installation

```html
<!-- Ajouter dans votre HTML -->
<script src="modern-export-engine.js"></script>
```

### Utilisation

```javascript
// Créer une instance
const exporter = new ModernExportEngine();

// Vérifier le support
if (!ModernExportEngine.isSupported()) {
    console.warn('WebCodecs non supporté, utilisez SimplifiedExportEngine');
}

// Exporter
try {
    const blob = await exporter.export({
        clips: tracks.flatMap(t => t.clips.map(c => ({ ...c, trackId: t.id }))),
        tracks: tracks,
        timelineEnd: getTimelineEnd(),
        width: 1920,
        height: 1080,
        fps: 30,
        videoBitrate: 8_000_000, // 8 Mbps
        audioBitrate: 192_000,   // 192 kbps
        audioSampleRate: 48000,
        onProgress: (percent) => {
            console.log(`Export: ${percent.toFixed(1)}%`);
            updateProgressBar(percent);
        },
        onStatus: (message) => {
            console.log(`Status: ${message}`);
            showStatus(message);
        }
    });

    // Télécharger
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(url);

} catch (error) {
    console.error('Export failed:', error);
    alert(`Export échoué: ${error.message}`);
}
```

### Configuration Avancée

```javascript
const exportConfig = {
    // Résolution
    width: 1920,
    height: 1080,

    // Frame rate
    fps: 30, // 24, 30, 60

    // Bitrates
    videoBitrate: 8_000_000,  // 8 Mbps (haute qualité)
    audioBitrate: 192_000,     // 192 kbps (AAC standard)

    // Audio
    audioSampleRate: 48000,    // 48 kHz (standard pro)

    // Callbacks
    onProgress: (percent) => {
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${Math.round(percent)}%`;
    },

    onStatus: (message) => {
        statusText.textContent = message;
    }
};
```

---

## 🎥 Option 2: MediaRecorder API (Compatible)

### Avantages
- 🌐 Support navigateur large
- 🔄 Fallback fiable
- 💻 Simple à utiliser

### Support Navigateurs
- ✅ Chrome/Edge (tous)
- ✅ Firefox 29+
- ✅ Safari 14.1+

### Installation

```html
<script src="simplified-export-engine.js"></script>
```

### Utilisation

```javascript
// Créer une instance
const exporter = new SimplifiedExportEngine();

// Exporter
try {
    const blob = await exporter.exportWithMediaRecorder({
        clips: getAllClips(),
        tracks: tracks,
        timelineEnd: getTimelineEnd(),
        width: 1920,
        height: 1080,
        fps: 30,
        videoBitsPerSecond: 8_000_000,
        onProgress: (percent) => {
            updateProgress(percent);
        },
        onStatus: (message) => {
            showStatus(message);
        }
    });

    // Télécharger
    downloadBlob(blob, `export_${Date.now()}.webm`);

} catch (error) {
    console.error('Export failed:', error);
}
```

### Formats Supportés

```javascript
// Vérifier les formats supportés
const supportedTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
].filter(type => MediaRecorder.isTypeSupported(type));

console.log('Formats supportés:', supportedTypes);
```

---

## 🎵 Extraction Audio

### Fonctionnalité

Extraire la piste audio d'un clip vidéo vers une piste audio séparée.

### Installation

```html
<script src="audio-extractor.js"></script>
```

### Utilisation

#### 1. Extraction Manuelle

```javascript
// Extraire l'audio d'un clip
const result = await audioExtractor.extractAudio(clip, tracks, {
    createNewTrack: true,
    trackName: 'EXTRACTED AUDIO',
    onStatus: (msg) => console.log(msg)
});

console.log('Nouvelle piste:', result.audioTrack);
console.log('Nouveau clip:', result.audioClip);

// Rafraîchir l'UI
renderTracks();
```

#### 2. Extraction Multiple

```javascript
// Extraire de plusieurs clips
const selectedClips = getSelectedClips();
const results = await audioExtractor.extractMultiple(selectedClips, tracks);

console.log(`${results.length} pistes audio extraites`);
renderTracks();
```

#### 3. Boutons Automatiques

```javascript
// Ajouter des boutons "Extract Audio" automatiquement
audioExtractor.startAutoInjection();
// Les boutons 🎵 apparaissent au survol des clips vidéo
```

### Style des Boutons

```css
/* Personnaliser les boutons d'extraction */
.extract-audio-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    font-size: 14px !important;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

.extract-audio-btn:hover {
    transform: scale(1.15) !important;
    box-shadow: 0 4px 8px rgba(0,0,0,0.5);
}
```

---

## 🔧 Intégration dans Cut the Flow

### Étape 1: Inclure les Scripts

```html
<!-- Dans index.html, avant </body> -->
<script src="modern-export-engine.js"></script>
<script src="simplified-export-engine.js"></script>
<script src="audio-extractor.js"></script>
```

### Étape 2: Remplacer executeExport()

```javascript
// Dans app.js, remplacer la fonction executeExport()

async function executeExport() {
    try {
        // Déterminer quel moteur utiliser
        const useWebCodecs = ModernExportEngine.isSupported() && 
                           !navigator.userAgent.includes('Firefox');
        
        const exporter = useWebCodecs 
            ? new ModernExportEngine()
            : new SimplifiedExportEngine();

        console.log('[EXPORT] Using:', useWebCodecs ? 'WebCodecs' : 'MediaRecorder');

        // Préparer les clips
        const allClips = tracks.flatMap(track => 
            track.clips.map(clip => ({
                ...clip,
                trackId: track.id
            }))
        );

        // Configuration
        const config = {
            clips: allClips,
            tracks: tracks,
            timelineEnd: getTimelineEnd(),
            width: parseInt(document.getElementById('exportWidth')?.value || 1920),
            height: parseInt(document.getElementById('exportHeight')?.value || 1080),
            fps: parseInt(document.getElementById('exportFps')?.value || 30),
            onProgress: (percent) => {
                const progressBar = document.getElementById('exportProgress');
                const progressText = document.getElementById('exportProgressText');
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressText) progressText.textContent = `${Math.round(percent)}%`;
            },
            onStatus: (message) => {
                showStatus(message);
            }
        };

        // Exporter
        showStatus('Starting export...');
        
        const blob = useWebCodecs
            ? await exporter.export(config)
            : await exporter.exportWithMediaRecorder(config);

        // Télécharger
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cuttheflow_${Date.now()}.${useWebCodecs ? 'mp4' : 'webm'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('Export complete!');

    } catch (error) {
        console.error('[EXPORT] Error:', error);
        showStatus(`Export failed: ${error.message}`);
        alert(`Export échoué:\n${error.message}`);
    }
}
```

### Étape 3: Activer l'Extraction Audio

```javascript
// Au chargement de l'application
document.addEventListener('DOMContentLoaded', () => {
    // Démarrer l'injection automatique des boutons
    if (window.audioExtractor) {
        audioExtractor.startAutoInjection();
        console.log('[APP] Audio extraction buttons enabled');
    }
});
```

### Étape 4: UI d'Export (Optionnel)

```html
<!-- Ajouter dans votre HTML -->
<div id="exportPanel" style="display:none">
    <h3>Export Settings</h3>
    
    <label>
        Width: <input type="number" id="exportWidth" value="1920">
    </label>
    
    <label>
        Height: <input type="number" id="exportHeight" value="1080">
    </label>
    
    <label>
        FPS: <select id="exportFps">
            <option value="24">24</option>
            <option value="30" selected>30</option>
            <option value="60">60</option>
        </select>
    </label>
    
    <button onclick="executeExport()">Start Export</button>
    
    <div id="exportProgress" style="width:0%; height:20px; background:green"></div>
    <div id="exportProgressText">0%</div>
</div>
```

---

## 🐛 Dépannage

### "WebCodecs not supported"

**Cause:** Navigateur trop ancien ou Firefox  
**Solution:** Utiliser SimplifiedExportEngine (fallback automatique)

```javascript
if (!ModernExportEngine.isSupported()) {
    console.log('Switching to MediaRecorder fallback');
    const exporter = new SimplifiedExportEngine();
}
```

### "Export trop lent"

**Causes possibles:**
1. Résolution trop élevée → Réduire à 1280x720
2. FPS trop élevé → Passer de 60 à 30
3. Clips trop lourds → Compresser les sources

**Solutions:**
```javascript
// Configuration optimisée pour vitesse
const config = {
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 4_000_000 // 4 Mbps au lieu de 8
};
```

### "Audio décalé"

**Cause:** Problème de synchronisation  
**Solution:** Vérifier que audioSampleRate = 48000

```javascript
const config = {
    audioSampleRate: 48000, // Standard
    // Pas 44100 ou autre
};
```

### "Mémoire insuffisante"

**Cause:** Timeline trop longue  
**Solution:** Exporter par morceaux

```javascript
// Diviser l'export en plusieurs parties
async function exportInChunks(chunks = 3) {
    const duration = getTimelineEnd();
    const chunkDuration = duration / chunks;
    
    for (let i = 0; i < chunks; i++) {
        const start = i * chunkDuration;
        const end = Math.min(start + chunkDuration, duration);
        
        // Filtrer les clips pour ce chunk
        const chunkClips = allClips.filter(c => 
            c.startTime < end && (c.startTime + c.duration) > start
        );
        
        const blob = await exporter.export({
            clips: chunkClips,
            timelineEnd: end - start,
            // ... autres options
        });
        
        downloadBlob(blob, `chunk_${i + 1}.mp4`);
    }
}
```

---

## 📊 Comparaison des Solutions

| Critère | WebCodecs | MediaRecorder |
|---------|-----------|---------------|
| **Performance** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Qualité** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Support** | Chrome 94+ | Tous navigateurs |
| **Contrôle** | Maximum | Limité |
| **Complexité** | Moyenne | Faible |
| **Format** | MP4 (H.264) | WebM (VP8/VP9) |

---

## 🎓 Exemples Complets

### Exemple 1: Export Simple

```javascript
const exporter = new ModernExportEngine();

const blob = await exporter.export({
    clips: getAllClips(),
    tracks: tracks,
    timelineEnd: 60, // 60 secondes
    width: 1920,
    height: 1080,
    fps: 30
});

downloadBlob(blob, 'video.mp4');
```

### Exemple 2: Export avec Progression

```javascript
const progressBar = document.getElementById('progress');
const statusText = document.getElementById('status');

const blob = await exporter.export({
    clips: getAllClips(),
    tracks: tracks,
    timelineEnd: getTimelineEnd(),
    width: 1920,
    height: 1080,
    fps: 30,
    onProgress: (percent) => {
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = `${Math.round(percent)}%`;
    },
    onStatus: (message) => {
        statusText.textContent = message;
    }
});
```

### Exemple 3: Export HD/SD Automatique

```javascript
async function smartExport() {
    const duration = getTimelineEnd();
    const clipCount = getAllClips().length;
    
    // Choisir la résolution automatiquement
    let width, height, fps, bitrate;
    
    if (duration > 600 || clipCount > 50) {
        // Long format → SD
        width = 1280;
        height = 720;
        fps = 30;
        bitrate = 4_000_000;
        console.log('Using SD settings for long timeline');
    } else {
        // Court format → HD
        width = 1920;
        height = 1080;
        fps = 30;
        bitrate = 8_000_000;
        console.log('Using HD settings');
    }
    
    const exporter = new ModernExportEngine();
    return await exporter.export({
        clips: getAllClips(),
        tracks: tracks,
        timelineEnd: duration,
        width, height, fps,
        videoBitrate: bitrate
    });
}
```

---

## 📝 Notes Finales

### Performance

- WebCodecs est **3-5x plus rapide** que MediaRecorder
- Utiliser OffscreenCanvas si possible (Web Worker)
- Précharger les médias pour éviter les lag

### Qualité

- 1080p @ 8 Mbps = qualité YouTube
- 720p @ 4 Mbps = qualité streaming
- AAC 192 kbps = qualité audio excellente

### Compatibilité

- Toujours fournir un fallback (MediaRecorder)
- Tester sur Chrome, Firefox, Safari
- Vérifier le support avant d'utiliser WebCodecs

---

## 🆘 Support

Si vous rencontrez des problèmes:

1. Vérifier la console navigateur (F12)
2. Tester avec timeline plus courte
3. Essayer avec fallback MediaRecorder
4. Vérifier la mémoire disponible

**Console de Debug:**
```javascript
// Activer les logs détaillés
window.DEBUG_EXPORT = true;
```

---

## ✅ Checklist d'Intégration

- [ ] Scripts inclus dans HTML
- [ ] executeExport() remplacé
- [ ] Audio extractor activé
- [ ] Test export court (10s)
- [ ] Test export long (60s+)
- [ ] Test sur différents navigateurs
- [ ] Test avec audio uniquement
- [ ] Test avec vidéo uniquement
- [ ] Test avec mix audio/vidéo

---

**Dernière mise à jour:** 2024  
**Version:** 2.0  
**Auteur:** Cut the Flow Team
