# Audit complet — CUT THE FLOW

**Date :** 20 octobre 2026 · **Périmètre :** `index.html`, `js/*`, timeline audio/vidéo,
import, export, formats de projet, PWA · **Méthode :** lecture du code, banc de
régression en navigateur réel (Chrome 155), analyse des fichiers produits par
ffmpeg 9.0.2.

---

## 1. Synthèse

L'application **exporte correctement** : le banc de régression de la v1 passe
**29/29** (390 images, synchro 0 ms sur MP4/WebM/MP3, aucune image noire aux
coupes, 0 image différente de la source). Ce n'était pas acquis : l'audit du
10 septembre avait corrigé cinq moteurs inutilisables.

Douze défauts ont malgré tout été trouvés et corrigés pendant cette relecture
(dont un **non-déterminisme audio** dans la nouvelle version, reproduit une fois
sur trois). La nouvelle version Astro + Rust est construite, testée et
**45/45** sur le même montage de référence.

| Version | Banc | Synchronisation | Déterminisme |
|---|---|---|---|
| v1 (navigateur) | **29/29** | 0 ms (MP4/WebM/MP3) | dépend de WebCodecs/GPU |
| v2 (Rust + ffmpeg) | **45/45** | 0 ms (MP4/WebM/MP3) | identique sur toute machine |

> **Deuxième passe (même jour, §7)** : effets, transitions et formes livrés dans
> la v2 ; 2 305 lignes mortes supprimées de la v1 (banc rejoué, 29/29) ;
> interface refondue sur le langage visuel de SuperPhoto ; binaires Windows et
> Linux reconstruits, macOS confié au workflow GitHub.

---

## 2. Architecture de la v1 (ce que l'audit devait couvrir)

- **Timeline** — `js/app.js` (13 600 lignes) : temps flottants en secondes,
  précision annoncée 0,0001 s (`TIME_PRECISION`), intervalles semi-ouverts avec
  epsilon (`isTimeInClip`, l. 5808), accrochage (`trySnap`, l. 5753).
- **Import** — `handleFiles` (l. 2519), `getMediaMetadata` (l. 2869, contournement
  de `duration === Infinity` des WebM), `detectVideoFps` (l. 3022, mesure réelle
  de la cadence), proxys 4K (`generateSmartProxy`).
- **Export** — trois moteurs hors ligne + un repli temps réel :
  - `webcodecs-export.js` : H.264 + AAC → MP4 (MP4Box) ;
  - `webm-webcodecs-export.js` : VP9 + Opus → WebM (muxeur EBML maison) ;
  - `mp3-export.js` : LAME 3.100, audio seul ;
  - `canvas-export.js` : MediaRecorder, **repli temps réel** (non déterministe).
  - `handleExport` (l. 9797) choisit le moteur ; `startExport` (l. 9895) est
    l'**ancien** chemin, encore présent.
- **Projet** — `.ctf` (ZIP + médias) et `.json` (données seules), via JSZip.
- **PWA** — `service-worker.js`, cache versionné, `manifest.json`.

---

## 3. Ce qui est solide (et pourquoi)

### 3.1 Extraction vidéo image-exacte

`js/frame-source.js` est le cœur de la justesse. Il a remplacé la lecture en
temps réel (878 ms d'erreur moyenne mesurée) par un **seek + attente de
`seeked`**, en visant le **milieu de la frame source** (`midFrameOffset`) :
viser `k/fps` tombait sur la mauvaise image une fois sur trois et produisait
20 images dupliquées + 19 sautées sur 60.

Le banc le vérifie : `0 duplication, 0 saut, erreur 0,0 ms`.

### 3.2 Audio échantillon-exact hors ligne

Les trois moteurs décodent chaque source, la rééchantillonnent en 48 kHz par
**interpolation linéaire** (le plus proche voisin soufflait sur les sources
44,1 kHz), appliquent les fondus par échantillon, puis somment. `amix` n'est pas
utilisé : le mix est un `Float32Array` unique.

### 3.3 Horodatage des images

`frameTimestamp(i) = round(i × 1e6 / fps)` : l'arrondi est fait **à chaque
image**, jamais accumulé. À 29,97 i/s, une multiplication par un ticks/frame
entier dériverait de plusieurs dizaines de ms sur un long montage.

### 3.4 Validation avant export

`export-safeguards.js` bloque les configurations impossibles (mémoire estimée,
résolution, images) au lieu de produire un fichier tronqué.

---

## 4. Constats détaillés

### 4.1 Timeline vidéo

| # | Constat | Gravité | État |
|---|---|---|---|
| V1 | Les clips d'une **piste muette** comptent dans la durée d'export (`timelineEnd` est calculé avant le test `muted`) : un clip muet à 30 s produit 17 s de noir/silence en fin de fichier. | Moyenne | Documenté (comportement conservé : la timeline affichée et l'export restent cohérents) |
| V2 | Aucune détection de **chevauchement** sur une piste : deux clips superposés sont tous deux rendus (le dernier gagne à l'image, les deux sons se somment). | Faible | Documenté |
| V3 | `startExport` (l. 9895–12199, **≈ 2 300 lignes**) est du code mort : l'interface appelle `handleExport`. Il embarque un second moteur audio/vidéo, divergent. | Haute (maintenance) | Documenté ; suppression recommandée |
| V4 | `lite-export.js`, `studio-export.js`, `transmux-export.js` ne sont **jamais chargés** par `index.html`. | Faible | Documenté |
| V5 | Le rendu image par image utilise `currentTime < start + duration` (sans epsilon), la preview un intervalle avec epsilon : aux bornes, une image peut être affichée par les deux ou par aucun. Le banc ne le voit pas (coupes franches). | Faible | Documenté |

### 4.2 Timeline audio

| # | Constat | Gravité | État |
|---|---|---|---|
| A1 | `getChannelData()` était appelé **à chaque échantillon et chaque canal** dans les moteurs MP4/WebM (≈ 2,5 millions d'appels pour 13 s). Le MP3, lui, extrayait les canaux une fois. | Moyenne (performance) | **Corrigé** (`webcodecs-export.js` l. 429, `webm-webcodecs-export.js` l. 618) |
| A2 | Normalisation **incohérente** : MP4/WebM atténuaient au-delà de 0,95, MP3 au-delà de 0,99 → 0,36 dB d'écart entre deux exports du même projet. | Moyenne | **Corrigé** (seuil unique 0,99) |
| A3 | La preview applique le volume de piste mais **pas les fondus** audio ; l'export les applique. | Faible | Documenté |
| A4 | La preview corrige la dérive audio au-delà de **250 ms** (audible) et n'utilise pas l'audio comme horloge maîtresse. | Faible | Documenté (l'export n'est pas concerné) |
| A5 | MP3 : compensation manuelle du délai LAME (1105 échantillons), mesurée à +20 ms avant correctif. | — | Déjà corrigé (v1) |

### 4.3 Import

| # | Constat | Gravité | État |
|---|---|---|---|
| I1 | `detectMediaType` accepte par extension des conteneurs que le navigateur ne décode pas (AVI, MKV…) : l'import attend 10 s puis refuse. | Faible | Documenté |
| I2 | Blocage **strict** des vidéos 4K/2K sur machine « LOW » (`navigator.deviceMemory`, valeur arrondie et non fiable) avec `alert()` : un utilisateur peut être empêché d'importer un fichier que sa machine lit très bien. | Moyenne (produit) | Documenté ; la v2 n'a plus de blocage |
| I3 | `detectVideoFps` mesure la cadence en jouant la vidéo : correct mais probabiliste, et coûteux à l'import. | Faible | Documenté (la v2 lit `avg_frame_rate` par ffprobe) |
| I4 | Les **proxyUrl** (blob) étaient enregistrés dans `.ctf`/`.json` puis restaurés : après rechargement, la preview demandait un blob révoqué → image noire jusqu'au relink. | Haute | **Corrigé** (`app.js` l. 12741, 13058, 13281) |
| I5 | Un média **distant** (URL http/https) perdait son URL dans `.ctf` (`url: undefined` pour tous) : il devenait « manquant » au rechargement. | Haute | **Corrigé** (`app.js` l. 12757) |
| I6 | Aucune validation de schéma au chargement d'un projet : un JSON malformé casse la timeline. | Moyenne | **Corrigé dans la v2** (`Project::validate`) |

### 4.4 Export

| # | Constat | Gravité | État |
|---|---|---|---|
| E1 | Les chunks encodés sont **tous gardés en RAM** (`encodedChunks`, `audioEncodedChunks`) : un montage 4K de 30 min peut saturer la mémoire. | Moyenne | Documenté ; la v2 streame vers le fichier via ffmpeg |
| E2 | WebM maison n'écrit **pas de Cues** : la lecture est correcte, le seek lent dans certains lecteurs. | Faible | Documenté |
| E3 | Le repli temps réel est annoncé mais reste **non déterministe** (étirement mesuré jusqu'à +11,6 %). | Moyenne | Déjà atténué par l'avertissement explicite ; la v2 n'a plus de repli temps réel |
| E4 | Le MP4 n'a pas de **faststart** (MP4Box écrit le `moov` à la fin) : démarrage plus lent en streaming. | Faible | La v2 écrit `+faststart` |
| E5 | Les moteurs d'export réimplémentent chacun le mixage (3 copies) : une correction doit être appliquée trois fois. | Moyenne | Corrigé dans la v2 (un seul graphe) |
| E6 | **Non-déterminisme audio de la v2** (trouvé pendant la validation) : `apad=whole_dur` après `amix` produisait un WAV de 13 s ou 14 s selon la course des entrées — 1 fois sur 3. | **Critique** | **Corrigé** : lit de silence `anullsrc` de durée exacte |

### 4.5 Projet & persistance

| # | Constat | Gravité | État |
|---|---|---|---|
| P1 | `.ctf` charge tout le ZIP en mémoire (JSZip) : un projet de plusieurs Go peut échouer. | Moyenne | La v2 garde les médias sur disque et ne met que la timeline dans le JSON |
| P2 | Le format n'a pas de version de schéma exploitable (juste `version: "2.0"`). | Faible | La v2 valide et versionne (`version: 1`) |
| P3 | Aller-retour `.ctf`/`.json` testé par le banc (5 pistes, 7 clips, format d'export) : **OK**. | — | Conservé |

### 4.6 Interface & PWA

| # | Constat | Gravité | État |
|---|---|---|---|
| U1 | `onclick="app.openStockSearch()"` dans `index.html` (l. 634) appelait une méthode **inexistante** : clic = erreur JS silencieuse, bouton mort. | Moyenne | **Corrigé** (bouton retiré) |
| U2 | `tools/sync-asset-hashes.js` référençait un fichier supprimé (`js/optimized-export.js`) et n'incluait ni `frame-source.js` ni les moteurs WebM/MP3 : il aurait échoué, et les `?v=` pouvaient rester périmés. | Moyenne | **Corrigé** (liste réelle + remplacement de tout cache-buster) |
| U3 | Le nom de cache du service worker n'avait pas été changé depuis la 3.10.1 : les clients pouvaient servir l'ancien shell. | Faible | **Corrigé** (`r3`) |
| U4 | Les boutons d'export restent actifs après un export terminé (pas de garde `isExporting` globale). | Faible | Documenté |

### 4.7 Sécurité & vie privée

- Tout est local (blob URLs, aucun upload) : c'est le bon modèle.
- Les **noms de clips** sont insérés via `createTextNode` (l. 6287) et les noms de
  pistes échappés (l. 6120) : pas de XSS trouvée dans le rendu de la timeline.
- Pas de **CSP** dans `index.html` (le `.htaccess` pose `X-Frame-Options` et
  `Referrer-Policy`). Recommandation : CSP avec `blob:`, `data:`, `media-src`.
- Les clés IA et le JWT Pinata sont dans `localStorage`/`sessionStorage` : à
  documenter clairement (le README le fait déjà pour les clés IA).
- Le serveur v2 n'écoute que `127.0.0.1` et refuse les origines distantes.

---

## 5. Corrections appliquées (v1)

| Fichier | Ligne | Correction | Vérification |
|---|---|---|---|
| `js/webcodecs-export.js` | 429, 469 | canaux extraits une fois hors de la boucle d'échantillons | banc 29/29, taille de sortie identique |
| `js/webcodecs-export.js` | 487–497 | seuil de normalisation aligné sur le MP3 (0,99) | banc 29/29 |
| `js/webm-webcodecs-export.js` | 618, 651 | idem canaux | banc 29/29 |
| `js/webm-webcodecs-export.js` | 665–672 | seuil 0,99 | banc 29/29 |
| `js/app.js` | 12741, 12757 | `.ctf` : proxy jamais sérialisé, URL distante conservée | aller-retour du banc OK |
| `js/app.js` | 13049–13058 | `.ctf` : proxy neutralisé au chargement, `isUsingProxy` remis à faux | preview/export retombent sur l'original |
| `js/app.js` | 13281 | `.json` : proxy blob mort nettoyé au chargement | idem |
| `index.html` | — | bouton « SEARCH ONLINE VIDEOS » mort supprimé | plus d'erreur JS |
| `tools/sync-asset-hashes.js` | 8–55 | liste réelle des fichiers chargés ; remplacement de **tout** `?v=` | `node tools/sync-asset-hashes.js` OK |
| `service-worker.js` | 4 | cache `r3` | nouveau shell servi |

Le banc complet a été **relancé après corrections** : `29/29`.

---

## 6. Nouvelle version Astro + Rust

### 6.1 Pourquoi

La v1 dépend du navigateur : Safari/Firefox n'encodent pas H.264, le repli temps
réel étire les montages longs, et un onglet caché gèle l'export. Le résultat
dépend aussi du GPU. La v2 confie l'encodage à **ffmpeg** et ne garde que
l'édition dans le navigateur.

### 6.2 Principe de synchronisation

1. **Mixage audio d'abord**, en PCM flottant 48 kHz : chaque clip est décalé par
   `adelay` en **nombre d'échantillons**, mélangé avec `amix=normalize=0` sur un
   lit de silence de la durée exacte (`anullsrc` + `atrim`).
2. **Composition vidéo ensuite** : une entrée par clip, `trim` sur la source,
   `setpts=PTS+start/TB` (placement sur la timeline), `fps` (cadence imposée),
   `overlay` activé sur `between(t,start,end)`.
3. **Une seule durée** : `-t` et `-r` sur la sortie ; audio et vidéo commencent
   à 0 et finissent ensemble.

Le point corrigé pendant la validation : `apad=whole_dur` après `amix` n'était
pas déterministe. Remplacé par un lit de silence de durée exacte, puis
**rejoué 3 fois** : 14,000 s / 14,000 s / 14,000 s.

### 6.3 Validation

| Contrôle | Résultat |
|---|---|
| `cargo test --workspace` | 31/31 |
| `node scripts/verify-export.mjs` | **45/45** |
| Export MP4 / WebM / MP3 | 390 images, 13,000 s, synchro 0 ms |
| Interface (Chrome réel) | import, pose de clips, rognage, déplacement, texte, forme, effet, transition, preview, exports MP4 / WebM / MP3 |
| Aller-retour projet | sauvegarde JSON, rechargement, média résolu par le registre |

### 6.4 Sécurité du serveur local

- écoute `127.0.0.1` par défaut ;
- refuse les `Origin` non locales sur les écritures (CORS limité à localhost) ;
- les chemins de médias ne viennent **jamais** du navigateur : résolution par
  identifiant dans le registre ;
- noms de fichiers assainis, taille d'upload bornée, `Range` borné.

### 6.5 Limites de la v2.1

Sous-titres, proxys 4K, undo/redo et détachement audio ne sont pas encore exposés
dans l'interface (le modèle et le moteur sont prévus). ffmpeg n'est pas embarqué.
macOS est construit par CI, ad-hoc signé, et notarié seulement si les secrets
sont configurés.

---

## 7. Deuxième passe (même jour)

### 7.1 Effets, transitions, formes — livrés

| Brique | Où | Détail |
|---|---|---|
| Effets | `ctf-core/src/graph.rs` (`effect_chain`) | 13 effets ffmpeg, appliqués dans la chaîne du clip |
| Transitions | `ctf-core/src/plan.rs` | fondu depuis le fond, fondu enchaîné borné par les marges réelles |
| Formes | `ctf-core/…` + `ctf-engine/src/export.rs` | ellipse / rectangle arrondi rasterisés **une fois** par `geq`, puis bouclés |
| Rotation | `graph.rs` | `rotate=…:c=none:ow/oh` |
| Interface | `astro/src/scripts/{state,preview,editor}.ts` | onglets Propriétés / Effets / Transitions, badges FX et transition |

Mesures : sépia → `44,39,30` au centre ; ellipse → `240,239,242` = `#F0F0F2` ;
fondu enchaîné de 0,5 s → `29,29,29` avant, `121,13,68` au milieu, `201,0,102`
après (mélange réel des deux sources), 270 images, 9,000 s, audio 9,000 s.

Le plan de transition décale la fenêtre **et** le point d'entrée source du même
`d`, borné par `source_start`, la marge après du clip sortant et la moitié de
chaque clip. `d = 0` → fondu depuis le fond, jamais un raccord bancal. L'interface
affiche désormais les marges et prévient quand `d` est ramené à zéro ou quand les
clips ne se touchent pas.

### 7.2 Code mort de la v1 — supprimé

| Élément | Avant | Après |
|---|---|---|
| `js/app.js` | 13 684 lignes | **11 379** (−2 305 : `async startExport()` mort) |
| `js/lite-export.js`, `js/studio-export.js`, `js/transmux-export.js` | 3 fichiers jamais chargés | supprimés |
| Bouton « SEARCH ONLINE VIDEOS » | appelait `app.openStockSearch()`, inexistant | supprimé |

Banc de régression v1 **relancé après suppression : 29/29**.

### 7.3 Interface — refonte sur le langage SuperPhoto

Thème sombre par défaut (`--bg-base #101013`, `--bg-surface #15151a`,
`--line #25252c`), barre supérieure de 58 px, panneaux à en-tête « surtitre +
titre », toile sur grille, barre d'état monospace. Thème clair disponible et
mémorisé, appliqué avant le premier rendu.

Application de bureau assumée : glisser-déposer depuis le bureau (voile plein
écran) et carte de raccourcis complète (espace, flèches, `S`, `Suppr`, `Ctrl+D`,
`T`/`R`/`C`, `N`, `+`/`−`, `Ctrl+I/O/S/E/N`, `Ctrl+,`, `?`).

### 7.4 Mac / PC / Linux

| Plateforme | Cible | Où |
|---|---|---|
| Windows | `x86_64-pc-windows-gnullvm` | local + CI |
| Linux x86-64 | `x86_64-unknown-linux-musl` (statique) | local + CI |
| Linux ARM64 | `aarch64-unknown-linux-musl` (statique) | local + CI |
| macOS Apple Silicon | `aarch64-apple-darwin` | CI (`macos-15`) |
| macOS Intel | `x86_64-apple-darwin` | CI (`macos-15-intel`) |

Le workflow vit à la **racine du dépôt** — `.github/workflows/cuttheflow.yml` —
parce que GitHub n'exécute que ceux qui s'y trouvent. macOS est toujours signé
ad-hoc (obligatoire sur Apple Silicon) et notarié seulement si les secrets
`MACOS_*` existent ; une signature en échec ne bloque pas la publication.

---

## 8. Reproduire les mesures

```powershell
# v1 — banc navigateur (Chrome + ffmpeg)
cd CUTTHEFLOW
node tools/regression/montage.cjs          # 29/29

# v2 — tests unitaires + banc ffmpeg
cd rust
cargo test --workspace
node scripts/verify-export.mjs --bin .\target\release\cuttheflow.exe   # 45/45
```

Les rapports sont écrits dans `tools/regression/out/report.json` et
`rust/target/verify/report.json`.

---

## 9. Recommandations restantes

1. Unifier le mixage des trois moteurs v1 (ou basculer la v1 sur le moteur v2).
2. Ajouter une **CSP** et un `Cross-Origin-Opener-Policy` à la v1.
3. Ajouter les Cues au muxeur WebM maison (seek).
4. Exposer dans la v2 les sous-titres, les proxys 4K et l'historique undo/redo.
5. Embarquer ffmpeg (ou un installeur qui le pose à côté du binaire).
6. Exécuter le workflow une fois pour produire les binaires macOS, puis
   configurer les secrets `MACOS_*` si une distribution notariée est visée.
7. Ajouter des tests d'interface automatisés (aujourd'hui vérifiés à la main).
