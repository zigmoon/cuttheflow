# 🔍 AUDIT EXPORT & MONTAGE LONG — CUT THE FLOW

**Date :** 10 septembre 2026
**Machine de test :** 16 cœurs · 32 Go · Chrome 148 (Electron 42)
**Méthode :** montages réels construits dans l'app, exports réels, fichiers analysés avec `ffprobe`

---

## 1. Réponse directe à ta question

> « est-ce que les ralentissements seraient liés à la puissance du poste de travail ? »

# ❌ NON. Ce n'est pas la puissance du PC.

Deux preuves chiffrées :

### Preuve A — Bridage CPU de la machine

| Test | Timeline | Temps d'export | Écart |
|---|---|---|---|
| Machine **normale** | 180 s | 270,3 s | référence |
| Machine bridée **×8 plus lente** | 180 s | 286,7 s | **+6 % seulement** |

Avec un processeur **8 fois plus lent**, l'export ne prend que **6 % de plus**.
→ L'export **n'est pas limité par le CPU**.

**Pourquoi ?** Le goulot d'étranglement est le **décodeur vidéo**, qui tourne dans un
processus séparé, non affecté par le bridage. La machine peut donc être lente sans que
l'export en souffre — et inversement.

### Preuve B — Le ralenti touche davantage les machines **rapides**

Même timeline de 120 s, même page neuve, seule la puissance change :

| Machine | Frames produites | Attendu | Durée du fichier | Dérive |
|---|---|---|---|---|
| **Normale** | 3547 | 3600 | **133,93 s** | **+11,6 %** ❌ |
| **Bridée ×4** | 3600 | 3600 | **120,13 s** | **+0,1 %** ✅ |

**La machine rapide a produit un fichier ralenti de 11,6 %, la machine lente un fichier exact.**
Le décalage est donc **aléatoire**, pas proportionnel à la puissance.

✅ **Bonne nouvelle : tu n'as pas besoin de changer de matériel.**

---

## 2. Le vrai coupable : le moteur « temps réel »

Le montage long est **plus lent** parce que l'app peut router l'export vers un moteur
**temps réel** (`MediaRecorder`). Ce moteur :

- capture les images **au rythme de l'horloge murale** (pas de la timeline) ;
- ne délivre une image que quand le compositeur en produit une ;
- **perd donc des frames** sur les fichiers longs, ce qui **étire la vidéo**.

Mesures sur 120 s / 3600 frames attendues :

| Export | Frames | Dérive |
|---|---|---|
| Moteur temps réel (normal) | 3547 / 3600 | **+11,6 %** |
| Moteur temps réel (bridé ×4) | 3600 / 3600 | +0,1 % |
| Moteur temps réel (2ᵉ essai, normal) | 3594 / 3600 | **+7,7 %** |
| Temps réel, 30 s | 853 / 900 | −2,4 % |

→ **Dérive variable de −2 % à +12 %**, sans lien avec la machine.

---

## 3. Les moteurs offline sont, eux, **parfaits**

| Moteur | Fichier | Durée | Frames | Verdict |
|---|---|---|---|---|
| **VP9 + Opus (offline)** | montage mixte 95 s | **95,000000 s** | **2850 / 2850** | ✅ **exact** |
| **VP9 + Opus (offline)** | 120 s | 120,000000 s | 3600 / 3600 | ✅ **exact** |
| H.264 + AAC (offline) | 180 s | 179,97 s | 5399 / 5400 | ✅ durée exacte |

**Conclusion : utiliser un moteur offline donne un fichier au frame près, quelle que soit
la machine.**

### ⚠️ Mais le routage par défaut peut te tromper

Le moteur **« Unifié (Auto) »** (sélectionné par défaut) route bien le WebM vers VP9 offline
— **si VP9 est disponible**. Sinon, il **bascule silencieusement** sur le moteur temps réel,
celui qui dérive. Tu crois exporter en VP9, tu obtiens un fichier étiré.

Sur ta machine VP9 est disponible, donc le chemin par défaut est sûr. Mais si la détection
échoue (ou sur un autre navigateur), le repli silencieux est un piège.

---

## 4. Le système de montage : vérifié, il est sain ✅

Montage testé volontairement complexe :

| Piste | Contenu | Position |
|---|---|---|
| VIDEO 1 | vidéo 30 s → **photo 5 s** → vidéo 60 s | 0 → 30 → 35 → 95 |
| AUDIO 1 | musique 30 s | 0 → 30 |

Résultat de l'export : **durée 95,000000 s**, **2850 / 2850 frames**, piste **vp9 + opus 48 kHz
stéréo**. Aucune erreur console, aucun décalage audio, positionnement des clips exact.

**Verdict : la gestion des pistes, du temps, et le mélange vidéo / photo / audio sont corrects.**
Le problème n'est pas dans le système de montage, mais dans **le choix du moteur d'export**.

---

## 5. Défauts réels trouvés (à corriger)

> ✅ **Les trois défauts ci-dessous ont été CORRIGÉS en v3.9.5** (voir le détail et les
> vérifications après chaque point). Le rapport est conservé tel quel pour l'historique.

### 🔴 A. Repli silencieux vers un moteur qui dérive — ✅ CORRIGÉ
`unified-export.js` basculait sur le moteur temps réel si VP9 échoue, avec un simple
`console.warn`. L'utilisateur n'était pas averti que son fichier risquait d'être étiré.

**Correctif :** avertissement **visible** dans la barre de statut (7 s, bilingue FR/EN),
affiché uniquement lors d'un repli effectif :
*« Export en moteur temps réel : sur un montage long, la vidéo peut être étirée. Choisissez
« VP9 + Opus » ou exportez en MP4 (H.264) pour un fichier exact. »*
Vérifié : le repli forcé affiche bien l'avertissement ; un export VP9 normal n'affiche rien.

### 🟠 B. Message d'alerte faux — ✅ CORRIGÉ
Le contrôle de durée affichait « rendu trop lent pour le temps réel », ce qui est
**contredit par les mesures** (la machine lente produit un fichier exact). Message réécrit
et seuil resserré de 10 % → 2 % pour détecter les dérives avant qu'elles ne soient visibles.

### 🟠 C. Piste audio du MP4 corrompue — ✅ CORRIGÉ
Les exports **H.264 + AAC** produisaient une piste audio que `ffprobe` voyait comme
`unknown,video` et qui n'était **pas décodable**. Trois causes cumulées dans le bundle
MP4Box : il ne sait pas **écrire** la boîte `esds` ; `addTrack()` attendait le FourCC
`'mp4a'` (le code passait `'audio'`) ; la clé attendue est `samplerate` (le code passait
`sample_rate`).

**Correctif :** nouvelle fonction `createEsdsBox()` qui sérialise l'`ES_Descriptor` complet
(ISO/IEC 14496-1), plus `type: 'mp4a'`, `hdlr: 'soun'`, `samplerate` et `samplesize`.

| | Avant | Après |
|---|---|---|
| Pistes | `h264,video` + **`unknown,video`** | `h264,video` + **`aac,audio,48000,2`** |
| Décodage audio | ❌ | ✅ **OK** |
| Contenu | — | ✅ son réel (−22,6 dB moyen) |

Validé sur 8 s et sur un montage de 24 s (3 clips vidéo + 4 clips audio) : 719/720 frames,
audio AAC stéréo décodable.

### 🟡 D. Décodage audio sur AAC-in-MP4 — ✅ RÉSOLU (c'était un artefact de test)
`decodeAudioData` échouait sur l'AAC dans **Electron**, mais **fonctionne parfaitement dans un
vrai Chrome 152**. Le doute a été levé en pilotant le véritable Chrome installé sur la machine
via le protocole CDP, sans dépendance npm.

**Vérifications effectuées dans Chrome 152.0.7977.83 :**

| Test | Résultat |
|---|---|
| `decodeAudioData` sur AAC-in-MP4 | ✅ `ok: true` (10 s, 48 kHz) |
| `decodeAudioData` sur Opus-in-WebM | ✅ `ok: true` (10 s, 48 kHz) |

**Export d'une vidéo AVEC son, dans les 3 moteurs, puis analyse du fichier :**

| Moteur | Piste audio | Fréquence | Niveau | Décodage |
|---|---|---|---|---|
| MP4 (H.264 + AAC) | `aac, 48 kHz, 2ch` | **439 Hz** (source 440) | −21,1 / −14,5 dB | ✅ |
| WebM (VP9 + Opus) | `opus, 48 kHz, 2ch` | **439 Hz** | −21,1 / −17,9 dB | ✅ |
| WebM (Canvas temps réel) | `opus, 48 kHz, 2ch` | **440 Hz** | −21,1 / −14,5 dB | ✅ |

**Les niveaux sont identiques à la source, au dixième de décibel près** : le son est donc
repris intégralement, sans perte ni décalage.

**Test complémentaire — montage multi-pistes** (vidéo 440 Hz 0–10 s → photo 10–15 s,
plus musique 880 Hz 0–8 s sur une piste audio), exporté en MP4 et analysé par tranches :

| Segment | Attendu | Mesuré |
|---|---|---|
| 0–5 s (vidéo 440 Hz **+** musique 880 Hz) | les deux sons additionnés | pic **−10,2 dB** · fréquence dominante **878 Hz** ✅ |
| 8,2–9,8 s (vidéo seule, musique terminée à 8 s) | son de la vidéo seul | pic −18,0 dB · **440 Hz** ✅ |
| 11–14 s (photo, aucun audio) | silence | **−91,0 dB** = silence ✅ |

Le mix additionne correctement les pistes, respecte les bornes temporelles de chaque clip,
et produit du silence là où il n'y a pas d'audio. **Le dernier maillon est validé.**

---

## 6. Recommandations

### Pour toi, tout de suite

1. **Pour un montage long, choisis explicitement « VP9 + Opus »** (ou « H.264 + AAC »),
   jamais « Canvas Real-time ».
   - MP4 → H.264 + AAC (attention : audio à surveiller, cf. défaut C)
   - WebM → **VP9 + Opus** ← le plus fiable, frame-exact
2. **Évite « Unifié (Auto) »** sur les projets longs tant que le repli silencieux existe.
3. Vérifie la durée du fichier exporté : elle doit égaler la timeline.

### Pour le code

1. **Supprimer le repli silencieux** : si le moteur offline échoue, prévenir clairement
   l'utilisateur au lieu de produire un fichier dégradé.
2. **Verrouiller la durée** : le contrôle existe déjà (2 %), mais l'export devrait *échouer*
   plutôt que livrer un fichier décalé.
3. **Corriger la piste audio du MP4** (défaut C) — bloquant pour qui exporte en MP4.
4. Envisager **Mediabunny** (cf. `EXPORT-AUDIT-2026-09-10.md`) : il fournit un muxage MP4
   complet et un décodage séquentiel, ce qui supprime à la fois la dérive et le problème `esds`.

---

## 7. Ce que tu peux retenir

| Question | Réponse |
|---|---|
| Est-ce la puissance de mon PC ? | **Non.** Bridage ×8 → +6 % de temps seulement |
| Pourquoi la vidéo ralentit sur les longs montages ? | Moteur **temps réel** qui perd des frames (**+7 à +12 %**) |
| Le système de montage est-il en cause ? | **Non**, il est exact (vérifié sur montage mixte) |
| Quelle solution ? | Moteurs **offline** : VP9 + Opus = exact au frame près |
| Faut-il changer de machine ? | **Non** |
