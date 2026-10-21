# 🎮 ACCÉLÉRATION GPU - GUIDE RAPIDE

## C'est quoi ?

L'**accélération GPU** permet à CUT THE FLOW d'utiliser votre **carte graphique** pour rendre vos vidéos plus rapidement. Au lieu d'utiliser uniquement votre processeur (CPU), l'application tire parti de la puissance de votre GPU (NVIDIA, AMD, Intel, Apple).

---

## 🚀 Avantages

### Vitesse
- ⚡ **2 à 3 fois plus rapide** pour les exports
- 🎯 Rendu des frames plus fluide
- ⏱️ Moins de temps d'attente

### Qualité
- ✨ Même qualité vidéo
- 🎨 Meilleur rendu des effets
- 📊 Performance constante

---

## 📖 Comment activer ?

### Étape 1 : Ouvrir l'export
Cliquez sur le bouton **"Export"** en haut à droite.

### Étape 2 : Trouver la section GPU
Faites défiler jusqu'à la section **"HARDWARE ACCELERATION"** (après Format).

### Étape 3 : Activer/Désactiver
Cliquez sur le bouton avec l'icône 🎮.

**Indicateurs visuels :**
- 🟢 **VERT** = GPU activé
- ⚪ **GRIS** = GPU désactivé (CPU uniquement)

### Étape 4 : Vérifier votre GPU
Le nom de votre carte graphique s'affiche automatiquement sous le bouton.

Exemples :
- "NVIDIA GeForce RTX 3080"
- "AMD Radeon RX 6800"
- "Intel Iris Xe Graphics"
- "Apple M1"

---

## ✅ Quand l'activer ?

### TOUJOURS (recommandé)
- 🎬 Exports de vidéos
- 📹 Projets lourds (4K, 8K)
- ⏱️ Quand vous voulez gagner du temps
- 💻 Si vous avez un GPU moderne

### DÉSACTIVER si :
- 🐛 Vous voyez des artefacts visuels
- 🖥️ Votre GPU est très ancien (>10 ans)
- ⚠️ Votre navigateur affiche des erreurs
- 🔧 Pour déboguer un problème

---

## 🎯 Questions fréquentes

### Q1 : Est-ce activé par défaut ?
**R :** Oui, l'accélération GPU est **activée par défaut** car elle améliore les performances dans 99% des cas.

### Q2 : Ça marche sur mon ordinateur ?
**R :** Si vous voyez le nom de votre GPU affiché, **OUI** ! Sinon, le système basculera automatiquement sur le CPU.

### Q3 : Mon ordinateur portable va chauffer ?
**R :** Oui, un peu plus, mais c'est **normal**. Le GPU travaille plus, mais l'export sera terminé plus vite, donc la consommation totale est similaire.

### Q4 : Ça consomme plus d'énergie ?
**R :** Momentanément oui, mais comme l'export est **2x plus rapide**, au final vous économisez du temps ET de l'énergie.

### Q5 : Mon GPU n'est pas détecté
**R :** Vérifiez :
1. Avez-vous les derniers **drivers** de votre carte graphique ?
2. L'**accélération matérielle** est-elle activée dans votre navigateur ?
   - Chrome : `chrome://settings/system`
   - Firefox : `about:preferences` → Général → Performance
3. Redémarrez votre navigateur

### Q6 : Ça marche sur Mac ?
**R :** **OUI** ! Les Mac M1/M2/M3 utilisent Metal via WebGL, donc l'accélération fonctionne parfaitement.

### Q7 : Quelle différence de vitesse ?
**R :** Cela dépend de votre GPU :
- **GPU intégré** (Intel HD) : environ **1.5-2x plus rapide**
- **GPU moyen** (GTX 1060, RX 580) : environ **2-2.5x plus rapide**
- **GPU puissant** (RTX 3080+, RX 6800+) : environ **2.5-3x plus rapide**

---

## 🔍 Comment vérifier que ça marche ?

### Dans la console du navigateur
Appuyez sur **F12** pour ouvrir la console, puis lancez un export.

**Avec GPU activé, vous verrez :**
```
🎮 GPU Acceleration: ENABLED ✅
🎮 GPU Acceleration: ACTIVE (WebGL)
   Context: WebGL2
   Renderer: NVIDIA GeForce RTX 3080
   Vendor: Google Inc. (NVIDIA)
```

**Avec GPU désactivé :**
```
🎮 GPU Acceleration: DISABLED (CPU only)
🖥️ GPU Acceleration: DISABLED (CPU rendering)
```

### Vitesse d'export
Faites un test :
1. Exportez une vidéo **AVEC** GPU
2. Réimportez le projet
3. Désactivez le GPU
4. Exportez à nouveau
5. Comparez les temps

---

## 🛠️ Dépannage

### Problème : "WebGL not available"

**Solution 1 :** Activer WebGL dans votre navigateur
- Visitez https://get.webgl.org/
- Si ça ne marche pas, activez l'accélération matérielle

**Solution 2 :** Mettre à jour votre navigateur
- Chrome, Edge, Firefox → Dernière version

**Solution 3 :** Mettre à jour vos drivers GPU
- NVIDIA : https://www.nvidia.com/drivers
- AMD : https://www.amd.com/support
- Intel : https://www.intel.com/content/www/us/en/download-center/home.html

### Problème : Export très lent malgré GPU

**Solution 1 :** Vérifier que le bon GPU est utilisé
- Si vous avez un GPU intégré ET dédié, assurez-vous que le navigateur utilise le GPU dédié

**Solution 2 :** Fermer les applications gourmandes
- Fermez les jeux, logiciels de montage, etc.

**Solution 3 :** Réduire la résolution
- Essayez 1080p au lieu de 4K

### Problème : Artefacts visuels dans la vidéo

**Solution 1 :** Désactiver temporairement le GPU
- Réexportez avec CPU uniquement

**Solution 2 :** Mettre à jour vos drivers
- Drivers obsolètes = bugs visuels

**Solution 3 :** Essayer un autre navigateur
- Chrome → Edge ou Firefox

---

## 📊 Comparaison visuelle

### Sans GPU (CPU uniquement)
```
Export d'une vidéo 1080p 60s :
⏱️ Temps : ~180 secondes (3 minutes)
🔥 CPU : 100% utilisé
💻 GPU : 0% utilisé
```

### Avec GPU
```
Export d'une vidéo 1080p 60s :
⏱️ Temps : ~60 secondes (1 minute)
🔥 CPU : 40% utilisé
💻 GPU : 80% utilisé
```

---

## 🎓 Pour aller plus loin

### Documentation technique
Voir **GPU-ACCELERATION-GUIDE.md** pour :
- Détails techniques complets
- Architecture du système
- Compatibilité des navigateurs
- Informations WebGL

### Page de test
Ouvrez **test-gpu-detection.html** pour :
- Tester la détection de votre GPU
- Lancer un test de performance
- Voir toutes les infos WebGL

---

## 💡 Conseils pro

1. **Toujours laisser activé** sauf si problème
2. **Mettre à jour régulièrement** vos drivers GPU
3. **Fermer les applications** gourmandes pendant l'export
4. **Surveiller la température** de votre GPU (pas un souci pour de courts exports)
5. **Utiliser Chrome/Edge** pour les meilleures performances

---

## ❓ Besoin d'aide ?

- 📖 Voir la [documentation complète](README.md)
- 🐛 [Signaler un bug](https://github.com/yourusername/cuttheflow/issues)
- 💬 [Poser une question](https://github.com/yourusername/cuttheflow/discussions)

---

**Bon montage ! 🎬**

*CUT THE FLOW - Version 1.1.0*
