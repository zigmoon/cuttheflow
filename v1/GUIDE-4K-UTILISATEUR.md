# 🎬 CUT THE FLOW - Guide vidéos 4K/haute résolution

## ⚡ Problème résolu !

Vous pouvez maintenant éditer et exporter des vidéos **4K et haute résolution** sans problème de performance, même sur une machine moyenne.

---

## 🚀 Comment ça marche ?

### Import automatique

1. **Glissez-déposez** votre vidéo 4K dans CUT THE FLOW
2. Le système **détecte automatiquement** la haute résolution
3. Un **proxy 1080p** est généré en arrière-plan (quelques secondes)
4. Vous voyez le message: "✅ Proxy ready for [votre-video].mp4"

### Édition fluide

- **L'édition** utilise le proxy 1080p (léger et rapide)
- **La timeline** est fluide même avec plusieurs clips 4K
- **La preview** fonctionne en temps réel
- **Aucun lag** pendant le montage

### Export haute qualité

- **L'export** utilise automatiquement vos vidéos **originales 4K**
- Pas de perte de qualité
- Export stable sans crash
- Toutes les frames sont garanties

---

## 💡 Indicateurs visuels

### Messages dans la console
```
⚠️ 4K+ VIDEO DETECTED: video.mp4 (3840x2160)
Generating proxy for smooth editing...
✅ Proxy ready for video.mp4
```

### Dans la bibliothèque média
- Les vidéos avec proxy montrent leur résolution proxy
- Un indicateur "(proxy)" apparaît lors de l'ajout à la timeline

---

## 📊 Performance attendue

### Avant (sans les améliorations)
- ❌ Édition lente et saccadée
- ❌ Preview qui lag
- ❌ Export qui crash ou perd des frames
- ❌ Utilisation mémoire excessive

### Après (avec les améliorations)
- ✅ Édition fluide à 60 FPS
- ✅ Preview instantanée
- ✅ Export stable et complet
- ✅ Mémoire optimisée
- ✅ **Export final en qualité 4K originale**

---

## ⚙️ Recommandations

### Pour les machines moyennes (8GB RAM)
- ✅ Vidéos 4K: Utilisez le proxy automatique (activé par défaut)
- ✅ Export: Choisissez 1080p ou 4K selon vos besoins
- ⚠️ Fermez les autres applications pendant l'export 4K

### Pour les machines puissantes (16GB+ RAM)
- ✅ Tout fonctionne sans limitation
- ✅ Export 4K à 60 FPS possible
- ✅ Plusieurs clips 4K simultanés

### Pour les machines faibles (4GB RAM)
- ⚠️ Export en 1080p recommandé
- ⚠️ Limitez le nombre de clips simultanés
- ⚠️ Utilisez des vidéos plus courtes

---

## 🎯 Résolution d'export

Le système recommande automatiquement une résolution basée sur votre machine:

| Type de machine | Export recommandé | Export max |
|----------------|------------------|------------|
| Puissante (16GB+) | 4K (3840x2160) | 4K @ 60fps |
| Moyenne (8GB) | 1080p (1920x1080) | 4K @ 30fps |
| Faible (4GB) | 720p (1280x720) | 1080p @ 30fps |

---

## ❓ FAQ

### Le proxy se génère automatiquement ?
**Oui**, dès l'import d'une vidéo 4K ou 2K.

### Je perds de la qualité ?
**Non**, l'édition utilise le proxy mais l'**export utilise l'original 4K**.

### Combien de temps prend la génération du proxy ?
**Quelques secondes** pour une vidéo de 30s-1min.

### Puis-je désactiver le proxy ?
Le proxy améliore grandement les performances. Mais techniquement, vous pourriez modifier le code pour désactiver la détection automatique.

### L'export est lent
C'est normal pour la 4K. Tips:
- Fermez les autres applications
- Exportez en 1080p si vous n'avez pas besoin de 4K
- Réduisez les FPS à 24 ou 30

### J'ai des frames noires
Le système détecte maintenant les frames noires et vous alerte. Vérifiez:
- Que vos clips couvrent toute la timeline
- Qu'aucune piste n'est mutée par erreur
- Les logs dans la console pour plus d'infos

### L'export échoue avec "Memory error"
- Réduisez la résolution d'export
- Exportez par segments plus courts
- Fermez toutes les autres applications
- Le système devrait vous alerter avant l'export

---

## 🔍 Diagnostic

### Voir les informations système
Ouvrez la **console développeur** (F12) et tapez:
```javascript
console.log(window.exportSafeguards.systemInfo);
```

Vous verrez:
```javascript
{
  memory: 8,              // GB RAM disponible
  cores: 8,               // Nombre de coeurs CPU
  performanceLevel: 'medium'  // low, medium, ou high
}
```

### Tester un export
Avant d'exporter, le système affiche un rapport:
```javascript
🛡️ Export Safeguards Report: {
  viable: true,
  warnings: [...],
  optimalFPS: 30
}
```

---

## 🎓 Astuces pro

### Optimiser l'édition
1. **Importez d'abord** toutes vos vidéos
2. **Attendez** que tous les proxies soient générés
3. **Ensuite** commencez l'édition (plus fluide)

### Optimiser l'export
1. **Fermez** toutes les autres applications
2. **Choisissez** la résolution adaptée à votre machine
3. **Réduisez** le FPS si nécessaire (24-30 fps suffit souvent)
4. **Utilisez** WebM pour des exports plus rapides

### Économiser de la mémoire
- Supprimez les clips inutilisés de la timeline
- Nettoyez la bibliothèque média régulièrement
- Exportez par segments pour les très longues vidéos

---

## 📝 Changelog

### Version 1.0 (Janvier 2025)
- ✅ Détection automatique vidéos 4K/2K
- ✅ Génération automatique de proxies
- ✅ Export utilise l'original (qualité max)
- ✅ Garde-fous mémoire et performance
- ✅ Tracking complet des frames (aucune perte)
- ✅ Gestion d'erreurs améliorée
- ✅ Nettoyage mémoire automatique

---

## 🆘 Support

### Problème persistent ?
1. Ouvrez la **console développeur** (F12)
2. **Copiez** tous les messages d'erreur
3. **Notez** votre configuration (RAM, CPU, vidéo utilisée)
4. **Contactez** le support avec ces informations

### Rapporter un bug
Incluez:
- Message d'erreur exact
- Configuration système
- Résolution et durée de la vidéo
- Steps pour reproduire le problème

---

**Version**: 1.0  
**Dernière mise à jour**: Janvier 2025  
**Testé avec**: Chrome 120+, Edge 120+
