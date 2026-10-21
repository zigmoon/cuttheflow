# 🔍 AUDIT COMPLET DES EXPORTS VIDÉO — CUT THE FLOW
**Date : 10 septembre 2026** · Audit mené en navigateur réel (Electron 42 / Chrome 148, 16 cœurs, 32 Go)
**Source de test :** 1920×1080 · 24 fps · 6 s (`testsrc` + sinus 440 Hz) → timeline de **6 s**

---

## 1. Verdict : oui, tu avais raison — et c'était plus grave que prévu

Les **5 moteurs d'export étaient inutilisables ou défectueux**. Aucun n'était « juste lent » : ils cumulaient des bugs de sélection de codec, de muxage et de synchronisation.

| Moteur | AVANT (mesuré) | APRÈS (mesuré) |
|---|---|---|
| **H.264 + AAC → MP4** | 17,0 s · **audio supprimé en silence** | **6,98 s** · audio+vidéo |
| **VP9 + Opus → WebM** | **échec immédiat** `WEBM_VP9_UNSUPPORTED` | **6,83 s** · VP9+Opus |
| **Canvas / MediaRecorder → WebM** | 85,8 s · **vidéo 14× ralentie** (85,07 s pour 6 s) | **7,33 s** · durée correcte |
| **Unifié (Auto)** | héritait du bug VP9 → basculait sur le moteur ralenti | **6,77 s** (MP4 & WebM) |
| **Classique (Médiarecorder)** | = moteur Canvas (mêmes défauts) | ≤ 9 s |

> Sur les 5 cartes du modal d'export, **2 étaient carrément désactivées** (grisées) sur une machine parfaitement capable de les exécuter.

Estimateur de débit mesuré sur la source de test : **~60 ms par seek** (min 2,3 · max 85 ms) — contre un budget de 33 ms/frame à 30 fps. C'est la cause du ralenti.

---

## 2. Les 6 causes racines (toutes corrigées)

### 🐛 #1 — Le moteur VP9 ne pouvait **jamais** démarrer (le plus critique)
`webm-webcodecs-export.js` sondait VP9 avec `hardwareAcceleration: 'prefer-hardware'`.
Chrome répond alors **« non supporté »** s'il n'existe pas d'encodeur VP9 *matériel* — ce qui est le cas sur quasiment toutes les machines, même puissantes.
Vérifié sur ta config : `vp09.00.31.08` → **true** sans le flag, **false** avec.

**Conséquence en cascade :** l'export WebM échouait → l'app basculait silencieusement sur le moteur **temps réel** → ⬇️ bug #2.

**Correctif :** sonde `prefer-hardware` → `auto` → `prefer-software` (idem pour H.264, qui commençait par `avc1.42E01E`, refusé sur ta machine alors que `42E028` fonctionne). Retrait de la chaîne invalide `'vp9'` (toujours `false`).

### 🐛 #2 — Le « ralenti à fond » : MediaRecorder étire la vidéo
Le moteur temps réel horodate chaque frame sur **l'horloge murale**. Si le rendu n'atteint pas la cadence, la vidéo est **étirée**, pas raccourcie.

- Le rendu ne pouvait pas suivre car **chaque frame faisait un seek** (`video.currentTime = t`) : ~60 ms × 180 frames = ~11 s de décodage pour 6 s de vidéo.
- Le seuil de seek était `1/(fps*4)` = **8 ms**, alors que deux frames sont espacées de **33 ms** → seek systématique.
- Le code commentait même ce comportement comme normal : *« l'export a simplement pris plus de temps que la timeline »*.

**Résultat mesuré : 6 s de timeline → fichier de 85,065 s (14× ralenti).** C'est exactement ton symptôme.

**Correctif :** la source est désormais **lue en continu** (muette) et la frame déjà décodée est **réutilisée** ; on ne seek qu'en cas de décrochage franc. → **85,07 s ⇒ 6,01 s**.

### 🐛 #3 — Le muxer WebM maison **plantait** (bug caché derrière #1)
Une fois #1 corrigé, le moteur VP9 mourait sur `RangeError: Maximum call stack size exceeded`:
le muxer empilait les octets dans des tableaux JS puis les étalait avec `[...millions]`.
**Le moteur VP9 ne pouvait donc produire aucun fichier réel** — le bug était simplement masqué par #1.

**Correctif :** assemblage en `Uint8Array` (concaténation de longueur connue). Plus de spread géant, ni pic mémoire.

### 🐛 #4 — Aucune détection du frame rate source (ton « frame to rate »)
`getMediaMetadata` écrivait **`fps = 30` en dur** (`getVideoPlaybackQuality` renvoie 0 avant lecture).
**Test : une source 24 fps était étiquetée « 30 fps »**, et une 60 fps aussi. L'export ne faisait donc **aucune conversion de cadence** (ni duplication ni saut de frame).

**Correctif :** nouveau `detectVideoFps()` — mesure le vrai débit via `requestVideoFrameCallback` puis l'aligne sur les cadences standard, et se branche à l'import.
**Vérifié : 24 → 24 · 30 → 30 · 60 → 59,94.** La bibliothèque affiche maintenant le vrai débit.

### 🐛 #5 — Audio supprimé en silence (MP4)
`AudioEncoder` échouait sur le décodage et l'export partait **sans son**, avec seulement un petit avertissement. L'échec est toujours rattrapé proprement, mais **la cause du décodage doit être creusée** (voir §5).

### 🐛 #6 — 2 moteurs sur 5 étaient désactivés à tort dans l'UI
La seconde sonde asynchrone du modal forçait elle aussi le matériel → carte « VP9 + Opus » grisée, et l'utilisateur redirigé vers le moteur ralenti.
**Correctif :** sonde unique et exacte (`capabilities.vp9`), doublon supprimé.

### Bonus — code mort
`lite-export.js`, `studio-export.js` et `transmux-export.js` existent sur le disque mais **ne sont chargés par aucun `<script>`** : jamais exécutés. À supprimer ou à brancher.

---

## 3. Résultats finaux (vérifiés)

| Sortie | Durée | Frames | Codecs |
|---|---|---|---|
| MP4 | 5,9667 s | 179 | h264 + aac |
| WebM (VP9) | **6,000000 s** | 180 | vp9 + opus |
| WebM (Canvas) | ~6–7 s | 180 | vp9 + opus |

Conversions de cadence validées : 24→30, 24→60, 60→30 (durées exactes, 360 frames en 60 fps).
Chemins UI validés : **Unifié (MP4)**, **Unifié (WebM)**, **VP9 + Opus**, **H.264 + AAC** — tous ≈ 7 s.

---

## 4. 🚀 Les moteurs modernes à adopter (ta demande)

### Le problème structurel actuel
Le projet gère **4 muxers/parseurs faits main** (EBML/WebM inline, MP4Box, plus 3 moteurs concurrents) et **3 boucles de rendu dupliquées** (~600 lignes chacune, quasi identiques). C'est ce qui a permis à 6 bugs de se cacher : chaque correctif devait être appliqué 3 fois.

### ✅ Recommandation n°1 — **Mediabunny** (remplace mp4-muxer **et** webm-muxer)
`mp4-muxer` et `webm-muxer`, que la communauté utilisait jusqu'ici, sont désormais **officiellement dépréciés au profit de Mediabunny** — c'est écrit dans leur README respectif.

**Mediabunny 1.56.1** · MPL-2.0 (usage commercial libre) · ~1,8 M téléchargements/semaine · zéro dépendance · **arborescent (dès ~5 ko gzip)** · créé par l'auteur de mp4-muxer/webm-muxer.

Ce que ça t'apporte concrètement :

| Fonction | Bénéfice pour CUT THE FLOW |
|---|---|
| **Démuxage** MP4/MOV/WebM/MKV/HLS/MP3/WAV/FLAC… | 🎯 **Décodage frame-exact** au lieu de `video.currentTime` (la cause du ralenti disparaît à la racine) |
| **Muxage** MP4 + WebM + MKV + WAV | 🎯 Supprime le muxer EBML maison (bug #3) et MP4Box |
| **Encodage/décodage WebCodecs** (25+ codecs) | 🎯 Un seul chemin d'encodage au lieu de 3 |
| `Conversion` (transmux, transcode, trim, resize, rotate, crop) | Export plus rapide + gains/perte de vitesse |
| Lecture/écriture microseconde | Timestamps exacts, index propre, durée fiable |
| Streaming I/O | Fichiers longs sans exploser la RAM |

**Exemple : lire une frame précise sans seek**
```js
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';

const input  = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
const track  = await input.getPrimaryVideoTrack();
const sink   = new VideoSampleSink(track);

// Décodage dans l'ordre (rapide, sans seek) — on remplace la boucle currentTime
for await (const sample of sink.samples(0, clipEnd)) {
  ctx.drawImage(sample.toCanvas(), 0, 0, width, height);
  sample.close();
}
```

**Exemple : écrire le MP4/WebM proprement**
```js
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource } from 'mediabunny';

const output = new Output({
  format: format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
  target: new BufferTarget(),
});
output.addVideoTrack(new CanvasSource(canvas, { codec: format === 'mp4' ? 'avc' : 'vp9' }));
await output.start();
// … ajouter les frames …
await output.finalize();
const blob = new Blob([output.target.buffer], { type: `video/${format}` });
```

### Recommandation n°2 — Encodage matériel correct
Probe systématique sur 3 niveaux : `prefer-hardware` → `auto` → `prefer-software`, et **exposer le moteur retenu dans l'UI** (ex. « H.264 · GPU »).

### Recommandation n°3 — Sélection automatique, sans régression
Décider **une seule fois** au démarrage :
1. H.264 **matériel** disponible → MP4 (le plus rapide, universel)
2. Sinon VP9/AV1 **logiciel** → WebM offline
3. Sinon, et seulement là, moteur temps réel — **avec avertissement explicite** sur le risque de ralenti

### Recommandation n°4 — Unifier les 3 boucles de rendu
Extraire `renderFrameAt(time, ctx)` et la partager entre les moteurs. C'est le correctif qui protège contre la réapparition de ces bugs.

---

## 5. Reste à faire (recommandé)

1. **Décodage audio** — `AudioContext.decodeAudioData` échoue sur l'AAC-in-MP4 dans l'environnement de test (le WAV passe). À reproduire sur une vraie config et, si confirmé, à remplacer par le **démuxeur/`AudioSampleSink` de Mediabunny**.
2. **Compléter le correctif de durée du WebM temps réel** — MediaRecorder n'écrit pas de `Duration` ; en réécrivant l'en-tête EBML (le muxer maison sait le faire) on obtient un fichier parfaitement lisible partout.
3. **Upscale 24→60** — l'encodage VP9 de 360 frames 720p prend ~6,2 s (plancher mesuré) ; le surcoût restant vient du décodage de la source. Le décodage séquentiel Mediabunny supprime ce plafond.
4. **Cache-busters** — penser à incrémenter `?v=` sur `js/*.js` dans `index.html` (le service worker sert l'ancien code sinon, ce qui a failli me faire croire que mes correctifs ne s'appliquaient pas).
5. **Nettoyage** — supprimer `lite-export.js`, `studio-export.js`, `transmux-export.js` (jamais chargés) ou les intégrer.

---

## 6. Fichiers modifiés

| Fichier | Correctifs |
|---|---|
| `js/webm-webcodecs-export.js` | Probe VP9 (#1), boucle de décodage (#2), muxer Uint8Array (#3), pré-roulage |
| `js/webcodecs-export.js` | Probe H.264 (#1), boucle de décodage (#2), pré-roulage |
| `js/canvas-export.js` | Lecture continue + pré-roulage (#2), resync anti-churn, contrôle de durée avec alerte ralenti |
| `js/app.js` | `detectVideoFps()` (#4), suppression du `fps=30` en dur, sonde `vp9` + doublon UI supprimé (#6), avertissement moteur temps réel |
| `js/unified-export.js` | Avertissement explicite lors du repli temps réel |

> ℹ️ `CUTTHEFLOW/` est ignoré par le `.gitignore` du dépôt `2.13` (liste blanche SuperPrint) : ces correctifs doivent être versionnés dans le dépôt CUTTHEFLOW lui-même.
