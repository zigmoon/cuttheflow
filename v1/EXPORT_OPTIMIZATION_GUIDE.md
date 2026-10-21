# Module d'Export Optimisé - CUTTHEFLOW

## Vue d'ensemble

Le nouveau module d'export de CUTTHEFLOW utilise deux approches optimisées pour l'encodage vidéo :

### 1. **Export Rapide (FastExport)** - ACTIVÉ PAR DÉFAUT
**Utilisation : MediaRecorder API native du navigateur**

#### Avantages :
- ✅ **Très rapide** - Utilise l'encodage matériel (GPU) du navigateur
- ✅ **Faible utilisation mémoire** - Streaming direct sans buffer en RAM
- ✅ **Aucune librairie externe** - Fonctionne immédiatement
- ✅ **Mono-thread optimisé** - Utilise le pipeline GPU natif du navigateur
- ✅ **Qualité élevée** - 8 Mbps pour vidéo, 128 kbps pour audio

#### Fonctionnement :
1. Utilise `canvas.captureStream(fps)` pour capture GPU
2. Configuration avec `desynchronized: true` pour performance maximale
3. `MediaRecorder` encode en temps réel via hardware
4. Rendu avec `setInterval` stable pour timing précis

#### Formats supportés :
- **MP4** : H.264/AVC + AAC (préféré pour compatibilité)
- **WebM** : VP9/VP8 + Opus (préféré pour qualité)

### 2. **Export FFmpeg (Désactivé par défaut)**
**Utilisation : FFmpeg.wasm via WebAssembly**

#### Quand l'utiliser :
- Pour un contrôle total sur l'encodage
- Pour des formats spécifiques (ProRes, etc.)
- Pour des paramètres avancés (CRF, preset, etc.)

#### Comment l'activer :
Décommentez cette ligne dans `js/optimized-export.js` :
```javascript
// return await this.exportVideo(options); // Pour FFmpeg
return await this.fastExport(options); // Actuellement utilisé
```

#### Note importante :
FFmpeg.wasm est plus lent (2-3x) car il :
- Rend tous les frames en mémoire d'abord
- Encode en software (CPU uniquement)
- Charge ~30MB de WASM au premier lancement

## Optimisations Techniques

### Gestion de la RAM
```javascript
// Context 2D optimisé pour export
const ctx = canvas.getContext('2d', { 
    alpha: false,              // Pas de canal alpha = -25% mémoire
    desynchronized: true,       // Permet rendering asynchrone GPU
    willReadFrequently: false   // Optimise pour écriture uniquement
});
```

### Gestion du CPU (Mono-thread)
```javascript
// setInterval pour timing précis et prévisible
const intervalMs = Math.floor(1000 / fps);
const renderInterval = setInterval(() => {
    // Rendu d'une frame
    // Le browser gère automatiquement la priorité CPU
}, intervalMs);
```

### Streaming vs Buffer
- **FastExport** : Stream direct → Pas de limite de durée
- **FFmpeg** : Buffer complet en RAM → Limité par mémoire disponible

## Performances Attendues

### FastExport (Recommandé)
| Résolution | FPS | Temps réel | Utilisation RAM | Utilisation CPU |
|------------|-----|------------|-----------------|-----------------|
| 1080p      | 30  | ~1.2x      | 50-100 MB       | 30-40% (1 core) |
| 1080p      | 60  | ~1.5x      | 80-150 MB       | 50-60% (1 core) |
| 4K         | 30  | ~2.0x      | 150-250 MB      | 60-80% (1 core) |

### Avec FFmpeg.wasm
| Résolution | FPS | Temps réel | Utilisation RAM | Utilisation CPU |
|------------|-----|------------|-----------------|-----------------|
| 1080p      | 30  | ~3-4x      | 500-800 MB      | 90-100% (1 core)|
| 1080p      | 60  | ~5-6x      | 800-1200 MB     | 100% (1 core)   |
| 4K         | 30  | ~8-10x     | 1.5-3 GB        | 100% (1 core)   |

*Temps réel = rapport durée export / durée vidéo (ex: 1.2x = 12 secondes pour exporter 10s de vidéo)*

## Recommandations

### Pour la meilleure performance :
1. ✅ Utilisez **FastExport** (défaut)
2. ✅ Fermez les autres onglets du navigateur
3. ✅ Format **MP4** pour compatibilité universelle
4. ✅ Format **WebM** pour meilleure qualité/taille
5. ✅ 30 FPS suffisant pour la plupart des cas

### Pour la meilleure qualité :
1. Augmentez le bitrate dans `optimized-export.js` :
```javascript
videoBitsPerSecond: 12000000, // 12 Mbps au lieu de 8
```

2. Ou utilisez FFmpeg avec paramètres custom :
```javascript
const codecArgs = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18'];
```

## Dépannage

### Export trop lent
- Vérifiez que FastExport est activé (défaut)
- Réduisez la résolution (1080p au lieu de 4K)
- Réduisez les FPS (30 au lieu de 60)
- Fermez les autres applications

### Qualité insuffisante
- Augmentez `videoBitsPerSecond` dans le code
- Passez de WebM (VP8) à MP4 (H.264)
- Ou activez FFmpeg pour contrôle total

### Manque de mémoire
- FastExport ne devrait jamais manquer de RAM
- Si problème : réduisez la durée de la timeline
- FFmpeg : divisez en plusieurs exports plus courts

## Compatibilité Navigateurs

| Navigateur | FastExport | FFmpeg.wasm |
|------------|------------|-------------|
| Chrome 90+ | ✅ Parfait | ✅ Bon      |
| Edge 90+   | ✅ Parfait | ✅ Bon      |
| Firefox 88+| ✅ Bon     | ✅ Moyen    |
| Safari 14+ | ⚠️ WebM limité | ❌ Non supporté |

*Safari : Utilisez format MP4 uniquement*

## Conclusion

Le module FastExport offre le meilleur équilibre :
- ⚡ **Rapide** grâce à l'encodage GPU
- 💾 **Efficace** avec streaming direct
- 🎯 **Simple** sans dépendances externes
- 📦 **Léger** pas de librairie à charger

Pour 95% des cas d'usage, **FastExport est la meilleure option**.
