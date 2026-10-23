# CUT THE FLOW v2 — Astro + Rust

État au 20 octobre 2026. Ce document décrit la v2 livrée à côté de la v1, ce qui
a été fait, et ce qui reste.

## Ce qui est en place

| Brique | Emplacement | État |
|---|---|---|
| Moteur (modèle, graphe, plan) | `rust/crates/ctf-core` | 30 tests unitaires ✅ |
| Moteur (ffmpeg, audio, formes) | `rust/crates/ctf-engine` | 1 test ✅ |
| Binaire + serveur + UI embarquée | `rust/crates/ctf-app` | ✅ |
| Interface studio (design SuperPhoto) | `astro/` | `npm run check` 0 erreur ✅ |
| Banc d'export (45 contrôles) | `rust/scripts/verify-export.mjs` | 45/45 ✅ |
| Binaire Windows | `rust/dist/cuttheflow-windows-x86_64.exe` | ✅ |
| Binaire Linux x86-64 (musl) | `rust/dist/cuttheflow-linux-x86_64` | ✅ |
| Binaire Linux ARM64 (musl) | `rust/dist/cuttheflow-linux-aarch64` | ✅ |
| Binaire macOS Apple Silicon | `rust/dist/cuttheflow-macos-arm64` | ✅ (Zig local + CI) |
| Binaire macOS Intel | `rust/dist/cuttheflow-macos-x86_64` | ✅ (Zig local + CI) |
| Signature / notarisation macOS | même workflow | ad-hoc appliquée, Developer ID si secrets |

Dépôt dédié : **`zigmoon/cuttheflow`**, branches `main` et `v2` (arborescence
autonome `astro/` + `rust/` + `docs/`, README du produit). CI « CUT THE FLOW 2 »
verte sur les quatre cibles : Windows x86-64, Linux x86-64, macOS Apple Silicon,
macOS Intel ; les quatre fichiers sont publiés en artefacts du run.

## Décisions structurantes

### 1. L'interface n'encode pas

La v1 encodait dans le navigateur : correct (29/29 au banc), mais dépendant de
WebCodecs. Le repli temps réel étire les longs montages, et Safari/Firefox n'ont
pas d'encodeur H.264. La v2 envoie le projet au moteur et lit le résultat ; le
même projet produit le même fichier partout.

### 2. Le mixage audio précède la vidéo

Deux passes indépendantes : d'abord un WAV PCM flottant 48 kHz de la durée
exacte, ensuite la composition vidéo qui consomme ce WAV. Un décalage audio ne
peut donc pas être « rattrapé » par erreur, et le fichier audio est vérifiable
seul (le banc le fait : MP3 contre MP4, écart 0 ms).

Détail qui a coûté cher : `apad=whole_dur` après `amix` produisait 13 s ou 14 s
selon les exécutions (1 sur 3). Le mixage se fait maintenant sur un lit de
silence `anullsrc` de longueur exacte. Trois exécutions consécutives donnent
14,000 s.

### 3. Effets au niveau du clip, transitions au niveau du plan

Un effet vit dans la chaîne de filtres du clip : il ne peut pas déborder. Une
transition vit dans `plan.rs`, qui décale la fenêtre **et** le point d'entrée
source du même `d`, borné par les marges réelles. Si `d` vaut 0, on obtient un
fondu depuis le fond, jamais un raccord bancal.

### 4. Les formes sont rasterisées une fois

`geq` dessine exactement une ellipse mais coûte par image. Le moteur produit un
PNG RGBA une fois, puis le boucle comme une image. Un seul jeu de formules
couvre rectangle net, rectangle arrondi et ellipse.

### 5. Le projet ne transporte pas de chemins

Le serveur résout les `media.id` dans son registre. Un projet forgé ne peut pas
lire un fichier arbitraire. Les routes sont limitées à `127.0.0.1` et les
origines distantes sont refusées.

## Interface

Refonte complète à partir du langage visuel de SuperPhoto (thème sombre), mais
**avec l'identité d'origine intacte** : le logo de la v1 est réutilisé tel quel
(`astro/src/components/BrandMark.astro` reprend les tracés exacts de
`img/CUT_THE_FLOW_b.svg`, vérifié au pixel), et les icônes d'onglet, d'application
et le manifeste sont les fichiers de la v1.

Langue : **anglais par défaut**, français disponible dans les préférences
(`astro/src/scripts/i18n.ts`, anglais canonique, français en table). Le choix est
mémorisé et appliqué avant le premier rendu, comme le thème.

- jetons de couleur `--bg-base #121214`, `--bg-surface #16161a`,
  `--line #26262c`, typographie monospace pour les valeurs ;
- barre supérieure de 58 px : marque, actions fichier, identité du projet,
  pastille moteur, aide / thème / panneaux, export ;
- panneau médias à gauche (dépôt + boutons d'insertion), panneau outils à
  droite avec onglets **Propriétés / Effets / Transitions** ;
- scène sur grille avec ombre profonde, pastille de zoom, transport ;
- timeline redimensionnable : entêtes de pistes, clips colorés par type, badges
  FX / transition / texte / forme, playhead, accrochage ;
- barre d'état monospace, dialogues export / aide / préférences, notifications.

Thème clair disponible et mémorisé ; le sombre est le défaut, appliqué avant le
premier rendu (pas de flash).

Application de bureau assumée : glisser-déposer **depuis le bureau** (voile plein
écran, multi-fichiers), et une carte de raccourcis complète (espace, flèches,
`S`, `Suppr`, `Ctrl+D`, `T`/`R`/`C`, `N`, `+`/`−`, `Ctrl+I/O/S/E/N`, `Ctrl+,`, `?`).

### Deux défauts d'interface corrigés après la refonte

| Symptôme | Cause | Correction |
|---|---|---|
| La scène disparaissait quand un panneau latéral était fermé | `display:none` retirait le panneau de la grille ; les deux zones restantes glissaient d'une colonne et la scène tombait dans la colonne de largeur 0 | chaque zone a une `grid-column` explicite (`1`, `2`, `3`) |
| Panneau médias inaccessible sur une fenêtre étroite | une règle responsive le masquait sous 1020 px, et le bouton de la barre ne pouvait pas le rouvrir (seule entrée possible : le glisser-déposer) | les panneaux ne sont plus jamais masqués par la taille ; seules leurs largeurs diminuent (230/268 px) |
| Logo d'origine absent | un pictogramme générique avait été dessiné à la place | `BrandMark.astro` reprend les tracés du fichier de la v1 (0 pixel d'écart) |
| Studio inerte si le stockage local est bloqué | `localStorage` levait une exception dans `init()` | accès `localStorage` centralisé et tolérant ; l'init ne peut plus bloquer l'écran d'accueil |

L'écran d'accueil (logo + « moteur local ») reprend celui de la v1 : il s'efface
dès que le moteur a répondu, avec un plafond de 2,5 s et un filet de sécurité à
4 s.

### Troisième passe — doublons, langue, écran vide

| Symptôme | Cause | Correction |
|---|---|---|
| Le thème se règle à deux endroits (barre supérieure **et** préférences) | deux contrôles pour le même réglage | un seul : Apparence, dans les préférences |
| « Importer » existait quatre fois (barre, panneau, zone de dépôt, état vide) | ajouts successifs | panneau médias + zone de dépôt + `Ctrl+I` ; la barre n'en porte plus |
| Couper / dupliquer / supprimer en double (barre **et** barre de timeline) | idem | une seule maison : la barre de timeline, qui agit sur la sélection |
| Texte / forme en double (pied du panneau médias **et** barre de timeline) | idem | une seule maison : le pied du panneau médias (texte, rectangle, ellipse) |
| Le pourcentage de zoom de l'aperçu refaisait « ajuster » | deux boutons pour la même action | le pourcentage ramène à 100 %, « ajuster » reste à côté |
| FPS affiché deux fois (identité du projet **et** barre d'état) | redondance | l'identité porte la définition, la barre d'état la durée et les clips |
| Le logo ouvrait les raccourcis **et** le bouton Aide aussi | parité v1 mal placée | le logo est décoratif, l'aide est un bouton |
| Écran de prévisualisation bavard au démarrage | accroche + paragraphe + deux boutons + liste de technologies | **le logo, seul** (idem pour l'écran d'accueil) |
| Interface uniquement en français | chaînes en dur | `i18n.ts` : anglais canonique, français en table, réglage dans les préférences |
| Messages de progression de l'export en français, même en anglais | texte libre produit par le moteur | le moteur ne renvoie plus que le **stade** (`queued`, `audio`, `mux`, `video`, `done`), l'interface le traduit |

Nettoyage au passage : 13 règles CSS mortes supprimées (`.splash-word`,
`.splash-loading`, `.empty-kicker`, `.empty-features`, `.theme-toggle`,
`.toolbar-hint`, `.zoom-readout`, `.status-tool`, `.status-hint`, `.switch`,
`.panel-scrim`), un `#panelScrim` jamais utilisé, et `definition.label/hint`
retirés de `state.ts` (la copie vit dans `i18n.ts`).

La hauteur de la timeline est désormais plafonnée (`min(--timeline-h, max(170px,
46vh))`) : sur une fenêtre de 588 px de haut, la scène garde 194 px au lieu
d'être écrasée.

### Quatrième passe — la barre de transport

| Symptôme | Cause | Correction |
|---|---|---|
| Les boutons Début / Lecture / Fin n'étaient pas centrés | la barre était un `flex` en simple file, chaque élément poussé par le suivant | grille `1fr auto 1fr` : le bloc central est centré sur la largeur de la scène, quoi qu'il arrive à gauche |
| Le temps n'était pas au centre de la vidéo | il suivait les boutons dans le flux | il passe sous les boutons, dans le même bloc centré, avec une largeur fixe (`tabular-nums`) pour ne pas trembler |
| La grande tirette sous la vidéo faisait doublon | la timeline sait déjà déplacer la tête de lecture : règle et zones vides d'une piste, au clic comme au glisser | `#scrub` supprimé (marquage, CSS, écouteurs, `this.scrubbing`, clé `transport.position`) |

Vérifié à la règle : sur une scène de 812 px, les boutons, Play et le bloc de
temps partagent exactement le même axe (`cx = 692`), en anglais comme en
français, la barre n'a aucun débordement horizontal, et cliquer sur la règle
place toujours la tête de lecture (`00:02.500` mesuré).

## Nettoyage de la v1

- `js/app.js` : suppression du bloc mort `async startExport()` — 2 305 lignes,
  de 13 684 à **11 379**. `node --check` OK.
- Suppression de `js/lite-export.js`, `js/studio-export.js`,
  `js/transmux-export.js` (aucune référence restante, aucun `<script>` orphelin).
- Suppression du bouton « SEARCH ONLINE VIDEOS » qui appelait
  `app.openStockSearch()`, inexistant.
- `tools/sync-asset-hashes.js` corrigé (il produisait `?v=abc?v=20260917f`) ;
  `service-worker.js` incrémenté en `cuttheflow-shell-v3.10.1-r3`.
- Banc de régression v1 **relancé après ces suppressions : 29/29**.

## Corrections de la v1 (banc à l'appui)

| Défaut | Effet | Correction |
|---|---|---|
| Données de canal recalculées par image | export 3 à 5× trop lent, mémoire instable | cache par clip (`webcodecs-export.js`, `webm-webcodecs-export.js`) |
| Seuil de normalisation 0,95 | saturation sur sources déjà proches du pic | seuil 0,99 |
| `isUsingProxy` sérialisé | projet rouvert avec un proxy fantôme | jamais sérialisé, `false` à la relecture |
| Proxys `blob:` morts dans `.json` | import silencieusement cassé | nettoyage à l'écriture |
| `sync-asset-hashes` | `?v=` dupliqué → 404 CSS/JS | expression corrigée + resynchronisation |

## Mac / PC / Linux

| Plateforme | Cible | Où |
|---|---|---|
| Windows | `x86_64-pc-windows-gnullvm` (LLVM-MinGW) | local + CI |
| Linux x86-64 | `x86_64-unknown-linux-musl` (statique) | local + CI |
| Linux ARM64 | `aarch64-unknown-linux-musl` (statique) | local + CI |
| macOS Apple Silicon | `aarch64-apple-darwin` (Zig) | local + CI |
| macOS Intel | `x86_64-apple-darwin` (Zig) | local + CI |

macOS se cross-compile depuis Windows avec **Zig** (`cargo zigbuild`), qui
fournit les stubs de la `libSystem` : `scripts/build.ps1` produit donc les cinq
binaires. Ces fichiers ne sont pas signés ; le workflow
`.github/workflows/cuttheflow.yml (racine du dépôt)` applique la signature
ad-hoc (ou Developer ID) sur des runners macOS.

Signature macOS en deux niveaux :
1. signature **ad-hoc** systématique — obligatoire sur Apple Silicon, un binaire
   non signé est tué au lancement ;
2. signature **Developer ID + notarisation + agrafage** si les secrets
   `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`,
   `MACOS_NOTARY_*` sont présents.

Les deux niveaux sont indépendants : sans secrets, le workflow publie des
binaires exécutables, simplement non notariés. C'est le comportement demandé
(« signature si ça marche, sinon sans »).

## Version 0.7.0 — 22 octobre 2026

| Changement | Détail |
|---|---|
| **Archives par système** | `packages/CUTTHEFLOW-0.7.0-<cible>.zip` : exécutable + dépendances + lanceur (`.cmd` / `.sh` / `.command`) + mode d'emploi FR. Extraire et lancer, sans terminal |
| **Windows portable** | la cible `gnullvm` importait `libunwind.dll` (absente de tout PC) : le binaire ne démarrait pas, sans message. La DLL est livrée à côté de l'exécutable, le lanceur vérifie sa présence |
| **ffmpeg optionnel** | `serve` démarre même sans ffmpeg et annonce « mode navigateur (export WebCodecs) » ; les routes dépendantes répondent 503 avec la marche à suivre. Le moteur natif reste prioritaire dès que ffmpeg est présent |
| Import / export | les gardes portent sur le **mode** (`engine`) et non sur `engineOk` : sans ffmpeg, import et export continuent dans le navigateur (site statique compris) |
| `/api/health` | expose `engine` et `reason` ; le studio bascule en mode navigateur et affiche une **information**, pas une erreur |
| Version visible | Préférences : « Studio 2.5.0 · moteur 0.7.0 » ; version du studio injectée au build depuis `package.json` |
| Cohérence | `package-lock.json` réaligné sur `package.json` |
| Service worker | `VERSION` = `ctf2-v7` |

### Ce que « le moins de problèmes » veut dire ici

| Système | Piège évité |
|---|---|
| Windows | DLL manquante (échec silencieux) → DLL livrée + lanceur qui explique |
| Windows | SmartScreen sur un exe téléchargé → lanceur `.cmd` + mode d'emploi ; signature Authenticode possible via CI avec certificat |
| macOS | Gatekeeper « développeur non identifié » → le lanceur retire lui-même la quarantaine du binaire ; arm64 porte une signature ad-hoc (obligatoire sur Apple Silicon) |
| macOS/Linux | bit exécutable perdu dans un ZIP → le lanceur fait `chmod +x` puis se relance |
| Tous | ffmpeg absent → le studio fonctionne en mode navigateur au lieu de refuser de démarrer |

**Sources uniques des numéros** — à ne jamais dupliquer :

- studio : `astro/package.json` → `version` (le lock suit, généré par npm) ;
- moteur : `rust/Cargo.toml` → `[workspace.package] version`, héritée par les
  trois crates ; le binaire l'expose via `env!("CARGO_PKG_VERSION")` dans
  `/api/health` et `--version` ;
- cache : `astro/public/service-worker.js` → `VERSION`.

## Version 0.6.0 — 22 octobre 2026

| Changement | Détail |
|---|---|
| **Dépôt = piste neuve** | un glisser depuis le chutier crée une piste du type du média, à la place de la ligne survolée, et le clip tombe exactement à l'instant déposé (plus de saut à la fin de la dernière séquence) ; clic et import conservent « réutiliser la piste compatible, empiler à la suite » |
| **Mise à jour proposée** | le worker n'appelle plus `skipWaiting()` ; un bandeau « nouvelle version » avec « Mettre à jour » / « Plus tard » apparaît. Vérifications au chargement, au retour d'onglet, au retour réseau et toutes les 30 min |
| Hors-ligne | le précache analyse `index.html` et met en cache les bundles hachés : le studio démarre hors-ligne, pas seulement le HTML |
| Caches | shell versionné (`ctf2-v6`) + cache d'assets non versionné plafonné à 260 entrées, conservé entre mises à jour |
| Service worker | `VERSION` = `ctf2-v6` |

## Version 0.5.0 — 22 octobre 2026

| Changement | Détail |
|---|---|
| **Piste au bon endroit** | un dépôt sans piste compatible insère la nouvelle piste **à l'index survolé**, pas à la fin ; la piste visée montre des pointillés ambrés si le média part ailleurs, un `+` si une piste va naître là |
| **Dézoom étendu** | plage 0,25 → 1 024 px/s (0,25 px/s ≈ une heure à l'écran) ; graduations à pas ronds de 0,04 s à 30 min ; `+`/`−` zooment autour du centre de la vue ; bouton et `Ctrl+Maj+0` pour cadrer tout le montage |
| **Règle compacte** | timeline repliée : barre fine pleine largeur (remplissage + bouton de tête de lecture) pour parcourir le montage sans rouvrir le panneau |
| Tête de lecture | zone de préhension de 15 × 24 px sur la règle, sans masquer les clips voisins |
| Lecture | déplacer la tête de lecture pendant la lecture recale l'horloge : le saut est pris en compte et la lecture continue |
| Service worker | `VERSION` = `ctf2-v5` : purge des caches précédents à l'activation |

## Version 0.4.1 — 22 octobre 2026

| Changement | Détail |
|---|---|
| **Dépôt tolérant** | glisser une vidéo sur une piste audio ne bloque plus : le studio prend la piste compatible existante, sinon en crée une, et l'annonce (« posé sur VIDEO 2 (nouvelle piste) »). La piste survolée qui ne peut pas recevoir le média est cerclée de pointillés avant le relâchement |
| Dépôt sous les pistes | l'écoute du glisser couvre toute la zone défilante : lâcher sous la dernière piste pose le média au lieu de ne rien faire |
| **Molette de la timeline** | `Ctrl`/`⌘` + molette (et pincement du trackpad) zoome la timeline **centrée sur le curseur** au lieu de zoomer la page entière ; la molette simple défile horizontalement ; bornes 10–640 px/s ; boutons `+`/`−` toujours valables depuis un zoom intermédiaire |
| Service worker | `VERSION` = `ctf2-v4` : purge des caches précédents à l'activation |

## Version 0.4.0 — 22 octobre 2026

| Changement | Détail |
|---|---|
| **Keyframes** | clés posées à la tête de lecture sur opacité, échelle, X/Y, rotation et volume ; interpolation linéaire / entrée / sortie / entrée-sortie ; valeurs tenues hors plage ; clés **locales au clip** ; un seul `valueAt()` partagé par la preview et l'export |
| **Vitesse** | 0,25× → 4× et préréglages ; la portion de source jouée est conservée (2× divise la durée par deux au lieu de rogner) ; conversion appliquée à la lecture, au mixage Web Audio et aux rognages |
| **Masques** | rectangle / ellipse, centre, taille, adoucissement, inversion ; rendu par cale de composition, le masque découpe le clip et pas les calques du dessous |
| **Formes d'onde** | `canvas` par clip audio, pics décodés une fois puis mis en cache ; en mode moteur, `GET /api/media/{id}/waveform` est utilisé |
| Badges de clip | vitesse, masque et keyframes visibles sur la timeline |
| Bascule d'export | un projet à keyframes / masque / vitesse est rendu par le navigateur même quand le moteur est joignable, et le dialogue l'écrit (`needsBrowserRender()`) |
| Service worker | `VERSION` = `ctf2-v3` : purge des caches précédents à l'activation |

## Version 0.3.0 — 21 octobre 2026

| Changement | Détail |
|---|---|
| **Annuler / rétablir** | historique par instantanés, plafonné à 50 étapes et 6 Mo ; `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y` et deux boutons dans la barre. Un glissement de clip ou une rafale de curseur ne compte que pour **une** annulation |
| Encodeur vérifié | si le navigateur ne sait pas encoder la combinaison choisie (4K H.264 typiquement), le dialogue l'annonce et grise « Export » avant le rendu |
| Partage | `og:url`, `og:image`, `twitter:image` et `canonical` en URL absolues (`site` dans `astro.config.mjs`) |
| Export figé | plus de blocage à « Mixing audio… » sur une vidéo sans piste audio : le repli de décodage MP4Box est réservé aux conteneurs ISO-BMFF |
| Annulation d'export | le signal d'abandon est consulté pendant le mixage audio ; l'état « Export cancelled » remplace un « échec » |
| Service worker | `VERSION` = `ctf2-v2` : les caches des versions précédentes sont purgés à l'activation |

## Version 0.2.0 — 21 octobre 2026

| Changement | Détail |
|---|---|
| Barre supérieure | logo seul à gauche (plus de libellé « STUDIO ») ; trappes et Export sans fond ni contour, état actif lisible par la teinte |
| Insertion | le bandeau *Insérer* est au-dessus des médias, sous l'en-tête du panneau |
| Transport | temps en bas à droite, sur la ligne des boutons — barre plus basse |
| Timeline | bouton de rangement (scène pleine hauteur) conservé à gauche des zooms |
| Fondu enchaîné | la fenêtre du clip entrant s'allonge de `d` : plus de trou noir/silencieux avant le clip suivant |
| Preview | composition et seek utilisent le placement résolu : un dissolve se voit vraiment |
| Texte | la taille exportée suit l'échelle du clip, comme la preview |
| Version web | sans moteur : import IndexedDB + export WebCodecs, `base: '/CUTTHEFLOW'`, `dist/` autonome |

## Ce qu'il reste à faire

1. Signer les binaires macOS produits localement avant diffusion (ad-hoc minimum).
2. Exposer les sous-titres, les proxys 4K, les keyframes, la vitesse/rampe, les
   masques et les formes d'onde audio (le modèle et le moteur sont déjà prévus).
3. Embarquer ffmpeg (ou un installeur qui le pose à côté du binaire) pour
   supprimer la dépendance externe.
4. Tests d'interface automatisés (aujourd'hui vérifiés à la main dans Chrome).
