# CHANGELOG - CUT THE FLOW

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [CUT THE FLOW 2 — studio web 2.6.2 / moteur 0.9.1] - 2026-10-23

### 🎨 Modifié — l'interface ne parle plus de « navigateur » dans l'application

Dans une application de bureau, dire « gardez cet onglet ouvert » ou « utilisez
un Chrome récent » n'a aucun sens. Pire, c'était le conseil donné quand
l'encodage échouait : impossible à suivre dans une app.

Le studio distingue maintenant les deux situations (`/api/health` répond = on est
dans l'application ; 404 = hébergement statique) :

| Situation | Avant | Maintenant |
|---|---|---|
| Pastille, app sans ffmpeg | « dans le navigateur » | « sans ffmpeg » |
| Encodage impossible, dans l'app | « Utilisez Chrome, Edge ou Firefox » | « Installez ffmpeg …, puis relancez CUT THE FLOW » |
| Moteur perdu, dans l'app | « Relancez `cuttheflow serve` » | « Quittez CUT THE FLOW et relancez-le » |
| Textes d'export | « dans ce navigateur », « gardez l'onglet » | « image par image (WebCodecs) », « sur place » |

Le web garde ses messages d'origine, qui y sont exacts.

### 🎨 Modifié — les raccourcis s'affichent avec ⌘ sur macOS

Le gestionnaire de clavier acceptait déjà les deux (`ctrlKey || metaKey`), mais
l'aide et toutes les infobulles affichaient « Ctrl ». Sur Mac elles affichent
maintenant ⌘ et ⇧, comme le clavier de l'utilisateur : `⌘ + Z`, `⌘ + ⇧ + Z`,
`⇧ + ← / →`. Vérifié en simulant une plateforme `MacIntel`.

### 🔧 Corrigé — message d'erreur d'encodeur

`export-browser.ts` conseillait « Utilisez Chrome ou Edge à jour » en dur, hors
traduction. Le message est neutre et propose la vraie solution : installer
ffmpeg.

### 🔧 Service worker `ctf2-v11`

Purge du cache pour les visiteurs déjà passés sur la PWA.

---

## [CUT THE FLOW 2 — studio web 2.6.1 / moteur 0.9.1] - 2026-10-23

### 🐛 Corrigé — `cuttheflow --web` ne démarrait pas

Le README et le mode d'emploi documentent `cuttheflow --web`. Le binaire
répondait `commande inconnue « --web »` : la première option était prise pour un
nom de commande. Toute option commençant par `-` lance maintenant `serve`, donc
`cuttheflow --web` et `cuttheflow --port 7400` fonctionnent comme documenté.

### 🐛 Corrigé — l'aide décrivait encore l'ancien comportement

`--help` annonçait « le navigateur s'ouvre » et ne mentionnait ni `--native` ni
`--web`. Le texte décrit désormais la fenêtre native et le repli sur le
navigateur.

### 🐛 Corrigé — WebView2 salissait le dossier de téléchargement

Sans répertoire explicite, le moteur écrivait son profil dans un dossier
`cuttheflow.exe.WebView2` **à côté de l'exécutable**. Deux conséquences : le
dossier de téléchargement se remplissait de fichiers inconnus, et le studio ne
pouvait pas démarrer s'il était installé dans un emplacement en lecture seule
(`C:\Program Files`). Le profil est maintenant rangé avec les autres données du
studio (`%LOCALAPPDATA%\cuttheflow\webview`, `~/.local/share/cuttheflow/webview`).

### ✅ Ajouté — test de fumée sur chaque système, en CI

Chaque construction exécute désormais le binaire livré : `--version`, `--help`
(qui doit mentionner `--web` et `--native`), `doctor`, démarrage réel du serveur,
réponse de `/api/health` et envoi de l'interface. Ce contrôle aurait attrapé le
bug `--web`.

### 🔧 Service worker `ctf2-v10`

Purge du cache pour les visiteurs déjà passés sur la PWA.

---

## [CUT THE FLOW 2 — studio web 2.6.0 / moteur 0.9.0] - 2026-10-23

### ✨ Ajouté — une vraie fenêtre d'application, sans navigateur

Le studio ne s'ouvre plus dans un onglet : l'exécutable embarque le moteur de
rendu du système dans **sa propre fenêtre** (`wry` + `tao`).

| Système | Moteur de rendu | À installer |
|---|---|---|
| Windows 10/11 | WebView2 | rien (présent d'origine) |
| macOS | WKWebView | rien (fait partie du système) |
| Linux | WebKitGTK 4.1 | `libwebkit2gtk-4.1-0` (défaut sur Ubuntu 24.04+) |

Plus d'onglets, plus de barre d'adresse, plus besoin de Chrome ou Edge. Le mode
navigateur reste disponible avec `--web` (`cuttheflow --web`), et c'est le mode
automatique des builds Linux « autonomes » qui ne dépendent d'aucune
bibliothèque.

Si la fenêtre native est indisponible (WebKitGTK absent, pas de session
graphique), le studio **le dit et bascule sur le navigateur** au lieu de refuser
de démarrer.

### ✨ Ajouté — Linux x86-64 « fenêtre native » et Linux ARM64

La CI publie désormais six builds : Windows, macOS Apple Silicon, macOS Intel,
Linux x86-64 natif (glibc + WebKitGTK), Linux x86-64 autonome (musl statique)
et Linux ARM64 autonome.

### 🎨 Modifié — icône des préférences

Le bouton des préférences utilisait un glyphe qui se lisait comme un soleil.
C'est maintenant une **roue dentée** sans ambiguïté (anneau extérieur, moyeu
central, huit dents).

### 🔧 Corrigé — dépendances Windows de la fenêtre native

Le binaire Windows importe `WebView2Loader.dll` : sans elle, double-clic sans
effet et aucun message (`0xC0000135`). L'archive la contient désormais, aux
côtés de `libunwind.dll`, et `build.ps1` comme la CI la joignent
automatiquement.

### 🔧 Service worker `ctf2-v9`

Purge du cache pour les visiteurs déjà passés sur la PWA.

---

## [CUT THE FLOW 2 — studio web 2.5.1 / moteur 0.8.0] - 2026-10-23

### 🐛 Corrigé — le studio s'ouvrait dans un onglet de navigateur

Double-clic sur l'exécutable → le studio apparaissait dans le navigateur par
défaut, avec onglets et barre d'adresse. Ce n'était pas une fenêtre
d'application, alors que le README parlait d'un « studio window ».

Cause : `open_browser()` appelait `cmd /C start "" <url>` (Windows),
`open` (macOS) ou `xdg-open` (Linux) — c'est-à-dire le navigateur par défaut,
sans plus.

Désormais le studio s'ouvre dans une **fenêtre dédiée**, en mode application
(`--app=<url>`) de Chrome / Edge / Brave / Chromium : ni onglets, ni barre
d'adresse, une simple fenêtre à lui. Le binaire cherche le premier navigateur
Chromium installé (Edge est présent sur tout Windows 10/11), et **retombe sur le
navigateur par défaut** s'il n'en trouve aucun — auquel cas il l'annonce :

```
  fenêtre   : mode application (sans onglets ni barre d'adresse)
```

Vérifié sur le binaire packagé : une fenêtre Edge intitulée « CUT THE FLOW —
Editing studio » s'ouvre, distincte des onglets existants.

### 📝 Clarifié

- La documentation dit maintenant **pourquoi** c'est une fenêtre de navigateur :
  l'interface est une application web, l'exécutable fournit le moteur d'export
  et la sert depuis `127.0.0.1`. Pas d'Electron ni de Qt — c'est ce qui permet
  un seul binaire pour trois systèmes.
- Le mode d'emploi et les trois lanceurs annoncent la fenêtre dédiée, et
  indiquent comment aller plus loin : « Installer CUT THE FLOW » depuis le menu
  du navigateur (le studio est une PWA, donc installable avec icône et fenêtre
  sans chrome).
- Moteur : `0.8.0` (changement de comportement à l'ouverture).

---

## [CUT THE FLOW 2 — studio web 2.5.1] - 2026-10-23

### 🐛 Corrigé — pastille « offline » en rouge sur la version en ligne

Le studio déployé sur un hébergement statique (`app.zigmoon.com/CUTTHEFLOW`)
affichait **« offline » en rouge** dans la barre supérieure. C'était faux et
alarmant : dans ce mode il n'y a **aucun moteur à joindre**, l'import et
l'export se font dans le navigateur (WebCodecs), et le studio est pleinement
utilisable.

Cause : `updateEngineBadge()` testait `engineOk` **avant** le mode. Sur un site
statique, `/api/health` n'existe pas, donc `engineOk` est faux par construction
→ branche d'erreur. L'ordre est inversé et la sémantique clarifiée :

| Situation | Avant | Maintenant |
|---|---|---|
| Site statique, aucun moteur | 🔴 « offline » | pastille neutre « dans le navigateur », infobulle explicative |
| Binaire lancé, ffmpeg absent | 🔴 « offline » | idem — le studio fonctionne, un message d'information le dit |
| Moteur joignable | 🟢 « moteur » | inchangé |
| Moteur attendu mais perdu | 🔴 « offline » | inchangé (seul vrai cas de panne) |

- L'infobulle anglaise codée en dur (`Run cuttheflow serve…`) est remplacée par
  deux libellés traduits (`engine.localTitle`, `engine.lostTitle`).
- Service worker : `VERSION` passe à `ctf2-v8`.

---

## [CUT THE FLOW 2 — studio web 2.5.0 / moteur 0.7.0] - 2026-10-22

### ✨ Ajouté

- **La version est visible dans les Préférences** (« Studio 2.5.0 · moteur
  0.7.0 »). Elle est injectée au build depuis `package.json` (`vite.define` →
  [`version.ts`](astro/src/scripts/version.ts)) : il n'existe plus aucun endroit
  où saisir un numéro à la main, donc plus de risque d'afficher une version
  périmée. En mode statique, la ligne n'affiche que la version du studio.
- **Archives prêtes à l'emploi par système** (`packages/`) : un ZIP par cible
  contenant l'exécutable, ses dépendances, un **lanceur** (`.cmd`, `.sh`,
  `.command`) et un mode d'emploi en français. L'utilisateur extrait et lance,
  sans ligne de commande.

### 🐛 Corrigé — trois pièges qui empêchaient l'application de démarrer

- **Le binaire Windows ne démarrait pas hors machine de développement.**
  L'éditeur de liens de la cible `gnullvm` importait `libunwind.dll`, une DLL
  qui n'existe que dans le toolchain Rust : sur un PC normal, double-clic →
  *rien*, sans message (le loader échoue avant le premier `println!`). La DLL
  est désormais copiée à côté de l'exécutable, et le lanceur vérifie sa
  présence avec un message explicite.
- **`serve` refusait de démarrer sans ffmpeg.** `cuttheflow serve` faisait
  `Ffmpeg::discover()?` : un utilisateur sans ffmpeg n'obtenait **aucun**
  studio, alors que le mode navigateur (WebCodecs) fait tout. ffmpeg est
  maintenant **optionnel** : le serveur démarre, annonce clairement
  « ffmpeg : ABSENT — mode navigateur », et les routes qui en dépendent
  répondent `503` avec la marche à suivre.
- **Exporter et importer étaient bloqués dès que le moteur était incomplet.**
  `startExport` et `importFiles` testaient `engineOk`, ce qui interdisait aussi
  le chemin navigateur — y compris sur le site statique. La condition porte
  désormais sur le mode réellement utilisé (`engine`) : sans ffmpeg, import et
  export continuent de fonctionner dans le navigateur.
- `health()` du studio honorait pas le drapeau `engine` du serveur : il croyait
  le moteur disponible et échouait au premier import. Il le respecte, et le
  message affiché est une **information**, pas une erreur.
- `package-lock.json` annonçait encore `2.1.0` : métadonnées réalignées
  (régénérées par npm, pas à la main).
- Service worker : `VERSION` passe à `ctf2-v7` (le shell a changé).

### 🔧 Versions de cette livraison

| Élément | Version | Source unique |
|---|---|---|
| Studio Astro | **2.5.0** | `astro/package.json` (+ `package-lock.json` réaligné) |
| Moteur Rust | **0.7.0** | `rust/Cargo.toml` → `[workspace.package]`, hérité par `ctf-app`/`ctf-core`/`ctf-engine`, exposé par `env!("CARGO_PKG_VERSION")` |
| Cache PWA | **ctf2-v7** | `astro/public/service-worker.js` |

---

## [CUT THE FLOW 2 — studio web 2.4.0 / moteur 0.6.0] - 2026-10-22

### ✨ Ajouté

- **Chaque dépôt depuis le chutier crée sa piste.** Glisser un média sur la
  timeline construit une piste neuve du type du média (audio ou vidéo) qui prend
  la place de la ligne survolée, et le clip tombe **exactement à l'instant
  déposé**. L'ajout par clic et l'import gardent l'ancienne règle (réutiliser la
  piste compatible, empiler à la suite) : deux gestes, deux contrats.
- **Mise à jour de l'application proposée, jamais imposée.** Le service worker
  n'appelle plus `skipWaiting()` : la nouvelle version reste en attente et un
  bandeau l'annonce avec un bouton « Mettre à jour » (et un « Plus tard »).
  Vérification au chargement, au retour sur l'onglet, au retour du réseau, puis
  toutes les 30 minutes. Le rechargement n'a lieu qu'au clic — un rechargement
  surprise au milieu d'un montage serait pire que pas de mise à jour.
- **Hors-ligne réel dès l'installation.** Le précache lit le `index.html` et met
  en cache les bundles hachés qu'il référence : avant, seul le HTML était
  précaché et le studio s'ouvrait hors-ligne sur une page vide.
- Cache des fichiers hachés (`ctf2-assets`) **conservé entre versions** et
  plafonné à 260 entrées : une mise à jour ne jette plus les bundles dont un
  onglet encore ouvert a besoin, et le quota ne dérive pas.

### 🐛 Corrigé

- Le bandeau « le studio a été mis à jour » ne s'affiche plus lors de la toute
  première visite (le `clients.claim()` initial déclenchait `controllerchange`).
- Service worker : `VERSION` passe à `ctf2-v6`.

---

## [CUT THE FLOW 2 — studio web 2.3.0 / moteur 0.5.0] - 2026-10-22

### ✨ Ajouté

- **Piste créée à l'endroit du dépôt.** Glisser un média là où aucune piste
  compatible n'existe insère la nouvelle piste **à cet index** (et non à la fin
  de la pile), comme une ligne insérée dans une liste. La piste survolée est
  cerclée de pointillés ambrés quand le média ira ailleurs, et d'un `+` quand
  une piste va naître ici — donc avant même de relâcher.
- **Dézoom étendu et cadrage.** La timeline descend maintenant à **0,25 px/s**
  (≈ une heure de montage dans la largeur de l'écran) au lieu de 10 px/s. Les
  graduations suivent (pas « ronds » de 0,04 s à 30 min, ~60 px par tick). Un
  bouton « afficher tout le montage » (et `Ctrl+Maj+0`) cadre la timeline sur la
  durée entière ; `+`/`−` zooment désormais **autour du centre de la vue**.
- **Règle compacte quand la timeline est repliée.** Une barre fine pleine
  largeur, avec remplissage et bouton de tête de lecture, permet de parcourir le
  montage sans rouvrir la timeline. Mesuré : 1 578 px de large, dans le panneau,
  sans découpe.
- **Tête de lecture saisissable.** Une zone de préhension de 15 px sur la règle
  (et non un trait d'un pixel) permet de la tirer à la souris ; elle reste
  limitée aux 24 px de haut pour ne pas masquer les clips voisins.

### 🐛 Corrigé

- **Impossible de déplacer la tête de lecture pendant la lecture.** La boucle de
  rendu recalculait le temps depuis son horloge interne, ce qui annulait tout
  déplacement à l'image suivante : il fallait mettre en pause. `seek()` recale
  désormais l'horloge, donc cliquer dans la règle ou tirer la tête de lecture
  saute à l'instant voulu **et la lecture continue**. Vérifié : 0,90 s → 4,00 s
  pendant la lecture, puis 4,60 s une demi-seconde plus tard.
- Service worker : `VERSION` passe à `ctf2-v5`.

---

## [CUT THE FLOW 2 — studio web 2.2.1 / moteur 0.4.1] - 2026-10-22

### 🐛 Corrigé

- **Déposer une vidéo sur une piste audio était refusé.** Le studio répondait
  « cette piste est une piste audio » et ne faisait rien : il fallait créer un
  calque vidéo à la main avant chaque glisser. Désormais le dépôt choisit la
  bonne destination tout seul — piste compatible existante, sinon **piste
  neuve** — et le dit dans la barre d'état (« posé sur VIDEO 2 (nouvelle
  piste) »). La piste survolée qui ne peut pas recevoir le média est signalée
  par un contour pointillé avant même le relâchement.
- **Lâcher un média sous la dernière piste** (zone vide de la timeline) est
  maintenant accepté : l'écoute du dépôt couvre toute la zone défilante, plus
  seulement les lignes de piste.
- **La molette zoomait toute l'interface.** Aucun gestionnaire `wheel` n'existait
  sur la timeline, donc `Ctrl`/`⌘` + molette (et le pincement du trackpad)
  déclenchait le zoom de la page. La timeline gère maintenant son propre zoom,
  **centré sur le curseur** (le temps sous la souris reste sous la souris), et
  la molette simple fait défiler horizontalement au lieu de ne rien faire. Le
  zoom reste borné à 10–640 px/s ; les boutons `+`/`−` fonctionnent toujours,
  y compris depuis un zoom intermédiaire obtenu à la molette.

### 🧹 Nettoyé

- Les messages `toast.audioTrackOnly` / `toast.audioNeedsAudioTrack` sont
  supprimés : ce cas n'est plus une erreur.
- Service worker : `VERSION` passe à `ctf2-v4`.

---

## [CUT THE FLOW 2 — studio web 2.2.0 / moteur 0.4.0] - 2026-10-22

### ✨ Ajouté

- **Keyframes.** Chaque propriété animable (opacité, échelle, position X/Y,
  rotation, volume) accepte des clés posées à la tête de lecture avec la valeur
  courante. Interpolation **linéaire, entrée, sortie ou entrée-sortie**, choisie
  clé par clé ; hors plage, la première/dernière valeur est tenue (aucune
  extrapolation). Les clés sont **locales au clip** : déplacer un clip ne décale
  jamais son animation. Le rendu de la preview et celui de l'export passent par
  la même fonction (`valueAt`).
- **Vitesse / rampe.** Curseur 0,25× → 4× et six préréglages. La portion de
  source jouée est conservée : passer de 1× à 2× divise la durée par deux au
  lieu de rogner le plan. La lecture (tête de lecture, export WebCodecs, Web
  Audio) suit la même conversion, audio compris.
- **Masques.** Rectangle ou ellipse, centrage X/Y, largeur, hauteur,
  adoucissement et inversion (« creuser un trou »). Le masque découpe **le clip
  lui-même** via une cale de composition : il ne troue pas les calques
  inférieurs. Mesuré sur l'export : coins à 0, centre inchangé.
- **Formes d'onde audio** sur la timeline (`canvas` par clip), décodées une
  seule fois par média puis mises en cache. En mode moteur, les pics viennent de
  `GET /api/media/{id}/waveform`.
- Badges de clip : vitesse (`2×`), masque (`◱`), keyframes (`◆`).
- Le dialogue d'export **annonce la bascule** : un projet à keyframes, masque ou
  vitesse modifiée est rendu par le navigateur (WebCodecs) même quand le moteur
  natif est joignable, qui ne sait pas encore les rendre.

### 🐛 Corrigé

- Rogner le bord gauche d'un clip ralenti/accéléré avance désormais dans la
  source **à la vitesse du clip** (la durée maximale et le partage d'un clip
  tiennent compte de la vitesse et découpent les keyframes au bon endroit).
- Service worker : `VERSION` passe à `ctf2-v3`, ce qui purge les caches des
  versions précédentes dès l'activation.

### ⚠️ Limites connues

- Le **moteur Rust** (ffmpeg) ne rend pas encore keyframes / masques / vitesse :
  l'interface le dit et bascule sur le rendu navigateur. `needsBrowserRender()`
  est le point d'entrée unique de cette décision.

---

## [CUT THE FLOW 2 — studio web 2.1.0 / moteur 0.3.0] - 2026-10-21

### ✨ Ajouté

- **Annuler / rétablir** (`Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`) avec deux boutons
  dans la barre supérieure. Historique par instantanés du projet, plafonné à
  50 étapes et 6 Mo : un glissement de clip ou une rafale de curseur ne compte
  que pour **une** annulation.
- **Contrôle d'encodeur avant export** : si le navigateur ne sait pas encoder la
  combinaison choisie (typiquement 4K H.264), le dialogue l'annonce et grise
  « Export » au lieu d'échouer après vingt secondes de composition.
- `og:url`, `og:image`, `twitter:image` et `canonical` en **URL absolues**
  (`site` dans `astro.config.mjs`) : les robots de partage ne résolvent pas
  correctement les chemins relatifs.

### 🐛 Corrigé

- **Export figé à « Mixing audio… »** quand le projet contenait une vidéo sans
  piste audio (WebM, capture d'écran muette) : le repli de décodage MP4Box était
  tenté sur des conteneurs non-MP4 et n'appelait jamais son rappel. Le repli est
  désormais réservé aux fichiers ISO-BMFF (`ftyp`), avec un délai de garde.
- **« Annuler » d'export sans effet** : le signal d'abandon n'était pas consulté
  pendant le mixage audio.
- Le texte d'erreur et le lien `blob:` de l'export précédent ne traînent plus
  dans le DOM (masqués mais réapparaissait au dialogue suivant).
- Service worker : `VERSION` passe à `ctf2-v2`, ce qui purge les caches des
  versions précédentes dès l'activation.

---

## [CUT THE FLOW 2 — moteur 0.2.0] - 2026-10-21

Version du **moteur Rust** (la série 3.x ci-dessous reste celle de l'éditeur
navigateur v1). Les cinq binaires de `rust/dist/` sont produits à cette version.

### ✨ Barre supérieure et ergonomie

- Le logo seul remplace « logo + STUDIO » à gauche.
- Trappes et Export : plus de fond ni de contour, y compris au survol ; l'état
  actif se lit à la teinte de l'icône et à un point discret.
- Bandeau *Insérer* remonté au-dessus de la liste des médias.
- Temps du transport rangé en bas à droite, sur la ligne des boutons : barre
  plus basse d'une ligne.
- Bouton de rangement de la timeline (scène pleine hauteur) à gauche des zooms.

### 🐛 Corrections

- **Fondu enchaîné : trou noir et silencieux.** La fenêtre du clip entrant
  reculait de `d` sans s'allonger : le clip suivant, posé au contact d'origine,
  laissait `d` secondes de noir et de silence. La fenêtre recule **et**
  s'allonge de `d` (fin inchangée), côté Rust (`plan.rs`) et côté preview.
  Vérifié sur un export réel : 3,6 s et 3,8 s étaient à luminance 0, ils sont
  maintenant à ~129.
- **Preview : le dissolve ne se voyait pas.** La composition et le seek
  utilisaient `clip.start_us` au lieu du placement résolu ; deux clips d'une
  même piste sont désormais composés pendant le recouvrement.
- **Texte : taille exportée ≠ preview.** `fontsize` suit désormais l'échelle
  du clip, comme le fait déjà le canvas.

### 🌐 Version web — `app.zigmoon.com/CUTTHEFLOW`

- Le studio fonctionne **sans moteur** : l'interface détecte l'absence de
  `/api/health` et bascule en mode navigateur (badge « browser »).
- Import local : fichier sondé par les éléments média, stocké dans IndexedDB
  (survit au rechargement), vignette générée sur place.
- Export local : rendu partagé avec l'aperçu (`render.ts`), encodage WebCodecs
  image par image — MP4 (H.264 + AAC, mp4box.js), WebM (VP9 + Opus) et MP3
  (lamejs). Mixage `OfflineAudioContext`, donc déterministe.
- `base: '/CUTTHEFLOW'` : tous les liens sont préfixés, le site tient dans un
  sous-dossier ; `.htaccess` fourni (MIME du manifeste, cache des noms hachés).

### 🏗️ Construction

- `scripts/build.ps1` produit aussi macOS (Apple Silicon et Intel) par
  cross-compilation Zig (`cargo zigbuild`) quand `zig` et `cargo-zigbuild`
  sont présents.
- Vérifications : 31 tests Rust, `astro check` 0 erreur, banc d'export 45/45 ;
  exports navigateur contrôlés par ffprobe (MP4 180 images + AAC, WebM
  427 images VP9 + Opus, MP3 48 kHz stéréo).

---

## [3.10.1] - 2026-09-17

### 🧪 Banc de régression PERMANENT (`tools/regression/`) — le montage complet est rejouable

Nouveau dossier versionné (détails dans `tools/regression/README.md`) : il génère les médias
de test, pilote un **Chrome réel** par le protocole CDP (sans aucune dépendance npm), monte
une timeline **13 s / 5 pistes** (2 vidéos + 1 image + 1 texte + 1 forme + 2 pistes audio),
exporte dans les **3 formats**, enregistre le projet en `.ctf` **et** en `.json`, recharge la
page, les rouvre, puis vérifie tout avec **ffmpeg/ffprobe**.

```powershell
powershell -ExecutionPolicy Bypass -File tools/regression/make-media.ps1   # une fois
node tools/regression/montage.cjs            # tout (≈ 6 min)
node tools/regression/montage.cjs --quick    # export MP4 seul (≈ 2 min)
```

### 🔍 Débit d'export — mesuré poste par poste, et non plus « au doigt mouillé »

L'export d'un montage de 13 s prenait ~12 s : correct, mais il fallait savoir **pourquoi**.
L'instrumentation précédente était trompeuse (voir « piège de mesure » ci-dessous) : elle
accusait le dessin des overlays. Mesure refaite, cette fois par poste indépendant, sur
390 images à 1280×720 :

| Poste | Coût par image | Part du temps total |
|---|---|---|
| **Extraction de l'image (seek + `seeked`)** | **24,5 ms** | **≈ 80 %** |
| Envoi à l'encodeur (`encode()`) | 2,0 ms | 6 % |
| Rendu vidéo/image (`drawImage`) | 0,23 ms | 0,8 % |
| **Overlays (texte avec ombre + forme)** | **0,12 ms** | 0,4 % |
| `new VideoFrame(canvas)` | 0,06 ms | 0,2 % |

**Conclusion : le texte avec ombre, la forme, les filtres et la composition ne coûtent RIEN.**
Le seul poste qui compte est le **seek** : ~32 ms par seek, soit 300 seeks pour 390 images.
La piste d'optimisation n'est donc pas le rendu mais le **décodage** : passer d'un seek par
image à un **décodage séquentiel WebCodecs** (`VideoDecoder` + démuxeur, cf. mediabunny)
ramènerait ce poste à quelques millisecondes par image.

### 🐛 Piège de mesure : un « draw » qui accusait le texte à tort

La première instrumentation calculait `draw = (fin d'image − début du seek) − moyenne du seek`.
Sur la portion où le clip actif est une **image fixe** (aucun seek), ce calcul attribuait tout
le temps de l'image au « draw », et comme la moyenne du seek baissait, le « draw » **moyen
cumulé montait de 7 à 217 ms** — exactement pendant l'affichage du titre et de la forme.
Conclusion provisoire : « c'est le texte ». **C'était faux** ; une fois chaque poste mesuré
séparément : 0,12 ms. ⇒ **Toujours mesurer les postes qui ne se recouvrent pas, jamais par
soustraction d'une moyenne.**

### 🎯 Cadence source détectée par médiane (plus de « 29,97 » sur un fichier 30)

`detectVideoFps()` mesurait les intervalles et en prenait le minimum, ce qui annonçait
systématiquement la cadence **inférieure** la plus proche (un fichier 30 fps détecté 29,97).
Désormais : **médiane** des intervalles entre images présentées, puis alignement sur la
cadence standard la plus proche à **2 %** près, avec repli sur l'ancienne méthode si la mesure
n'est pas concluante. La cadence détectée sert à la timeline (et donc à l'export).

### 💾 Format d'export conservé avec le projet

- Le format choisi (MP4 / WEBM / MP3) est mémorisé dans `localStorage['ctf_export_format']`
  et **restauré au chargement**.
- Les fichiers de projet `.ctf` **et** `.json` contiennent maintenant `appVersion` et
  `selectedFormat` ; ils sont relus au chargement (les anciens projets restent compatibles).
- `loadProject()` a été scindé : `loadProject()` (dialogue de sélection de fichier) et
  `loadJsonProject(file)` (symétrique exact de `loadCtfProject`, réutilisable par le banc).

### 🛡️ Deux blocages silencieux supprimés

**1. L'encodeur bloqué ne fait plus patienter sans fin.** La boucle d'attente de l'encodeur
(`while (encoder.encodeQueueSize > 4)`) attendait **sans limite**. Si l'encodeur matériel se
bloquait (« Codec reclaimed due to inactivity »), elle tournait indéfiniment : l'interface
restait réactive, la barre de progression se figeait, et l'export ne se terminait **jamais**.
Elle échoue maintenant au bout de **20 s**, avec un message explicite (nombre d'images en
attente, image courante, suggestion de désactiver l'accélération matérielle).

**2. Onglet en arrière-plan : l'export était gelé, sans aucun message.** Constaté au banc : un
export laissé dans un onglet non visible **s'arrête net** (figé précisément à **271 images sur
390**) et ne reprend jamais. La cause n'est pas l'application : Chrome bride les `setTimeout`
des onglets cachés à **1 seconde**, puis **gèle** l'onglet — or les moteurs rendent la main
entre chaque image par `setTimeout`. Comme le thread est simplement suspendu, **aucune erreur
n'est levée** : ni le garde-fou ci-dessus, ni le moindre `catch` ne s'exécutent. Un bandeau
prévient désormais l'utilisateur au lancement de l'export et à chaque passage en arrière-plan
(« Gardez cet onglet visible… »).

### ✅ Mesures de référence validées par le banc (13 s / 5 pistes / 1280×720) — **29/29**

| Mesure | MP4 | WEBM | MP3 |
|---|---|---|---|
| Durée d'export | 12,1 s | 12,3 s | 1,4 s |
| Images | **390 / 390** | **390 / 390** | — |
| Codecs | h264 + aac 48 kHz 2ch | vp9 + opus 48 kHz 2ch | mp3 48 kHz 2ch |
| Repère `880 Hz` (a.mp4) | **2,000 → 4,000 s** | identique | identique |
| Repère `1500 Hz` (beep) | **6,000 → 9,000 s** | identique | identique |
| Repère `1200 Hz` (b.mp4) | **début 9,000 s** | identique | identique |
| Écart de synchro vs MP4 | — | **0 ms** | **0 ms** |

- Extraction : **300 seeks, 0 duplication, 0 saut, erreur d'image 0,0 ms** sur les trois formats.
- **Fidélité** : les 177 premières images de l'export MP4 comparées à la source `a.mp4`
  (0 → 5,9 s, avant tout overlay) donnent **0 image différente**, écart max **1/255**.
- Aucune image noire aux deux coupes (luminance **41** et **130** sur 255).
- Ordre des calques vérifié : forme bleue **174** de dominante bleue quand elle est affichée,
  **−85** sinon ; texte blanc détecté (luminance **max > 200/255** au centre).
- Aller-retour projet `.ctf` **et** `.json` : 5 pistes / 7 clips / 5 médias reliés, et le
  **format d'export restauré** (le banc efface volontairement `ctf_export_format` du
  `localStorage` avant de recharger, sinon le test validerait le localStorage et non le fichier).

### 🎨 Design — moins de gris, plus de noir franc (demande utilisateur)

L'interface donnait une impression « délavée » : la barre du haut, les panneaux et les fonds de
piste étaient des gris sombres (`#0a0a0a`, `#0d0d0f`) au lieu de noir. Passage au **noir franc** :

- Barre du haut, barre du bas (contrôles), ruler, panneau MÉDIA, panneau PROPRIÉTÉS, timeline et
  fonds de piste : `#000000`.
- **L'alternance de fond entre pistes paires et impaires a été supprimée** (demande
  utilisateur : « je veux partout le fond noir sur les tracks comme le 1 ou le 3 »).
  ⚠️ Au passage, un **vrai bug** a été trouvé : la règle des pistes paires utilisait le
  **raccourci `background:`**, qui **effaçait la grille temporelle** posée par
  `background-image`. Mesuré dans Chrome sur un montage de 5 pistes : les pistes 1/3/5
  affichaient `background-image: linear-gradient(...)` + `rgb(10,10,10)`, alors que les pistes
  **2 et 4** affichaient `background-image: none` + `rgb(13,13,15)` — un aplat uni, un peu plus
  clair et légèrement **bleuté** (composante bleue supérieure : B=15 contre R=G=13), sans aucun
  repère vertical. C'était exactement la « piste 2 avec un fond bleu foncé opaque ». Désormais
  les 5 pistes sont identiques : `rgb(0,0,0)` + grille.
- **Les lignes de la timeline ont été adoucies** (2ᵉ retour utilisateur : « les lignes de la
  timeline des track sont trop claires, trop voyantes »). Mon premier passage les avait
  **éclaircies** (`#1a1a1a` → `#232328`) en pensant bien faire : sur du noir pur, ce trait
  devenait un repère appuyé. Nouvelles valeurs, mesurées dans Chrome :
  séparation de piste `#131317` (au lieu de `#232328`), séparateur de la colonne des noms
  `#131317` (au lieu de `#1e1e1e`), graduations de la règle `#1f1f23` / `#131317` (au lieu de
  `#2a2a2a` / `#1a1a1a`), grille temporelle `3 %` de blanc (au lieu de 4,5 %).
- **Le survol reste le seul écart de fond** dans la timeline (fond `#0d0d12`, focus `#121219`) :
  c'est lui qui permet de suivre la piste sous le curseur, pas les traits.
- Les boutons **M** (muet) et **S** (solo) de chaque piste sont désormais **en contour seul sur
  fond transparent** (bordure `#2f2f33`, texte `#7c7c86` ≈ 4,7:1 — conforme AA). Les états
  actifs gardent leur remplissage coloré (rouge / orange) : ce sont des états à ne pas manquer.
- Le survol de piste reste signalé (fond `#0d0d12`, focus `#121219`).
- **La teinte de survol pendant un glisser ne reste plus collée.** `dragover` écrivait un
  **style inline** (`background: rgba(102,126,234,.2)`) que seuls `dragleave` et `drop`
  effaçaient : si le glisser se terminait ailleurs (dépôt hors piste, glisser annulé,
  onglet qui perd le focus), la piste gardait un **fond bleu permanent**. L'état est
  désormais porté par la classe `.drop-target`, nettoyée sur `dragend`, `drop`, `blur`,
  `Échap` et à chaque rendu des pistes. Vérifié : fond bleu pendant le survol, 0 élément
  marqué après `dragend`, retour à `rgb(0,0,0)`.
- **Accès à `dataTransfer` sécurisés** : un `DragEvent` peut n'en avoir aucun (événement
  synthétique) et l'exception remontée interrompait le glisser. Les gestionnaires passent
  par `dtFiles(e)` / `dtHasFiles(e)`.

Vérifié dans Chrome : `background-color` calculé = `rgb(0, 0, 0)` sur la barre du haut, la
timeline et **les 5 pistes** du montage de contrôle, avec la grille temporelle présente sur
chacune ; bouton M = fond `rgba(0,0,0,0)` + bordure `rgb(47,47,51)`.

### 🧹 Pop-in de soutien supprimée, installation PWA rendue au navigateur

Demande utilisateur : « supprime la pop de soutien », « supprime la pwa dans la top nav — on va
la garder accessible en classique par défaut dans la barre Chrome ».

- **La pop-in de soutien a été retirée** du produit : plus de fenêtre « Install the App — €24 »,
  plus de bouton PayPal, plus de champ de code promo, plus de drapeau `ctf_donated_v1`. Le HTML
  (≈ 40 lignes), le CSS (≈ 200 lignes) et le JavaScript (≈ 130 lignes : `loadPaypalSdk`,
  `triggerPwaInstall`, la porte de paiement) sont supprimés, ainsi que le script
  `donate-popin.js` qui n'était plus référencé.
- **Le bouton d'installation a été retiré** de la barre du haut ET du menu mobile, avec son style.
- **L'installation redevient celle du navigateur** : le script ne fait plus
  `e.preventDefault()` sur `beforeinstallprompt` — c'est précisément ce qui la rendait impossible
  sans passer par le bouton de l'app. Chrome et Edge proposent désormais leur propre invitation
  dans la barre d'adresse. Le `manifest.json` et le service worker sont **conservés** : ils sont
  nécessaires à cette installation native et au fonctionnement hors-ligne.
- Le **toast de mise à jour** du service worker (« Update available — Reload ») est conservé :
  il informe l'utilisateur qu'une nouvelle version est prête.

### 📜 Licence propriétaire (le projet n'est plus sous MIT)

Le projet était présenté comme « MIT » et « 100 % free and open source » dans son README, alors
qu'il est vendu (application installable, builds sur mesure). Le README pouvait donc laisser
croire à une autorisation de copie et de revente.

- Nouveau fichier **`LICENSE`** : licence **propriétaire, tous droits réservés** (Simon Dupont /
  Zigmoon). Elle **autorise** l'usage de l'application web et rappelle que **les vidéos produites
  appartiennent à l'utilisateur**, et **interdit** sans autorisation écrite : copier,
  redistribuer, revendre, héberger, modifier, créer des œuvres dérivées, retirer les mentions de
  copyright, ou réutiliser le code pour entraîner ou construire un produit concurrent.
- README : badge « MIT » → « Proprietary », section Licence réécrite, résumé final corrigé
  (plus de « 100 % free and open source »).
- `index.html` : `<meta name="copyright">`, `<link rel="license">` et, dans les données
  structurées, `copyrightHolder` / `copyrightYear` / `license`.
- `llms.txt`, `llms-full.txt` (section 12) et `humans.txt` : sections Licence mises à jour.
- Les bibliothèques tierces (`vendor/` : JSZip, MP4Box.js, lamejs) et les polices **gardent leurs
  propres licences**, qui prévalent pour les parties qu'elles couvrent.

### 🖼️ Vignettes d'aperçu sur les clips de la timeline — elles étaient générées mais invisibles

Le JavaScript créait bien une vignette et le badge de durée de chaque clip vidéo/image,
mais **aucune règle CSS** ne stylait `.clip-thumb-surface` ni `.clip-thumb-meta` : sans
`position` ni dimensions, ces éléments faisaient 0 × 0. D'où l'impression qu'il n'y avait
aucun aperçu.

**Mise en forme retenue après deux essais.** Le premier répartissait plusieurs images sur toute
la largeur du clip : une vignette de 60 px étirée sur 500 px devenait méconnaissable. Le
deuxième la répétait en mosaïque (`repeat-x`) : effet « pellicule » bruyant. La version finale,
celle retenue :

- **une seule image par clip**, posée **au début** (à gauche), **à sa taille naturelle**
  (`background-size: auto 100%`, `no-repeat`) — aucune déformation, aucune répétition, et le
  fond du clip reste lisible pour son nom et sa durée ;
- c'est l'image la plus proche du **début du clip** : si le début a été rogné (`sourceStart`),
  on montre la bonne image, pas celle de 0 s ;
- `.clip-thumb-meta` : durée, `+sourceStart` et `%scale` en bas à droite sur pastille sombre ;
- le voile de teinte des clips passe de **45 % à 22 %** (à 45 %, il noyait l'aperçu).

**Vignettes générées au bon rapport.** Elles étaient dessinées dans un cadre fixe de 60×62 :
une vidéo 16:9 n'y occupait que 60×34, donc la vignette affichée gardait des **bandes noires**.
La hauteur est maintenant imposée (celle du clip, 62 px) et la largeur suit le rapport de
l'image — mesuré : **110×62** pour du 16:9. Une image toutes les 2,5 s (8 maximum), en JPEG
qualité 0,28 : **≈ 1,9 Ko par vignette**, soit moins de 6 Ko par média. Vérifié sans étirement
sur des clips de 539, 359 et 269 px, ainsi que sur un clip très court (89 px), où la vignette
est simplement rognée par le clip.

### 🐛 Dézoom : les numéros de temps disparaissaient

- `getMinZoomLevel()` plafonnait le dézoom à **5 px/s** : un montage de 14 s pouvait être écrasé
  à **109 px de large**, avec **une seule étiquette « 00:00 »** à l'écran. Nouvelle formule :
  `Math.max(0.05, Math.min(fitZoom / 3, 60))` — le montage occupe au minimum un tiers de la
  largeur visible.
- `renderRuler()` ne dessinait que jusqu'à `timelineEnd × zoomLevel` : dès que la largeur visible
  dépassait le montage, les repères s'arrêtaient au milieu de l'écran. Il couvre maintenant
  `max(timelineEnd, (scrollLeft + viewport × 1,3) / zoomLevel)` et choisit un intervalle
  « nice » visant **120 px** par étiquette (sous-graduations plafonnées pour ne pas noircir la
  règle), avec format `h:mm:ss` au-delà d'une heure.
- Vérifié en conditions réelles : après 12 dézooms, **6 étiquettes restent visibles** (00:00 →
  00:50) au lieu d'une seule.

### 🎧 Les trois moteurs d'export partagent maintenant le même audio

`mp3-export.js` rééchantillonnait par **interpolation linéaire** (le plus proche voisin créait un
souffle audible), mais `webcodecs-export.js` (MP4) et `webm-webcodecs-export.js` (WebM) faisaient
toujours `Math.round(s * srcSR / AUDIO_SAMPLE_RATE)` = **plus proche voisin**. Une source 44,1 kHz
(vidéo de téléphone, musique MP3/AAC — le cas le plus courant) sonnait donc différemment en MP4 et
en MP3. Les trois moteurs partagent désormais la **même** enveloppe de fondu (linéaire) et la
**même** interpolation.

### ✅ Contrôle global rejoué après ces corrections

`node tools/regression/montage.cjs` → **29/29 vérifications réussies** : durée et 390 images à
30 fps, synchro son/image mesurée par fréquence repère, aucune image noire aux coupes, ordre des
calques, export MP4 + WebM + MP3, enregistrement `.ctf` et `.json`, puis réouverture des deux.
Les écarts de synchro mesurés **entre** les trois formats sont de **0 ms** partout (repères 880 Hz
2→4 s, 1500 Hz 6→9 s, 1200 Hz dès 9 s).

Cache-busters bumpés : `app.js?v=20260917e`, `style.css?v=20260917f`,
`webcodecs-export.js?v=20260917c`, `webm-webcodecs-export.js?v=20260917b` (dans `index.html` **et**
dans `APP_SHELL`), et `CACHE_NAME` → `cuttheflow-shell-v3.10.1-r2` pour que les anciens caches
soient purgés à l'activation du service worker.

### 📊 Effets et fondus remesurés — le fondu est parfait, l'effet est gratuit

Clip de 3 s (fondu entrant et sortant de 1 s), 90 images en 640×360 à 30 fps, export réel :

| Effet | Temps d'export | Écart |
|---|---|---|
| aucun | 4 809 ms | référence |
| invert | 4 219 ms | −12 % |
| pixelate | 4 466 ms | −7 % |
| blur | 4 623 ms | −4 % |
| glitch | 4 729 ms | −2 % |
| **vhs** | **5 802 ms** | **+21 %** |

Les écarts négatifs sont du **bruit de mesure** (le seek domine) : `pixelate`, `blur`, `invert` et
`glitch` ne coûtent **rien**. Seul `vhs` (grain + balayage + gigue sur chaque pixel) pèse encore.

Courbe de fondu mesurée **dans le fichier exporté** : entrant `0 → 30 → 64 → 94 → 125` puis 128,7
au milieu ; sortant `128,8 → 98,8 → 64,5 → 4,5`. Le fondu est bien **linéaire**, du noir à l'image
pleine et retour.

---

## [3.10.0] - 2026-09-16

### 🎯 LE DÉCALAGE SON/IMAGE EST CORRIGÉ — cause racine mesurée et prouvée

**Symptômes signalés :** *« décalage entre le son et la vidéo, enchaînement des séquences non
fluide avec parfois des noirs entre les vidéos, vidéos sacadées »*.

**Mesure de la cause (Chrome 153, banc `_bench/`) :** l'extraction d'images des moteurs
offline utilisait la stratégie « laisser la vidéo jouer et dessiner ce qui est là ». Or la
vidéo joue en **temps réel (1×)** pendant que la boucle d'export tourne forcément plus
lentement : le décodeur prend de l'avance et le code dessine l'image disponible — donc une
image située **jusqu'à 2 secondes** dans le futur de la timeline. L'audio, lui, est exact :
d'où le décalage entendu ET les saccades.

| Mesure sur un montage 1080p30 (coût de rendu réaliste) | Avant | Après |
|---|---|---|
| Erreur image ↔ timeline, **moyenne** | **878 ms** | **0,0 ms** |
| Erreur image ↔ timeline, **maximum** | **2080 ms** | **0,0 ms** |
| Images **dupliquées** / **sautées** (60 seeks) | 20 / 19 | **0 / 0** |
| Cadence réelle du contenu | **20 fps** au lieu de 30 | **30 fps** |
| Fidélité pixel de la séquence exportée | — | **écart 0/255 sur 180/180 images** |
| Bascules audio vs timeline (montage 10 s) | — | **2,005 / 4,005 / 6,005 s** (±5 ms, **dérive 0**) |
| Luminance à la coupe entre 2 clips | noir possible | **130/255 → aucune image noire** |

**Nouveau module `js/frame-source.js`** (classe `CTFFrameSource`) : une source par clip,
laissée **EN PAUSE**, dont la frame est extraite par **seek exact** (`currentTime` + attente
de `seeked`), soit 33,9 ms/frame en médiane à 1080p (19,2 ms à 720p) — donc **être exact ne
coûte rien**.

### 🐛 Pourquoi une image sur trois était la mauvaise (bug Chrome + correctif)

Le banc `_bench/bench.html` (test `sequence`) demande 60 seeks consécutifs sur des temps
**exactement sur une frontière de frame** (`k/30`). Relevé des images réellement présentées :

```
images présentées : 0, 1, 1, 3, 4, 4, 6, 7, …
deltas (en frames) : {0: 20, 1: 20, 2: 19}   ← 20 duplications + 19 sauts
erreurs            : {0 ms: 40, −33,3 ms: 20}
```

Chrome tombe donc sur l'image **précédente** une fois sur trois quand la cible tombe pile
sur une frontière. **Correctif : viser le MILIEU de l'intervalle d'affichage de la frame
voulue** (`t + min(durée frame source, durée frame sortie) / 2`) au lieu de son début.
Relevé identique après correctif : `deltas = {1: 59}` et `erreurs = {0 ms: 60}` — **aucune
duplication, aucun saut, aucune erreur**. C'est ce qui supprime définitivement les saccades.

### 🐛 Bugs internes trouvés au passage

1. **Estimation de la durée de frame source impossible à corriger.** Elle était calculée par
   `Math.min(valeurInitiale, écart)` : partant de 1/60 s, elle ne pouvait **jamais augmenter**
   → la détection de cadence annonçait des chiffres absurdes (58 duplications + 121 sauts sur
   180 images, impossible). Remplacée par le **10ᵉ centile** des 60 derniers écarts observés.
2. **`switchExportMode()` / `selectEncoder()` écrivaient dans le DOM sans garde.** La seconde
   levait une exception dès que les cartes « moteur » disparaissaient de l'interface.
3. **`showHardwareRecommendations()` injectait une bannière dans la popin d'export**
   (résidu de l'étape « YOUR DEVICE ») — supprimé avec les onglets.
4. **Les boutons « Native / Custom FPS » appelaient `app.selectNativeFps()` et
   `app.setCustomFps()`, deux méthodes qui n'existaient pas** → cliquer dessus levait une
   erreur. Remplacés par les listes de la popin simplifiée.
5. **Horodatages des frames calculés par accumulation** (`n × (1e6/fps)` flottant, et
   `n × ticksPerFrame` entier à timescale fixe) : l'erreur s'accumulait sur les longues
   timelines et sur les cadences non entières (29,97 / 59,94). Désormais **arrondi direct de
   l'index** (`round(n × 1e6 / fps)`, `round(n × 90000 / fps)`), et la durée transmise est
   l'écart avec la frame suivante.

### 🖥️ Aperçu timeline : plus de trou noir entre les séquences

**Symptôme signalé :** *« manque de fluidité en preview dans la timeline entre les séquences »*.

Un **seul** élément `<video>` servait tous les clips : à chaque coupe il fallait changer sa
source, attendre le décodage à froid, puis le réafficher (`_ctfRevealAfterSeekAt = now + 180 ms`)
→ **~180 ms de noir** et un micro-blocage sur *chaque* séquence.

**Double tampon** : un second lecteur (`#previewVideoB`) précharge et **pré-positionne** le
clip suivant (muet, caché, mis en lecture 0,7 s avant la coupe). Au changement de séquence, on
ne fait que **permuter l'affichage** : la première image est déjà décodée.

| Mesure pendant la lecture (coupe à 6,000 s) | Avant | Après |
|---|---|---|
| Images sans vidéo affichée autour de la coupe | noir visible | **0** (sur 30 relevés) |
| Cadence de l'aperçu (écart max entre frames) | — | **16,7 ms (60 fps)** |
| Lecteur utilisé | 1 | **2 (permutation effective constatée)** |

> ⚠️ Corrigé aussi : la cadence de préchargement était de **1 s** alors que la fenêtre de
> pré-roulage est de 0,7 s — un clip sur trois n'était donc jamais préchargé. Passée à **250 ms**.

### 🎛️ Popin d'export : 3 choix, zéro onglet, zéro sous-partie

**Demande :** *« simplifier les exports en proposant 3 exports principaux sans sous parties et
sans les onglets complexes de la popin exporté »*.

**Supprimé :** les onglets **AUTOMATIC / SIMPLE / ADVANCED**, les **5 cartes « moteur
d'export »** (Unifié / VP9+Opus / H.264+AAC / Canvas / Natif), l'étape « YOUR DEVICE » et la
bannière de recommandations matérielles.

**Remplacé par 3 cartes** + 2 listes (résolution, images/seconde) :

| Format | Moteur | Contenu |
|---|---|---|
| **MP4** | WebCodecs H.264 + AAC | Le plus universel (iPhone, Android, TV, réseaux sociaux) |
| **WEBM** | WebCodecs VP9 + Opus | Plus petit à qualité égale, idéal web et longs montages |
| **MP3** | **LAME 3.100** (nouveau) | La bande son seule (48 kHz stéréo, 192 kbps) |

Le **moteur découle du format** : il n'est plus un réglage de l'utilisateur, ce qui supprime
toute possibilité de fichier incohérent (avant, on pouvait demander « VP9+Opus » puis « MP4 »
et obtenir un WebM). Un format indisponible sur le navigateur reste **visible avec la raison**
au lieu d'être silencieusement absent, et le clic bascule automatiquement sur un format
utilisable.

### 🎵 Nouveau moteur MP3 (LAME)

`js/mp3-export.js` + `vendor/lamejs.min.js` (LAME 3.100, le même encodeur que ffmpeg/Audacity —
ce n'est **pas** un ré-encodage d'AAC ou d'Opus). Même lecture de timeline que les moteurs
vidéo (volume de piste, fondus, audio détaché, bornes temporelles) et **rééchantillonnage par
interpolation linéaire** (l'ancien plus-proche-voisin des moteurs vidéo soufflait sur les
sources 44,1 kHz).

Compensation du **délai de codage MPEG-1 Layer III** (~1105 échantillons ≈ 23 ms, non annoncé
faute d'en-tête Xing) : mesuré en comparant les bascules de fréquence du MP4 et du MP3 —
avant **2,025 / 4,025 / 6,025 s** (+20 ms) → après **2,005 / 4,005 / 6,005 s**, soit
**identiques au MP4**.

### ✅ Vérifié sur les trois formats (mêmes repères audio, Chrome 153)

| | MP4 | WEBM | MP3 |
|---|---|---|---|
| Codecs | h264 1920×1080 + aac 48 kHz 2ch | vp9 1920×1080 + opus 48 kHz 2ch | mp3 48 kHz 2ch |
| Images | **300 / 300** | **300 / 300** | — |
| Bascules audio | **2,005 / 4,005 / 6,005** | **2,005 / 4,005 / 6,005** | **2,005 / 4,005 / 6,005** |
| Dérive | **0 ms** | **0 ms** | **0 ms** |

### 🤖 Assistant IA — DeepSeek 4.1 Flash en premier, modèles à jour

- **DeepSeek est désormais le premier fournisseur** (et le fournisseur par défaut), avec
  `deepseek-flash` = **DeepSeek-V4.1-Flash** sélectionné d'office (1 M de contexte, JSON, tool
  calls, vision). `deepseek-v4-pro` reste disponible. Les anciens noms (`deepseek-chat`,
  `deepseek-v4-flash`) sont retirés côté DeepSeek — ils ne sont plus proposés.
- **Modèles actualisés** : OpenAI `gpt-5.1 / gpt-5 / gpt-5-mini / gpt-4.1 / o3 / o4-mini` ·
  Anthropic `claude-opus-4-5 / sonnet-4-5 / haiku-4-5` · Google `gemini-2.5-pro / flash / flash-lite`.
- **Deux fournisseurs ajoutés : OpenRouter et Groq**, avec leurs modèles **gratuits**
  (suffixe `:free` côté OpenRouter) — de quoi utiliser l'assistant sans frais.
- **Une clé API par fournisseur** (avant : une seule clé globale réutilisée à tort après un
  changement de fournisseur). L'ancienne clé globale reste lue en repli.
- **Un seul code d'appel** pour tous les fournisseurs « OpenAI-compatibles »
  (DeepSeek / OpenRouter / Groq / OpenAI) : gère les modèles de raisonnement
  (`max_completion_tokens`, pas de `temperature`) et **réessaie automatiquement sans les
  paramètres optionnels** si un modèle refuse `response_format`.
- **Parsing JSON durci** : les réponses entourées de ```json … ``` ou précédées de texte sont
  nettoyées (objet JSON équilibré extrait, virgules finales tolérées).
- L'étiquette « Model » / « API Key » et le lien vers la page de création de clé suivent le
  fournisseur choisi.

---

## [3.9.9] - 2026-09-10

### 🚀 FX : suppression des allocations de canvas par frame (+50 % sur les effets lourds)

**Symptôme signalé :** *« les FX et fade sont super lourds en preview et export »*.

`applyClipEffectToCanvas()` est appelée **pour chaque frame** de l'export (des milliers de fois
sur un montage réel). Cinq branches FX faisaient `document.createElement('canvas')` **à chaque
appel** : `pixelate`, `invert`, `blur`, `shake`, `mirror`. Un canvas 1920×1080 pèse ~8 Mo : on
allouait donc plusieurs gigaoctets cumulés et on déclenchait le ramasse-miettes **en pleine
boucle d'encodage**.

**Correctif :** nouveau pool `_fxScratch(role, w, h)` qui réutilise un canvas par besoin et ne le
redimensionne que si la taille change vraiment. Plus **aucune allocation canvas par frame**.

**Coût mesuré de chaque effet** (clip 1,5 s en 1280×720 à 30 fps, Chrome 152 réel) :

| Effet | Avant / référence | Après |
|---|---|---|
| **aucun FX** (référence) | 2447 ms | **2447 ms** |
| **pixelate** | allouait un canvas par frame | **2448 ms — coût nul** ✅ |
| invert / blur / shake / mirror | allouaient un canvas par frame | 2486–2597 ms (**+2 à +6 %**) |
| scanlines / glitch | — | 2510 / 2714 ms |
| duotone / teal-orange / rgb-split | — | 3028–3091 ms |
| **vhs** | — | **4157 ms (+70 %)** ⚠️ |
| **noise** | — | **3722 ms (+52 %)** ⚠️ |

> `vhs` et `noise` restent les deux effets les plus coûteux : ils appliquent un grain aléatoire
> **pixel par pixel sur toute l'image** (1,4 million d'appels `Math.random()` par frame). C'est
> intrinsèque à l'effet ; ils restent utilisables mais doivent être réservés aux plans courts.

### 🐛 Glitch : traînées cumulatives absentes de l'aperçu

Le déplacement des bandes lisait `data[srcIdx]` **après** avoir écrit dans `data` : chaque bande
relisait des pixels déjà décalés par la précédente, produisant des traînées horizontales qui
n'existaient pas dans l'aperçu (le CSS, lui, décale le calque d'origine). Le déplacement se fait
désormais depuis une copie intacte → **rendu d'export identique à l'aperçu**.

### 🐛 Timeline : les numéros de temps se décalaient au zoom

**Symptôme signalé :** *« quand je zoom/dézoom avec l'outil ou la molette, je perds les petits
numéros (timestrack) de la timeline »*.

**Cause :** le ruler était un **second conteneur défilant**, synchronisé par
`rulerContent.scrollLeft = timelineScroll.scrollLeft`. Or les deux n'ont pas la même largeur
défilable (le ruler n'a pas les 120 px d'en-tête de piste) : son maximum de défilement était
**inférieur de 20 à 130 px** à celui des pistes. En zoomant/dézoomant loin dans la timeline, le
ruler butait sur son maximum et **se décalait des clips** — les numéros ne correspondaient plus.

**Correctif :** le ruler ne défile plus de façon autonome ; son contenu est **translaté** du même
nombre de pixels que les pistes (`_syncRulerScroll`). Alignement garanti au pixel près.

| Mesure | Avant | Après |
|---|---|---|
| Écart numéros ↔ clips, zoom 50 | 0 px | **0 px** |
| Après 10 dézooms consécutifs | **126 px** ❌ | **0 px** ✅ |
| Après 6 zooms | décalage persistant | **0 px** ✅ |
| En butée de défilement (fond) | **126 px** ❌ | **0 px** ✅ |

### 🐛 Service worker : liste de precache figée et install fragile

1. **Liste obsolète.** `APP_SHELL` référençait les anciens `?v=` (figés à `20260717a`,
   `app.js?v=20260714b`, `style.css?v=20260713`, `mp4box?v=07ccf31d12`). Le service worker
   précachait donc **d'anciennes versions** des fichiers, et la liste ne suivait plus les
   déploiements. Elle est désormais alignée sur `index.html`.
2. **`install()` fragile.** Un `throw` sur **un seul** asset en échec faisait échouer tout
   `install()`, donc le service worker **ne s'activait jamais** et l'app perdait tout le
   bénéfice hors-ligne. Passage à `Promise.allSettled()` : on met en cache ce qui est possible
   et on journalise les échecs — l'app reste installable même si une police manque.

### ✅ Vérifié : l'export est correct avec FX **et** fade

Clip avec `pixelate` (intensité 100) + `fadeIn` 1 s + `fadeOut` 1 s, exporté en MP4 :

- **Durée 4.000000 s**, **120 frames** (4 s × 30 fps) — exact.
- **Fondu entrant** : luminance 0,012 → 0,503 sur 0→1 s, progression **linéaire**, démarre au noir.
- **Fondu sortant** : 0,504 → 0,028 sur la dernière seconde, décroissance **linéaire**, finit au noir.
- **Effet appliqué** : écart moyen 8,0/255 et image nettement plus « plate » que la source
  (91,8 % vs 88,5 %) — signature de la pixelisation.
- **Non-régression** : les **12 effets** exportent tous sans erreur après la refonte du pool.

**Cache-busters :** `js/app.js?v=20260910i`, `css/style.css?v=20260910i`

---

## [3.9.8] - 2026-09-10

### 🐛 CORRECTIF — l'audio WebM était **désynchronisé de 74 ms** (et le fichier plus court que la vidéo)

**Symptôme signalé :** *« re-teste l'audio la qualité suite à nos modifications du
"Separate Audio and video" (l'outil à droite du cut), cela doit être parfait dans la
timeline et en export. »*

**Verdict : le son était correct en niveau, mais DÉCALÉ dans le WebM.**
Test avec deux vidéos AVEC son (440 Hz sur fond rouge, 880 Hz sur fond vert), séparation
de l'audio via l'outil, puis export dans les deux moteurs.

| Moteur | Niveau par canal (source = −21,08 dB) | Erreur de synchro |
|---|---|---|
| **MP4 (H.264 + AAC)** | ✅ **−21,08 dB** (exact) | ✅ −9 ms |
| **WebM (VP9 + Opus)** avant | ✅ −21,14 dB | ❌ **−83 ms** + fichier audio 7,94 s au lieu de 8,00 s |

**Cause racine — en-tête Opus reconstruit à la main :**

Le muxeur fabriquait lui-même la boîte `OpusHead` (`CodecPrivate`) avec un `preSkip`
**figé à 3840 échantillons (80 ms)**. Or l'encodeur Opus de Chrome utilise **312**
échantillons (6,5 ms) — vérifié en interrogeant directement le navigateur :

```
OpusHead réel de Chrome : 4f 70 75 73 48 65 61 64 01 02 38 01 80 bb 00 00 00 00 00
                                          ↑↑ preSkip = 0x0138 = 312 (6,5 ms)
```

Le `preSkip` indique au décodeur **combien d'échantillons jeter au début** (amorçage de
l'encodeur). Déclarer 3840 au lieu de 312, c'est en jeter **3528 de trop** (73,5 ms) :
tout l'audio démarrait trop tôt et la fin était rognée d'autant.

Mesure objective, par détection de la bascule 440 → 880 Hz (fenêtre glissante 20 ms) :

| Fichier | Bascule mesurée | Erreur |
|---|---|---|
| MP4 (référence) | 4,991 s | −9 ms |
| WebM **avant** | **4,917 s** | **−83 ms** |
| WebM **après** | **4,991 s** | ✅ **−9 ms** |

**Correctif :** on transmet désormais l'`OpusHead` **réel** fourni par l'encodeur
(`metadata.decoderConfig.description` dans le callback `AudioEncoder.output`) au muxeur
via `opusHead:`. `buildOpusHead()` ne sert plus que de repli, avec la bonne valeur 312.

Résultat après correctif : **audio 8,0135 s** (au lieu de 7,94 s), synchro **identique au
MP4 (−9 ms)**, contenu conforme (440 Hz pur sur 0,2→4,9 s, transition à 4,9→5,1 s,
880 Hz pur sur 5,1→7,9 s, aucun trou).

### 🛡️ Robustesse de l'outil « Separate Audio and video »

- **Double appel bloqué.** Un 2ᵉ appel de `unlinkAudio()` créait un **second clip audio**
  sur la même plage : la piste était jouée deux fois, soit **+6 dB** et de la saturation.
  L'outil refuse maintenant si `audioUnlinked` est déjà vrai (vérifié : 3 appels
  successifs = 1 seul clip, niveau final −21,08 dB inchangé).
- **Qualité source garantie sur les 3 chemins.** L'outil existe en trois endroits dans
  `app.js` (barre d'outils, action IA `UNLINK_AUDIO`, chemin interne). Le chemin IA
  utilisait `clip.url`, qui peut pointer sur un **proxy basse qualité** ; il utilise
  désormais `media.originalUrl` comme les deux autres.

**Cache-busters :** `js/app.js?v=20260910h`, `js/webm-webcodecs-export.js?v=20260910h`

---

## [3.9.7] - 2026-09-10

### 🐛 CORRECTIF CRITIQUE — les clips étaient **décalés d'une frame** dans tous les MP4

**Symptôme signalé :** *« tu as testé dans la timeline avec un montage multi-track bien précis,
c'est calé en export ??? »*

**Verdict : non.** Avec un montage conçu pour être vérifiable image par image
(vidéos de couleur unie, overlay au premier plan, 2 pistes audio), le MP4 exporté
présentait **deux défauts systématiques** :

| Défaut | Mesure |
|---|---|
| **Décalage de −1 frame** sur toutes les bornes | la 2ᵉ frame du fichier portait `dts = 0` |
| **Dernière frame manquante** | 299 frames au lieu de 300, durée 9.984 s au lieu de 10.000 s |

**Cause racine — bug dans `vendor/mp4box.all.min.js` (MP4Box.js 19-03-2022) :**

```js
t.first_dts || (t.first_dts = r.dts)   // ❌ buggé
```

`addSample()` mémorise le premier DTS de la piste avec l'opérateur `||`. Or la toute
première frame d'un export a `dts = 0`, qui est **falsy** en JavaScript : la variable
`first_dts` était donc **réassignée à chaque sample**. Résultat, dans
`createSingleSampleMoof()` :

```js
r.add("tfdt").set("baseMediaDecodeTime", t.dts - (s.first_dts || 0))
```

`baseMediaDecodeTime` valait **toujours 0** pour chaque fragment, les deux premières
frames se retrouvaient au même timestamp et **toute la piste glissait d'une frame**.

> ✅ Preuve d'isolation : le bug a été **reproduit hors navigateur**, avec MP4Box seul en
> Node et 300 samples factices — décalage identique. Ce n'était donc **pas** notre code.

**Correctif (appliqué dans le vendor) :**

```js
void 0 === t.first_dts && (t.first_dts = r.dts)   // ✅ teste l'absence, pas la valeur
```

**Résultat mesuré après correctif** (montage : ROUGE 0-5 s / VERT 5-10 s en arrière-plan,
JAUNE 2-4 s en overlay premier plan, 440 Hz 0-6 s, 880 Hz 1-3 s) :

| Moteur | Fichier | Durée | Frames | Alignement |
|---|---|---|---|---|
| **MP4 (H.264 + AAC)** | `moov` + fragments | **10.005 s** | **300** | ✅ exact |
| **WebM (VP9 + Opus)** | Matroska | **10.000 s** | **300** | ✅ exact |
| WebM Canvas (temps réel) | Matroska | N/A | 303 à 29.97 fps | ⚠️ dérive +1.3 % (limite connue, avertie) |

**Alignement image par image, MP4 après correctif :**

```
f  0 → f 59   |  0.000 s →  2.000 s  | ROUGE  (60 frames)   ← attendu 0 → 2 s
f 60 → f119   |  2.000 s →  4.000 s  | JAUNE  (60 frames)   ← attendu 2 → 4 s
f120 → f149   |  4.000 s →  5.000 s  | ROUGE  (30 frames)   ← attendu 4 → 5 s
f150 → f299   |  5.000 s → 10.000 s  | VERT  (150 frames)   ← attendu 5 → 10 s
```

Les bornes tombent **exactement** sur les numéros de frame attendus (59/60, 119/120,
149/150) : aucune frame de décalage, plus aucune frame perdue.
La table de temps (`tfdt`/`trun`) ne contient **plus aucun doublon de DTS**
(1 avant le correctif, 0 après).

**Alignement audio** (identifié par double passe-haut à 660 Hz pour isoler le 880 Hz) :

| Fenêtre | Attendu | Mesuré |
|---|---|---|
| 0.2 → 0.9 s | 440 Hz seul | ✅ 440 Hz seul |
| 1.05 → 2.9 s | 440 + 880 superposés | ✅ superposés |
| 3.05 → 5.9 s | 440 Hz seul | ✅ 440 Hz seul |
| 6.1 → 9.9 s | silence | ✅ −91 dB |

Le basculement se fait bien à **1.000 s et 3.000 s** : l'audio suit le même calage que l'image.

**Note importante — ordre des calques :** ce test a aussi confirmé la convention de
CUTTHEFLOW : dans l'UI, la **piste du haut (index 0) est le PREMIER PLAN** et elle est
dessinée **en dernier** sur le canvas. Un overlay placé sur une piste *inférieure*
est donc masqué par les pistes du dessus — comportement normal, pas un bug.

**Cache-buster :** `vendor/mp4box.all.min.js?v=20260910g`

---

## [3.9.6] - 2026-09-10

### ✅ Validation audio complète dans un **vrai Chrome** (152.0.7977.83)

Le doute restant portait sur le son des vidéos sources : dans l'environnement Electron de
développement, `decodeAudioData` échouait sur l'AAC. **Le test a été refait dans le Chrome
réellement installé sur la machine** (piloté via le protocole CDP, sans aucune dépendance npm) :

| Test | Résultat |
|---|---|
| Décodage AAC-in-MP4 | ✅ **fonctionne** (`ok: true`, 10 s, 48 kHz) |
| Décodage Opus-in-WebM | ✅ **fonctionne** (`ok: true`, 10 s, 48 kHz) |

**Conclusion : l'échec était un artefact de l'environnement de test, pas un défaut de l'app.**

### 🔬 Vérification des 3 moteurs : vidéo AVEC son → export → analyse du fichier

| Moteur | Piste audio produite | Fréquence | Niveau | Décodage |
|---|---|---|---|---|
| MP4 (H.264 + AAC) | `aac, 48 kHz, 2ch` | **439 Hz** (source 440 Hz) | −21,1 / −14,5 dB | ✅ |
| WebM (VP9 + Opus) | `opus, 48 kHz, 2ch` | **439 Hz** | −21,1 / −17,9 dB | ✅ |
| WebM (Canvas temps réel) | `opus, 48 kHz, 2ch` | **440 Hz** | −21,1 / −14,5 dB | ✅ |

**Les niveaux sont identiques à la source au dixième de décibel près** : le son est repris
intégralement, sans perte ni décalage de fréquence.

### 🎚️ Montage multi-pistes vérifié par tranches temporelles

Montage testé : vidéo (son 440 Hz) de 0 à 10 s, puis photo de 10 à 15 s, **plus** une musique
(880 Hz) de 0 à 8 s sur une seconde piste. Export MP4 analysé segment par segment :

| Segment | Attendu | Mesuré |
|---|---|---|
| 0–5 s (vidéo 440 Hz **+** musique 880 Hz) | les deux sons additionnés | pic **−10,2 dB**, fréquence dominante **878 Hz** ✅ |
| 8,2–9,8 s (vidéo seule, musique finie à 8 s) | son de la vidéo seul | pic −18,0 dB, **440 Hz** ✅ |
| 11–14 s (photo, aucun audio) | silence | **−91,0 dB** = silence ✅ |

Le mix **additionne correctement les pistes**, respecte les **bornes temporelles** de chaque
clip et produit du **silence** là où il n'y a pas d'audio.

### 📌 État : les 3 défauts de l'audit montage long sont tous corrigés
- ✅ Repli « Unifié (Auto) » désormais annoncé (v3.9.5)
- ✅ Piste audio MP4 réparée — boîte `esds` (v3.9.5)
- ✅ Décodage audio validé dans le vrai Chrome (v3.9.6)

---

## [3.9.5] - 2026-09-10

### 🔊 Piste audio des MP4 réparée — **l'export MP4 est enfin utilisable**

**Le défaut :** la piste audio des exports MP4 (H.264 + AAC) était **indécodable**.
`ffprobe` la voyait comme `unknown,video` et aucun lecteur ne pouvait la lire —
l'export MP4 était donc inutilisable pour tout projet sonorisé.

**Trois causes cumulées** dans le bundle `mp4box.all.min.js` du projet :

1. **Il ne sait pas ÉCRIRE la boîte `esds`.** Le fichier minifié ne contient aucun
   writer `esdsBox` (l'API ne fait que *parser*). Passer l'`AudioSpecificConfig` brut en
   `description` faisait planter la sérialisation (`TypeError: this.boxes[e].write is not
   a function`) — l'export échouait entièrement.
2. **`type: 'audio'` au lieu du FourCC `'mp4a'`.** `addTrack()` choisit le *sample entry*
   via son 4CC ; `'audio'` étant le *handler*, `BoxParser['audioSampleEntry']` n'existe pas
   → MP4Box retombait sur l'entrée **VISUELLE** (`e.type || 'avc1'`) → piste déclarée `vide`.
3. **`sample_rate` au lieu de `samplerate`.** MP4Box lit `samplerate` (entier en Hz, écrit
   en 16.16). La clé `sample_rate` était ignorée → repli sur 65536 → piste invalide.

**Le correctif :**
- Nouvelle fonction `createEsdsBox()` qui sérialise l'`ES_Descriptor` complet
  conformément à l'ISO/IEC 14496-1 (ES_Descriptor → DecoderConfigDescriptor →
  DecoderSpecificInfo = AudioSpecificConfig, + SLConfigDescriptor).
- `type: 'mp4a'` (4CC) et `hdlr: 'soun'` (handler audio explicite).
- `samplerate: 48000` et `samplesize: 16`.

**Vérification (`ffprobe` / `ffmpeg`) — avant / après :**

| | Avant | Après |
|---|---|---|
| Pistes détectées | `h264,video` + **`unknown,video`** | `h264,video` + **`aac,audio,48000,2`** |
| Décodage audio | ❌ `Output file does not contain any stream` | ✅ **OK** |
| Contenu audio | — | ✅ son réel (moyenne −22,6 dB, max −18,2 dB) |
| Lecture complète | — | ✅ **aucune erreur** |

Validé sur un export de 8 s **et** un montage de 24 s (3 clips vidéo + 4 clips audio) :
719/720 frames, durée 23,98 s, audio AAC stéréo 48 kHz décodable.

### ⚠️ Repli « Unifié (Auto) » désormais annoncé à l'utilisateur

**Le défaut :** le mode par défaut « Unifié (Auto) » pouvait basculer **silencieusement**
vers le moteur temps réel quand VP9 est indisponible. L'utilisateur croyait exporter en VP9
et recevait, sans avertissement, un fichier issu de `MediaRecorder` — lequel **perd des
frames** sur les montages longs (dérives mesurées de −2,4 % à **+11,6 %**).

**Le correctif :**
- Le repli affiche maintenant un **avertissement visible** dans la barre de statut,
  pendant 7 s, **bilingue** (FR/EN), expliquant le risque et la solution :
  *« Export en moteur temps réel : sur un montage long, la vidéo peut être étirée.
  Choisissez « VP9 + Opus » ou exportez en MP4 (H.264) pour un fichier exact. »*
- Le message apparaît **uniquement** lors d'un repli effectif : un export VP9 normal
  n'affiche rien (pas de fausse alerte).

**Support ajouté :** `showStatus(message, type, duration)` accepte désormais un type
(`info` / `warning` / `error`) et une durée. Les avertissements restent affichés **7 s**
au lieu de 3 s et sont **colorés** (ambre pour un avertissement, rouge pour une erreur).
Rétrocompatible : les appels à un seul argument sont inchangés.

### Fichiers modifiés
`js/webcodecs-export.js` (boîte `esds` + piste audio) · `js/unified-export.js` (avertissement
de repli) · `js/app.js` (`showStatus` typé) · `css/style.css` (styles de statut).

---

## [3.9.4] - 2026-09-10

### 🔍 Audit « montage long » — le ralenti n'est PAS lié à la puissance du PC

> Rapport complet avec toutes les mesures : **`AUDIT-MONTAGE-LONG-2026-09-10.md`**.

#### Mesures clés (exports réels, fichiers analysés avec `ffprobe`)

| Test | Résultat |
|---|---|
| Machine bridée **×8 plus lente**, timeline 180 s | 270,3 s → 286,7 s, soit **+6 % seulement** |
| Timeline 120 s, machine **normale** | 3547 / 3600 frames → fichier de **133,93 s (+11,6 %)** ❌ |
| Timeline 120 s, machine **bridée ×4** | 3600 / 3600 frames → fichier de **120,13 s (+0,1 %)** ✅ |
| **VP9 + Opus (offline)**, montage mixte 95 s | **95,000000 s**, **2850 / 2850 frames** ✅ |

**Conclusions :**
1. **Ce n'est pas la puissance du poste.** Bridage ×8 → +6 % de temps d'export.
   Le goulot est le **décodeur vidéo** (processus séparé, non affecté par le bridage CPU).
2. Le ralenti touche **davantage les machines rapides** : la dérive est **aléatoire**, pas
   proportionnelle à la puissance. La machine rapide a produit +11,6 %, la lente +0,1 %.
3. **La cause réelle est le moteur « temps réel »** (`MediaRecorder`) : il capture au rythme
   de l'horloge murale et **perd des frames** sur les fichiers longs → vidéo étirée.
4. **Les moteurs offline sont exacts au frame près** : VP9 + Opus a produit 2850/2850 frames
   sur un montage mixte de 95 s, durée exacte 95,000000 s.

#### Système de montage vérifié ✅

Montage volontairement complexe testé : **vidéo 30 s → photo 5 s → vidéo 60 s** sur une piste
VIDEO, plus **musique 30 s** sur une piste AUDIO. Résultat : durée **95,000000 s**,
**2850/2850 frames**, pistes **vp9 + opus 48 kHz stéréo**, aucune erreur.
→ **La gestion des pistes, du temps, et le mélange vidéo / photo / audio sont corrects.**

#### Fixed
- **Message d'alerte de dérive corrigé.** Il affichait « rendu trop lent pour le temps réel »,
  ce que les mesures **contredisent** : une machine lente produit un fichier *exact*. Le
  message décrit maintenant un **décalage** constaté, sans en imputer la cause à la machine.
- **Seuil d'alerte resserré de 10 % → 2 %**, pour prévenir l'utilisateur avant que le
  décalage ne devienne perceptible.

#### Known issues (non corrigés — signalés)
- **🔴 Repli silencieux** : `unified-export.js` bascule sur le moteur temps réel si VP9
  échoue, avec un simple `console.warn`. L'utilisateur n'est pas averti que son fichier
  risque d'être étiré. **Recommandation : utiliser explicitement « VP9 + Opus » sur les
  montages longs.**
- **🟠 Piste audio du MP4 corrompue** : les exports H.264 + AAC produisent une piste audio
  indécodable. Cause identifiée : ce bundle de MP4Box **ne sait pas écrire la boîte `esds`**
  (aucun writer dans le fichier minifié) ; `addTrack()` attend aussi le FourCC `'mp4a'`
  (le code passe `'audio'`) et la clé `samplerate` (le code passe `sample_rate`).
  **Non corrigé** (consigne de ne pas toucher à l'audio) — à traiter dans une session dédiée.
- **🟡 Décodage audio AAC** : `decodeAudioData` échoue sur l'AAC-in-MP4 dans l'environnement
  de test (MP3/WAV passent) → export sans son. À revérifier sur un vrai Chrome.

---

## [3.9.3] - 2026-09-10

### 🌍 Langue déplacée dans les Préférences

- Le sélecteur FR/EN qui occupait la barre de navigation (collé au logo) est **remplacé par un
  menu déroulant** dans **Préférences → GÉNÉRAL → Langue / Language**.
- La navigation est allégée et la langue n'est plus un élément de premier niveau.
- Le choix reste persisté (`localStorage: ctf_lang`), `<html lang>` reste synchronisé et le menu
  déroulant reflète toujours la langue active à l'ouverture des préférences.

### 🎛️ Ergonomie de la timeline et des pistes

> Audit mené en navigateur (mesures DOM réelles, viewport 1206×896 et mobile 390×844).

#### Lisibilité
- **Nom de piste : 8px → 10px**, couleur `#777` → `#9a9aa2` (ratio de contraste ≈ 7,5:1).
  À 8px, les noms étaient sous le seuil de lisibilité, surtout hors écran Retina.
- **Horodatage de la règle** : `#555` (ratio 2,66:1) → `#9498a0` (≈ 6,4:1).
- **Valeur de volume de piste** : `#444` (ratio 2,16:1, sous le minimum AA de 4,5:1) →
  `#8f9199` (≈ 6,3:1), taille 8px → 9px.
- **Pistes alternées** (`nth-child(even)`) + surbrillance au survol : sur 5+ pistes, tout était
  du même noir, ce qui rendait le suivi horizontal difficile.
- **Grille temporelle discrète** (repère tous les 100 px) dans la zone des clips pour se repérer
  pendant un glisser-déposer.

#### Cibles et précision (mesurées en px)
| Élément | Avant | Après |
|---|---|---|
| Poignée de rognage (bord de clip) | 10 px | **14 px** (17 px au survol, teinte bleue) |
| Bouton supprimer la piste | 11×15 px | **20×21 px** (+ `aria-label`) |
| Boutons M / S de piste | 19 px de haut | **24 px** |
| Zone de prise de la tête de lecture | 2 px | **16 px** (trait toujours 2 px) |
| Bouton × d'un média (mobile) | 22×22 px | **28×28 px** |

#### Sécurité
- **Suppression de piste désormais confirmée** quand la piste contient des clips : le bouton ×
  est collé aux boutons M/S et détruisait la piste **et tous ses clips** sans avertissement
  (seul Ctrl+Z permettait de revenir).

### ♿ Accessibilité

- **Indicateur de focus rétabli.** Mesuré : sur **57 boutons visibles, 40 n'avaient aucun style
  de focus** (`outline: none`) → la navigation au clavier était invisible. Ajout d'un anneau
  `:focus-visible` (bleu, 2 px) sur les boutons, champs, clips et poignées — uniquement pour le
  clavier, afin de ne pas polluer les clics souris.
- **`prefers-reduced-motion` respecté** : les transitions et animations sont neutralisées pour
  les utilisateurs ayant activé « réduire les animations » (confort vestibulaire).
- Ajout d'`aria-label` / `aria-pressed` sur les commandes de piste (M, S, volume, suppression).

### 📱 Mobile (viewport 390×844)

- **Débordement horizontal corrigé** : la barre de zoom et le bouton plein écran sortaient de
  l'écran (bord droit à 395 px pour un viewport de 390) et le bouton × des médias passait à
  `left: -3px` → ces commandes étaient **inatteignables**. Ils tiennent maintenant dans le cadre.
- Cibles tactiles des contrôles de lecture portées à 36–40 px.

### 🌍 Internationalisation

- Les infobulles des en-têtes de piste, codées en dur en français, sont passées par `window.tr()`
  (elles restaient en français même en mode anglais).

#### Notes
- ⚠️ Pensez à incrémenter les `?v=` dans `index.html` après modification de `js/*.js` ou
  `css/style.css` : le service worker sert sinon l'ancienne version.

---

## [3.9.2] - 2026-09-10

### 🎬 Export vidéo — audit complet : les 5 moteurs réparés

> Détail complet des mesures : voir **`EXPORT-AUDIT-2026-09-10.md`**.

#### Fixed
- **Ralenti à l'export (bug principal).** Le moteur temps réel (`MediaRecorder`) horodate
  les frames sur l'horloge murale : dès que le rendu décrochait, la vidéo était **étirée**.
  Mesuré : **6 s de timeline → fichier de 85,065 s (≈14× ralenti)**.
  Cause : chaque frame faisait un `video.currentTime = t` (seek mesuré à **~60 ms**, budget
  33 ms/frame à 30 fps). Les sources sont maintenant **lues en continu** et la frame déjà
  décodée est **réutilisée** ; le seek ne sert plus qu'au rattrapage.
  → **85,07 s ⇒ 6,01 s**.
- **Moteur VP9+Opus inutilisable.** Il sondait VP9 avec `hardwareAcceleration:
  'prefer-hardware'` ; comme il n'existe quasiment pas d'encodeur VP9 matériel, Chrome
  répondait « non supporté » et l'export WebM échouait systématiquement (repli silencieux
  vers le moteur temps réel → ralenti). Sonde corrigée (matériel → auto → logiciel) et
  chaîne de codec invalide `'vp9'` retirée. Même correction pour H.264 (sa liste de codecs
  commençait par `avc1.42E01E`, refusé sur certaines machines).
- **Muxer WebM maison qui plantait.** `RangeError: Maximum call stack size exceeded` :
  les octets étaient empilés en tableaux JS puis étalés (`[...1,4 Mo]`). Le moteur VP9 ne
  pouvait donc produire **aucun** fichier — bug masqué par le précédent. Assemblage
  réécrit en `Uint8Array`.
- **Aucune détection du frame rate source.** `getMediaMetadata` écrivait `fps = 30` en dur
  (`getVideoPlaybackQuality` renvoie 0 avant lecture) : les sources 24/25/50/60 fps étaient
  toutes étiquetées « 30 fps », donc **aucune conversion de cadence** à l'export.
  Nouveau `detectVideoFps()` (via `requestVideoFrameCallback`) branché à l'import.
  **Vérifié : 24 → 24 · 30 → 30 · 60 → 59,94.**
- **2 moteurs sur 5 grisés à tort** dans le modal, à cause d'une seconde sonde asynchrone
  qui forçait elle aussi le matériel. Sonde unique et exacte.
- **Audio supprimé en silence** sur MP4 : l'échec de décodage est toujours rattrapé
  proprement, mais un avertissement est désormais affiché clairement.

#### Performance (mesuré, source 1080p 24 fps, timeline 6 s)
| Moteur | Avant | Après |
|---|---|---|
| H.264 + AAC → MP4 | 17,0 s · audio perdu | **6,98 s** |
| VP9 + Opus → WebM | échec immédiat | **6,83 s** |
| Canvas / MediaRecorder | 85,8 s · 14× ralenti | **7,33 s** |
| Unifié (Auto) | héritait du bug VP9 | **6,77 s** |

### 🅣 Ombre du texte (nouvelle option, désactivée par défaut)
- Nouveau bloc **Ombre du texte** dans l'éditeur de texte *et* dans le panneau Propriétés :
  activation (case à cocher), couleur, flou (0–40 px), décalage X/Y (−20…+20 px).
- **Par défaut : aucune ombre** sur les nouveaux textes.
- L'ombre est désormais **identique entre l'aperçu et les 3 moteurs d'export**, via un helper
  unique `_applyTextShadow()` / `_getTextShadowCss()`.
- **Compatibilité ascendante :** les projets existants (sans champ `shadowEnabled`) conservent
  exactement leur ancien rendu.

### 🖱️ Sélection et redimensionnement dans l'aperçu
- **Impossible d'agrandir une vidéo avec les poignées.** Deux causes : les 4 poignées de
  milieu (haut/bas/gauche/droite) étaient créées en JS mais **aucune règle CSS** ne les
  positionnait (elles s'empilaient sur le coin haut-gauche), et le calcul de redimensionnement
  utilisait un facteur arbitraire (`0.7 × (dx+dy)`) sans point d'ancrage.
  → Géométrie **ancrée sur le coin/le bord opposé** (standard NLE), ratio d'aspect conservé,
  centre recalculé pour que l'ancre ne bouge pas (**dérive mesurée : 0 px**).
- **Poignées peu visibles** : passées de 9 px noires à **14 px blanches à liseré bleu**, avec
  curseurs directionnels corrects (`n/s/e/w` + coins) et retour visuel au survol.
- **Vrai contour de sélection** pour le texte et les formes (bloc couleur) : cadre bleu net
  + fond légèrement teinté. Il n'existait **aucun** retour visuel de sélection auparavant.
- **Les poignées n'apparaissaient jamais** quand on sélectionnait un clip dans la timeline
  (le geste le plus courant) : elles n'étaient activées que par un clic dans l'aperçu.
  Sélectionner un clip affiche désormais le cadre, et cliquer sur un clip de la timeline
  ne masque plus la sélection.

### ⌨️ Raccourcis clavier
- **Ctrl+Z (annuler) était cassé.** `updatePreview()` appelait `removeEventListener` avec un
  identifiant de `setInterval` (un nombre) : le navigateur levait
  `Failed to execute 'removeEventListener': parameter 2 is not of type 'Object'`, ce qui
  interrompait `restoreState()` — donc l'annulation restait partielle.
  → Type de `_loadListener` désormais testé (timer vs listener).
- **Barre d'outils mensongère** : le bouton texte annonçait « Add Text Layer (T) » alors
  qu'aucun raccourci `T` n'existe. Titre corrigé.
- Panneau de raccourcis et FAQ complétés avec les raccourcis réellement implémentés
  (`U` délier l'audio, `Shift+Delete` suppression avec ripple, `Ctrl+C`/`Ctrl+V`,
  `Ctrl+P`, `Ctrl+S`, `Ctrl+Shift+Z` pour rétablir) et une section « Texte & superpositions ».
- Tous les raccourcis ont été **testés en navigateur** (zoom, lecture/pause, copier/coller,
  couper au playhead, annuler/rétablir) : fonctionnels.

### 📄 Documentation
- Nouveau rapport `EXPORT-AUDIT-2026-09-10.md` (mesures, causes racines, recommandations).
- `agent.md` mis à jour : arborescence réelle des moteurs d'export, `detectVideoFps()`,
  helpers d'ombre, et avertissements sur le cache du service worker.

#### Notes
- 3 fichiers d'export (`lite-export.js`, `studio-export.js`, `transmux-export.js`) **ne sont
  chargés par aucun `<script>`** : code mort, à supprimer ou à brancher.
- ⚠️ Le service worker sert l'ancien JS : pensez à incrémenter les `?v=` dans `index.html`
  après toute modification de `js/*.js`.

---

## [3.8.17] - 2026-06-04

### 📹 Export WebCodecs (H.264) — débit adaptatif par résolution

#### Fixed
- Le moteur **WebCodecs** encodait à **10 Mbps fixe quelle que soit la résolution** :
  sous-dimensionné en 4K (artefacts possibles sur scènes détaillées) et surdimensionné
  en 720p (fichiers inutilement lourds).
- Débit désormais **adaptatif**, aligné sur le moteur MediaRecorder :
  720p ≈ 8 · 1080p ≈ 16 · 1440p ≈ 20 · 4K ≈ 30 Mbps (SD ≈ 5).
- **Hausse automatique** du débit au-delà de 30 fps (×1.5 max) pour préserver la qualité
  sur les exports haute cadence.

---

## [3.8.16] - 2026-06-04

### 🧩 Bouton « SEARCH ONLINE VIDEOS » déplacé sous l'en-tête

#### Changed
- Le bouton de recherche en ligne quitte la ligne déjà chargée de l'en-tête Media Library
  (texte + IMPORT + flèche) pour passer **sur sa propre ligne juste en dessous**, en pleine
  largeur, libellé « SEARCH ONLINE VIDEOS », toujours en noir/blanc/gris.

---

## [3.8.15] - 2026-06-04

### 🎨 Recherche en ligne — Coverr par défaut + design noir/blanc/gris

#### Changed
- **Bouton « ONLINE » et fenêtre de recherche** repassés en **noir / blanc / gris**, alignés
  sur le reste du design (plus de bleu).
- **Coverr** devient la **source par défaut** des vidéos libres, avec un sélecteur
  **COVERR / PEXELS** en haut de la fenêtre. Le choix, la clé et le lien d'obtention
  s'adaptent automatiquement à la source.
- Chaque source garde sa propre clé API (stockée localement) : on peut basculer sans
  ressaisir.

#### Notes
- Coverr et Pexels nécessitent une clé API gratuite (lien intégré). Pour Coverr, la clé
  s'obtient via leur page développeurs.
- Conformément aux conditions de Coverr, les téléchargements sont signalés à leur API
  (ping non bloquant) et l'attribution Coverr est affichée.

---

## [3.8.14] - 2026-06-04

### 🔎 Recherche de vidéos libres en ligne (Pexels) dans la Media Library

#### Added
- **Bouton « ONLINE »** dans l'en-tête de la Media Library : ouvre un moteur de recherche
  de vidéos **open source de qualité** via l'API **Pexels** (licence libre, usage commercial,
  HD/4K).
- Recherche par mot-clé + filtre d'orientation (paysage / portrait / carré), grille de
  vignettes avec auteur et durée.
- Un clic sur une vignette **télécharge le MP4 HD** et l'ajoute à la bibliothèque comme un
  média local normal → utilisable immédiatement sur la timeline (FX, fondus, export).
- **100 % local & respectueux de la vie privée** : l'utilisateur fournit sa propre clé API
  Pexels gratuite (lien d'obtention intégré), stockée uniquement en `localStorage`. Aucune
  clé côté serveur, conforme à la promesse « tout reste dans votre navigateur ».
- Crédit auteur affiché (bonne pratique même si l'attribution n'est pas obligatoire).

---

## [3.8.13] - 2026-06-04

### 🔤 Textes & formes — fondus identiques preview / export

#### Fixed
- **Fondu in/out des textes et blocs (formes)** : à l'export, les overlays texte et bloc
  n'appliquaient que l'alpha d'animation — le fondu in/out (`fadeIn`/`fadeOut`) était ignoré,
  alors qu'il était bien visible dans l'aperçu. Un texte ou une forme qui apparaissait/disparaissait
  en fondu dans la preview restait à pleine opacité dans la vidéo exportée.
  Désormais l'opacité d'export = `fondu × opacité × alpha d'animation`, exactement comme l'aperçu.
- Correction appliquée aux **deux** moteurs (MediaRecorder MP4/WebM/MKV et WebCodecs H.264).
- Couleurs texte (`style.color`) et formes (`clip.color`) vérifiées : identiques preview/export.

---

## [3.8.12] - 2026-06-04

### 🎬 Audit export vidéo (MP4 audio+vidéo) — cumul FX + fondus parfait

#### Fixed
- **Fondus propres avec FX cumulés** : à l'export, le fondu (fade in/out) était « cuit »
  dans le dessin du clip **avant** l'application des filtres. Les effets additifs
  (`invert`, `noise`, `duotone`, `teal-orange`, grain `vhs`…) repeignaient donc du contenu
  par-dessus les zones devenues noires et le fondu n'atteignait jamais un noir propre
  (ex. `invert` virait au blanc en plein fondu). Désormais chaque clip à effets est rendu
  sur un **calque FX isolé à pleine opacité**, ses filtres sont cuits, **puis** l'ensemble
  est composé avec l'alpha du fondu — exactement comme l'aperçu temps réel.
- **FX isolés par clip** : les filtres ne débordent plus sur les autres pistes ni sur les
  calques texte/blocs (ils ne s'appliquent qu'au média concerné), conforme à l'aperçu.
- Correction appliquée aux **deux** moteurs d'export : MediaRecorder (MP4/WebM/MKV, audio+vidéo)
  et WebCodecs (export avancé H.264).

---

## [3.8.11] - 2026-06-03

### 🆕 Bouton « Nouveau document » dans la barre d'outils

#### Added
- **Nouveau document** : ajout d'un bouton dédié dans la barre d'outils (zone centrale, avant « Ouvrir un projet ») qui appelle `newProject()` pour repartir d'un projet vierge (réinitialise médias, pistes, sélection, historique, étalonnage, autosave…).
- Message de confirmation localisé via I18N (FR/EN).

---

## [3.8.10] - 2026-06-03

### 💾 Import / Export projets (.ctf & .json) — robustesse

#### Fixed
- **.ctf — perte d'URLs rechargeables** : lors de l'enregistrement `.ctf`, un média
  dont la source n'est pas un blob local (URL distante / `data:` / stock) n'était
  ni empaqueté ni conservé → il était perdu et signalé « manquant » au rechargement.
  Ces URLs réutilisables sont désormais préservées (comme dans l'autosave et le
  `.json`). Les URLs `blob:` périmées ne sont jamais conservées.
- **.json — nettoyage `file`** : l'objet `File` transitoire est maintenant retiré
  aussi des **clips** (et plus seulement de la bibliothèque média) à l'enregistrement,
  et un éventuel `file: {}` résiduel est ignoré au chargement — alignant le `.json`
  sur le comportement déjà en place pour le `.ctf`.

> Aucune incidence sur les projets existants ; ces correctifs ne font que fiabiliser
> les allers-retours sauvegarde/chargement.

---

## [3.8.9] - 2026-06-03

### 🚀 Export avancé (WebCodecs / MP4 H.264) — parité avec l'aperçu + fluidité

#### Fixed
- **Images/infos manquantes à l'export** : le moteur avancé (WebCodecs) ne dessinait
  que la vidéo et les images avec leur fondu. Il **ignorait** les **effets (FX)**,
  l'**étalonnage colorimétrique**, les **animations** de clip, ainsi que les
  **textes** et **blocs de couleur**. Tous ces calques sont désormais rendus, donc
  l'export MP4 correspond exactement à l'aperçu (et au rendu MediaRecorder).
- **Ralentissement / gel en fin d'export** : aucune gestion de *backpressure* —
  la file d'encodage et la mémoire gonflaient, l'onglet se figeait et tout était
  vidé d'un coup au `flush()` final. Ajout d'une **régulation de la file
  d'encodage** + **micro-pauses** rendant la main à l'interface : l'encodage reste
  fluide jusqu'à la fin et la barre de progression continue d'avancer.

---

## [3.8.8] - 2026-06-02

### 🎬 Cumul FX + Fondus (fade in / fade out)

#### Fixed
- En **aperçu**, le calque des effets (FX) masquait le **fondu d'entrée / sortie**
  d'un clip : lorsqu'un effet était actif, le fade in/out ne se voyait plus à la
  lecture. Le calque FX respecte désormais l'enveloppe de fondu du clip.
- Résultat : on peut **cumuler librement** un (ou plusieurs) effets **et** un
  fondu d'entrée/sortie sur la même séquence — l'aperçu correspond exactement au
  rendu de l'export (où les FX étaient déjà appliqués sur l'image atténuée).

---

## [3.8.7] - 2026-06-02

### 🖱️ Timeline — sélection multiple de séquences

#### Added
- **Sélection par plage avec `Shift`** : `Shift + clic` sur une séquence
  sélectionne désormais **toutes les séquences situées entre** la séquence
  d'ancrage et celle cliquée, **sur la même piste** (comportement de plage
  standard, comme dans un explorateur de fichiers). Pratique pour saisir d'un
  geste toute une portion de la timeline.
- **Bascule individuelle avec `Ctrl` / `Cmd`** : `Ctrl + clic` (ou `Cmd + clic`
  sur Mac) ajoute ou retire **une seule** séquence de la sélection.
- Une fois plusieurs séquences sélectionnées, un **simple glisser** sur l'une
  d'elles **déplace tout le groupe** ensemble (les écarts relatifs sont
  conservés), et `Suppr` / `Retour arrière` supprime toute la sélection.

---

## [3.8.6] - 2026-06-02

### 🎞️ Fréquence d'images personnalisable (Avancé → Export)

#### Added
- **Frame rate réglable manuellement** dans le mode **Avancé** de l'export.
  L'étape « Choose Frame Rate » propose désormais une carte **Native** (qui
  reprend automatiquement la fréquence d'images détectée sur la vidéo source) en
  plus des présets 24 / 30 / 60, ainsi qu'un champ **Custom FPS** où l'on peut
  saisir n'importe quelle valeur (1–120).
- **Par défaut, la fréquence native de la vidéo est proposée** à l'ouverture du
  mode Avancé (`getNativeFps()` lit les clips de la timeline, puis la
  bibliothèque média ; à défaut, 30 fps). Une fois un préset ou une valeur
  personnalisée choisis, le choix de l'utilisateur est conservé pour la session.

---

## [3.8.5] - 2026-06-02

### 🎬 Export MP4 (H.264) — fin de la vidéo noire & muette

#### Fixed
- **Export MP4/H.264 entièrement noir et sans son.** Le pipeline d'export
  capturait le canvas avec `canvas.captureStream(0)` (mode manuel
  `requestFrame()`). Ce mode fonctionne avec les encodeurs VP8/VP9 (WebM/MKV)
  mais **pas** avec l'encodeur H.264/MP4 de Chrome, qui produisait alors un
  fichier **entièrement noir** (et fréquemment **muet**). Le choix du codec est
  désormais décidé **avant** la création du flux : pour une sortie MP4/H.264 on
  utilise une capture **cadencée** `captureStream(fps)` (l'encodeur échantillonne
  le canvas sur sa propre horloge), tandis que WebM/MKV conservent le mode manuel
  déterministe. Corrige aussi l'export « Automatique → Transmux (MP4) » qui passe
  par le même chemin.
- `requestFrame()` n'est plus appelé qu'en mode capture manuel (WebM/MKV).

#### Note
- L'encodeur « WebCodecs H.264 » (mode Automatique) reste **vidéo seule (sans
  audio)** par conception ; utilisez l'export MP4 standard pour une piste audio.

---

## [3.7.9] - 2026-06-01

### 🖇️ Outils Texte & Formes — déplacement fluide

#### Fixed
- **Blocage au déplacement des formes (blocks)** : le glisser appelait
  `updatePreview()` à chaque mouvement, ce qui reconstruisait le DOM des overlays et
  **annulait le signal du drag en cours** (AbortController) → le geste « décrochait ».
  Le glisser/redimensionnement met désormais à jour le style en direct (RAF) sans
  reconstruction, et ne sauvegarde l'état qu'au relâchement.

#### Changed
- **Texte et formes en Pointer Events** (souris + tactile + stylet) avec
  `setPointerCapture` : le drag ne se perd plus si le curseur sort de la zone,
  fonctionne au doigt sur mobile/tablette, `touch-action:none` (plus de scroll
  parasite). Curseur `move` / `grabbing`, sélection du clip au début du geste,
  sliders du panneau Propriétés synchronisés en direct.

### 🔍 Audit export (.ctf / .json / vidéo+audio)
- Vérifié que `clip.effects[]` (cumul de FX) et `fadeIn`/`fadeOut` (intro/outro)
  sont bien persistés par les 3 formats de sauvegarde (.ctf, .json, Pinata) et
  restaurés au chargement.
- Confirmé à l'export vidéo : fade in/out appliqué aux images, vidéos et overlays,
  fade audio (`baseGain × _calcFadeOpacity`) pour audio **et** audio de vidéo,
  pile de FX rendue via `_getClipEffects`. Aperçu == export.

---

## [3.7.8] - 2026-06-01

### ✨ Cumul de FX (effets empilables)

#### Added
- **Plusieurs effets sur un même clip** : le menu FX ne sélectionne plus un seul
  effet à la fois — chaque effet se cumule. Modèle de données `clip.effects[]`
  (`{name, intensity}`), avec migration automatique de l'ancien `clip.effect`.
  - Clic sur un FX inactif → l'ajoute à la pile et le sélectionne pour réglage.
  - Clic sur un FX actif (non sélectionné) → le sélectionne pour régler son intensité.
  - Clic sur le FX actif déjà sélectionné → le retire. « None » vide toute la pile.
  - Chaque effet garde sa propre intensité.
- **Aperçu = export** : l'aperçu rend désormais la pile d'effets dans un seul canvas
  via les mêmes algorithmes que l'export (`_applyEffectToCtx`) → ce que vous voyez
  correspond au rendu final. Le color grading reste appliqué par-dessus.
- **Export** : les effets sont appliqués dans l'ordre sur la frame (cumul).

---

## [3.7.7] - 2026-06-01

### 🎚️ Audio fade in/out — now applied everywhere + export sync

#### 🐛 Fixed
- **Fade in / fade out audio ignorés** : le volume des clips ne tenait pas compte
  de l'enveloppe de fondu (fadeIn/fadeOut) — ni à l'aperçu, ni à l'export.
  Désormais le gain audio est multiplié par `_calcFadeOpacity()` :
  - Export : automation du `GainNode` par frame (`setTargetAtTime`, anti-zipper).
  - Aperçu clips audio purs : `audioEl.volume = trackVolume × fade`.
  - Aperçu audio embarqué d'une vidéo : mise à jour par frame du `previewVideo.volume`.

### 🎞️ Export — désync audio/vidéo & gels d'image au ré-export MP4

#### 🐛 Fixed
- **Cadençage des frames ancré sur horloge absolue** : la boucle d'export
  attendait un délai *relatif* (`1/fps − tempsDeRendu`), ce qui accumulait
  l'overshoot de `setTimeout` à chaque frame. La timeline déterministe prenait
  alors du retard sur le temps réel, tandis que les éléments `<video>`/`<audio>`
  jouent en temps réel → ils prenaient de l'avance → reseek arrière de la vidéo
  (gel image / décodage bloqué) **et** dérive audio (désync).
  Désormais chaque frame est planifiée sur `startExportTime + n × (1/fps)` :
  la timeline reste collée au temps réel → quasi plus de reseek → nettement
  moins de gels et de décalage audio.

---

## [3.7.6] - 2026-05-24

### 🎬 Timeline + Preview + Export — full audit pass

#### ✨ Improved (Timeline)
- **Playhead pixel-perfect** : `playhead` et `rulerPlayhead` arrondis au pixel entier (`Math.round`) → fin du jitter sub-pixel pendant la lecture.
- **Frame-step quantifié** : `← / →` (1 frame) et `J / L` (1 s) passent par `quantizeTime()` → zéro dérive flottante après 100+ steps.
- **Wheel sur la timeline** : zoom uniquement sur `Ctrl + molette` (avant : la molette seule hijackait aussi). Le scroll horizontal/vertical normal fonctionne enfin.

#### 🐛 Fixed (Timeline)
- **`isTimeInClip` épsilon asymétrique** : le test ratait la borne haute (clip se terminant pile à `5.0000s` à t=`4.99999s` → flash noir 1 frame). Epsilon ajouté aussi en fin de plage.

#### 🚀 Improved (Export)
- **Bitrates vidéo relevés** (alignés YouTube SDR VP9/VP8) :
  - HIGH : 720p `5 → 8 Mbps`, 1080p `8 → 16 Mbps`, 4K `12 → 30 Mbps`.
  - MEDIUM : 720p `3 → 6 Mbps`, 1080p `5 → 10 Mbps`, 4K `8 → 18 Mbps`.
  - Default : `6 → 10 Mbps`. Fallback WebM/VP8 : `4 → 8 Mbps`.
  - LOW reste conservateur (RAM/CPU limités).
- **`applyColorGradingToContext` memoizé** : on n'écrit plus `ctx.filter` chaque frame quand les valeurs n'ont pas changé (re-parsing GPU filter chain évité).
- **`gradingCanvas` GPU-friendly** : créé avec `{ alpha: false, willReadFrequently: false }` + `imageSmoothingQuality: 'high'`.

#### 🔧 Technical
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.7.6-timeline-export-quality`.

---

## [3.7.5] - 2026-05-24

### 🎧 Audio quality — full pipeline audit (import, preview, export, extract)

#### ✨ Improved
- **Export audio bitrate** : Opus passe de **128 kbps → 192 kbps** (chemin MediaRecorder principal + fallback). Aligné avec `optimized-export.js`. Transparent pour la musique stéréo dense, +0.5 Mo/min seulement.
- **Export AudioContext** : créé en `sampleRate: 48000` + `latencyHint: 'playback'`. Match natif de l'encodeur Opus (zéro resampling entre `MediaElementSource` et la destination) et buffers plus stables → fini les underruns audio pendant le rendu lourd des frames.
- **Sync audio export — stratégie "seed once + drift only"** : on ne réécrit plus `audioEl.currentTime` à chaque frame (chaque seek = clic audible sur MP3/AAC). Désormais on seek **une seule fois** quand un clip devient actif, puis on laisse l'élément jouer sur sa propre horloge ; resync forcé uniquement si la dérive dépasse **250 ms** (cas catastrophique). Le flag `_seeded` se réinitialise quand le clip sort de plage pour gérer les boucles / scrub-then-play.
- **Sync audio preview** : seuil de resync passé de **50 ms → 250 ms en lecture** (50 ms conservé en scrub pour la réactivité). Forçage `playbackRate = 1.0` + `preservesPitch = true` à chaque tick → aucun risque de time-stretch résiduel.

#### 🐛 Fixed
- **`extractAudio` (clic droit → Extract Audio) jouait DEUX fois le son** : l'audio du clip vidéo continuait à sortir en même temps que le clip audio extrait → clipping / craquements / volume doublé. Désormais le clip vidéo source est marqué `audioUnlinked = true` + `audioMuted = true` (comme le fait déjà le mode AGENTZ « UNLINK_AUDIO »).
- **`extractAudio` utilisait l'URL proxy** (potentiellement downscalée) au lieu de `media.originalUrl`. Désormais l'extraction lit toujours le fichier source full-quality.

#### 🔧 Technical
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.7.5-audio-quality`.

---

## [3.7.4] - 2026-05-24

### ✨ Added
- **Parité `.ctf` ↔ `.json`** : le format bundle `.ctf` restaure désormais exactement le même état qu'un `.json` (et plus, puisqu'il embarque les médias).
  - `loadCtfProject()` restaure maintenant `selectedFps` (manquant auparavant → l'export retombait sur 30 fps après ouverture d'un .ctf).
  - `loadCtfProject()` met à jour les sliders DOM de color grading (lift/gamma/gain/saturation/contrast/temp), comme le fait `loadProject()` pour le .json.
  - Log de chargement cohérent (`CTF project loaded: { tracks, media, clips, missing }`).

### 🐛 Fixed
- **`.ctf` : même bug `createObjectURL` que `.json`** : `saveAsCtf()` sérialisait le champ `file` (objet `File`) dans le `project.json` interne au zip → devenait `{}` → cassait l'export après rechargement. Désormais `file` est stripé à la sauvegarde, et `loadCtfProject()` nettoie aussi les vieux bundles qui contiendraient encore un `file: {}`.

### 🔧 Technical
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.7.4-ctf-parity`.

---

## [3.7.3] - 2026-05-24

### 🐛 Fixed
- **Export MP4 après rechargement d'un projet `.json` + re-link** : l'export échouait avec `Failed to execute 'createObjectURL' on 'URL': Overload resolution failed` alors que tous les médias venaient d'être re-liés avec succès et lisibles en prévisualisation.
  - Cause : `JSON.stringify` sérialise un `File` en `{}` (objet vide). Au rechargement, `media.file` valait `{}` (truthy mais pas un `Blob`), donc la passe « refresh blob URLs » de l'export appelait `URL.createObjectURL({})` et levait une exception.
  - Garde ajoutée dans la boucle de refresh : on n'appelle `createObjectURL(media.file)` que si `media.file instanceof Blob`.
  - `saveAsJson()` strippe désormais le champ `file` avant la sérialisation (évite que le `{}` réapparaisse).
  - `loadProject()` (JSON) nettoie les anciens projets sauvegardés qui contiendraient encore un `file: {}`.
  - `relinkFile()` stocke désormais `media.file = file` après un re-link réussi, ce qui permet à l'export de recréer un blob URL frais en cas de besoin (autosave + reload).

### 🔧 Technical
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.7.3-relink-export-fix`.

---

## [3.7.2] - 2026-05-18

### ✨ Added
- **Sélection multiple sur la timeline (Shift+clic)** : on peut maintenant cliquer en maintenant `Shift` sur plusieurs séquences pour les ajouter/retirer de la sélection, puis les déplacer ensemble sur la timeline d'un seul drag. Les espacements relatifs entre les clips sélectionnés sont préservés.
  - Shift+clic : toggle d'un clip dans la sélection (pas de drag, juste sélection).
  - Clic simple sur un clip déjà sélectionné (groupe ≥ 2) : déplace tout le groupe horizontalement.
  - Clic simple sur un clip non sélectionné : remplace la sélection (comportement historique inchangé).
  - Snap magnétique appliqué sur le clip d'ancrage, puis offset propagé à tout le groupe.
  - Collisions : le groupe est poussé vers la droite du plus grand chevauchement avec un clip non sélectionné, jamais les uns sur les autres entre clips sélectionnés.
  - Suppr / Backspace : supprime maintenant tous les clips sélectionnés d'un coup (Shift+Suppr = ripple delete sur chacun).
  - Échap : désélectionne tout le groupe.

### 🔧 Technical
- Nouvel état `this.selectedClipIds = new Set()` (en plus de `selectedClip` qui reste l'ancre pour le panneau Properties).
- `selectClip()` synchronise selectedClipIds (clear + add).
- `startDragClip()` : si `e.shiftKey` → toggle dans le set, refresh CSS .selected, no drag ; sinon, si le clip cliqué est déjà dans une sélection multiple, drag de groupe (clamp pour que le clip le plus à gauche ne passe pas sous 0, snap sur l'ancre).
- Nouveau helper `_findClipById(id)` (linear scan des tracks) et `_refreshSelectionDom()` (toggle .selected sur tous les `.timeline-clip` d'après le set, sans renderTracks()).
- `renderTracks()` : la classe `.selected` est ajoutée à chaque clip présent dans selectedClipIds.
- Drag de groupe : pas de changement de track (volontairement bloqué pour rester simple et prévisible) ; le drag single-clip garde le track-change vertical existant.
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.7.2-multiselect`.

---

## [3.7.1] - 2026-05-17

### ✨ Added
- **Animation appliquée aux typos (et blocs)** : la fonction Animation (top nav) fonctionne désormais aussi sur les clips `text` et `block`, exactement comme sur les images / logos / vidéos. Tous les presets (Fade, Pop, Slide, Spin, Bounce, Pulse, Shake, Float, Ken Burns, Reveal Pop, etc.) s'appliquent maintenant aux titres, sous-titres et lower-thirds.
  - Preview temps réel : transform CSS (translate %, scale, rotate) et opacité mis à jour à chaque frame sur les overlays, même quand le DOM des overlays est mis en cache pendant la lecture (aucun rebuild forcé, perf préservée).
  - Export identique : le rendu canvas des overlays text/block compose désormais `_calcClipAnimation` (translate en % du canvas, scale + rotate autour du centre, alpha multiplicatif).
  - Cumulable avec posX/posY drag, style typo, opacité du block, fade-in/out existants.

### 🔧 Technical
- `js/app.js` (preview) : référence du clip stockée sur l'élément overlay (`el._cthClip`) ; nouvelle passe per-frame après le bloc de rebuild qui recalcule transform + opacité pour chaque overlay text/block actif.
- `js/app.js` (export `renderFrame`) : branche overlay `text` et `block` patchées pour composer l'anim (translate en pixels = `anim.tx/100 * width`, rotate + scale via `ctx.translate/rotate/scale` autour du centre pour le block, autour du point d'ancrage pour le texte, `globalAlpha *= anim.alpha`).
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.7.1-anim-text`.

---

## [3.7.0] - 2026-05-09

### ✨ Added
- **Animation panel** (à gauche du bouton FX) : nouvelle fonction dédiée à l'animation d'images, logos et vidéos. 19 presets prêts à l'emploi, applicables sur n'importe quel clip sélectionné.
  - **Apparitions** : Fade In, Zoom In, Pop (overshoot), Spin In, Bounce, Slide L/R/Up/Dn.
  - **Disparitions** : Fade Out, Zoom Out.
  - **Combos in+out** : Fade I/O.
  - **Loops continus** : Pulse, Shake, Float, Spin, Ken Burns (zoom + travelling slow).
  - **Logo intro** : Reveal Pop (apparition pop + disparition zoom).
  - 2 contrôles : durée d'In/Out (0.1–3 s) et intensité (0–200 %).
  - Prévisualisation temps réel (CSS transform sur l'élément vidéo/image) et rendu identique à l'export (canvas drawImage avec rotate/scale/translate/alpha).
  - Cumulable avec Scale / Position / Fade / FX / Color Grading existants.

### 🔧 Technical
- Nouveau helper `_calcClipAnimation(clip, timeInClip)` retournant `{sx, tx, ty, rot, alpha}` (multiplicateurs/offsets) — identité quand pas d'animation, donc les call sites peuvent multiplier sans condition.
- Cache static des fonctions de preset (`CutTheFlow._cachedAnimPresets`) pour zero overhead par frame.
- 3 sites d'application synchronisés : `_applyVideoTransform()` (preview CSS), branche `image` du `renderFrame` d'export, branche `video` du `renderFrame` d'export.
- Données persistées dans `clip.animation = { preset, duration, intensity }` (compatible undo/redo via `saveState`).
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.7.0-animation`.

---

## [3.6.5] - 2026-05-08

### 🐛 Fixed (CRITICAL)
- **WebM freeze on timeline** : un fichier `.webm` apparaissait bien dans la médiathèque (sidebar) mais déposer le clip sur la timeline gelait toute l'application, voire la faisait planter. Cause : la majorité des WebM (notamment ceux issus de MediaRecorder, OBS, captures navigateur, screencasts) rapportent `videoElement.duration === Infinity` tant que le fichier n'a pas été scanné de bout en bout. La valeur Infinity remontait jusqu'à `clip.duration`, et le moteur de timeline / la boucle de rendu / les calculs de progression bouclaient à l'infini ou divisaient par Infinity → freeze total.
- Implémentation du contournement standard dans `getMediaMetadata()` (js/app.js) : quand `duration === Infinity`, on déclenche `currentTime = 1e101` pour forcer le navigateur à parcourir tout le fichier, puis on capture la vraie durée via l'événement `durationchange` (timeout de sécurité 8 s, fallback gracieux).
- Garde-fou supplémentaire dans `handleFiles()` : un média dont la durée reste invalide après scan est refusé proprement (message clair à l'utilisateur conseillant un réencodage `ffmpeg -i input.webm -c copy output.webm`) plutôt que d'être ajouté à la médiathèque.
- Garde-fou ceinture-bretelles dans `addClipToTrack()` : refuse de poser sur la timeline tout média à durée non-finie, même restauré d'une session antérieure.

### 🔧 Technical
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.6.5-webm-duration`.

---

## [3.6.4] - 2026-05-08

### 🐛 Fixed
- **WebM video import** : les fichiers `.webm` (et autres formats dont `.mkv`, `.ogv`, `.opus`, `.flac`, `.avif`, `.heic`, etc.) pouvaient être rejetés silencieusement à l'import lorsque le système d'exploitation ne renseignait pas le MIME type du fichier (`File.type === ''`, cas fréquent sur Windows pour `.webm` quand le MIME n'est pas dans le registre OS). `detectMediaType()` retournait alors `'unknown'`, la durée n'était jamais lue et la vidéo n'était pas exploitable dans la timeline.
- Ajout d'un **fallback par extension** dans `detectMediaType()` (js/app.js) couvrant les principales extensions vidéo / audio / image. Aucun changement de comportement quand `file.type` est correctement renseigné — purement additif.

### 🔧 Technical
- `service-worker.js` : `CACHE_NAME` bumpé à `cuttheflow-shell-v3.6.4-webm-import` pour purger les anciens app-shells.

---

## [1.1.0] - 2025-11-19

### 🎮 Added - GPU Acceleration

#### Major Features
- **GPU Acceleration toggle** in export modal
- **Automatic GPU detection** via WebGL
- **Hardware-accelerated rendering** for faster exports
- **GPU information display** (renderer, vendor, version)
- **Smart fallback** to CPU if WebGL unavailable

#### Technical Improvements
- WebGL 2.0 and WebGL 1.0 support
- Context optimization with `desynchronized: true`
- `powerPreference: 'high-performance'` for GPU selection
- Detailed console logging for debugging
- Extension WEBGL_debug_renderer_info for GPU details

#### UI/UX
- New "HARDWARE ACCELERATION" section in export modal
- Animated toggle button (green when ON, gray when OFF)
- GPU name displayed automatically in UI
- 🎮 Icon for easy identification

#### Documentation
- `GPU-ACCELERATION-GUIDE.md` - Complete user guide
- `GPU-IMPLEMENTATION-SUMMARY.md` - Developer documentation
- `test-gpu-detection.html` - Standalone test page
- Updated README.md with GPU section

#### Performance
- Up to **2-3x faster exports** with GPU enabled
- Optimized for NVIDIA, AMD, Intel, and Apple GPUs
- Reduced CPU load during export

### Files Modified
- `js/app.js` - Added GPU detection and context management
- `index.html` - Added GPU toggle UI in export modal
- `css/style.css` - Added GPU button styles
- `README.md` - Added GPU documentation section

### Files Created
- `GPU-ACCELERATION-GUIDE.md` - User guide
- `GPU-IMPLEMENTATION-SUMMARY.md` - Technical summary
- `test-gpu-detection.html` - Test page
- `CHANGELOG.md` - This file

---

## [1.0.0] - 2024-XX-XX

### Initial Release

#### Core Features
- Multi-track timeline editor
- Drag & drop media library
- Video, audio, and image support
- Precise cutting and trimming
- Snap-to-grid functionality
- Zoom controls

#### Audio
- Multi-track audio mixing
- Continuous audio playback
- Volume control per clip
- Audio synchronization

#### Export
- WebM export (VP8/VP9)
- MP4 export support
- Multiple resolutions (720p to 8K)
- Adjustable FPS (24, 30, 60)
- MediaRecorder API fallback

#### Performance
- WebCodecs API support (Chrome 94+)
- 4K/8K proxy generation
- Adaptive performance settings
- Smart preview quality modes

#### Project Management
- Save/Load projects (JSON)
- Undo/Redo support
- Auto-save reminders
- Keyboard shortcuts

#### UI/UX
- Professional dark theme
- IBM Plex Mono font
- Responsive design
- Keyboard shortcuts panel

---

## [Unreleased]

### Planned Features
- [ ] Real-time effects and filters
- [ ] Transitions between clips
- [ ] Text and titles overlay
- [ ] Color correction tools
- [ ] Advanced audio effects
- [ ] Batch export
- [ ] Cloud storage integration
- [ ] Collaborative editing

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| **1.1.0** | 2025-11-19 | GPU Acceleration |
| **1.0.0** | 2024-XX-XX | Initial Release |

---

## Support

- 📖 [Documentation](README.md)
- 🐛 [Report a bug](https://github.com/yourusername/cuttheflow/issues)
- 💡 [Request a feature](https://github.com/yourusername/cuttheflow/issues)
- 💬 [Discussions](https://github.com/yourusername/cuttheflow/discussions)

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*For more detailed technical information about the GPU acceleration feature, see [GPU-IMPLEMENTATION-SUMMARY.md](GPU-IMPLEMENTATION-SUMMARY.md)*
