# CUT THE FLOW — Agent Reference

Single-file browser video editor. All application logic lives in **`js/app.js`** (~10200 lines), one class: `CutTheFlow`.
Entry point: `index.html`. No build step, no bundler.

## File Structure

```
CUTTHEFLOW/
├── index.html              # Single entry point (all UI markup)
├── css/style.css           # All styles
├── js/
│   ├── app.js               # Main CutTheFlow class (~12 300 lines)
│   ├── export-safeguards.js # RAM/crash guards for MediaRecorder
│   ├── frame-source.js      # 🔬 CTFFrameSource — extraction d'images FRAME-EXACTE (seek + `seeked`)
│   ├── canvas-export.js     # Repli — MediaRecorder WebM (TEMPS RÉEL, non déterministe)
│   ├── webcodecs-export.js  # Moteur MP4 — WebCodecs H.264+AAC (offline, frame-exact)
│   ├── webm-webcodecs-export.js # Moteur WebM — WebCodecs VP9+Opus (offline, muxer EBML inline)
│   ├── mp3-export.js        # Moteur MP3 — audio seul via LAME (offline)
│   ├── unified-export.js    # ⚠️ PLUS UTILISÉ depuis 3.10.0 (le routage est dans handleExport)
│   ├── lite-export.js       # ⚠️ CODE MORT — non chargé par index.html
│   ├── studio-export.js     # ⚠️ CODE MORT — non chargé par index.html
│   ├── transmux-export.js   # ⚠️ CODE MORT — non chargé par index.html
│   ├── ctf-advanced.js      # Advanced features (waveforms, transitions, subtitles)
│   └── i18n.js              # FR / EN strings
├── img/                    # PWA icons + brand SVG
│   ├── CUT_THE_FLOW_b.svg  # Master multi-app logo (only `CUT_x5F_THE_x5F_FLOW_-_blanc` group is visible)
│   ├── icon-192.png        # PWA icon 192 (rendered from SVG, #1a1a1a bg)
│   ├── icon-512.png        # PWA icon 512 (rendered from SVG)
│   ├── icon-512-maskable.png # Maskable variant (logo at 70% scale for safe area)
│   └── apple-touch-icon.png  # 180×180 iOS
├── tools/
│   ├── generate-icons.js   # Renders PWA PNG icons from CUT_THE_FLOW_b.svg via `sharp`
│   ├── sync-asset-hashes.js # Computes SHA-256 short hash, injects `?v=` into HTML/manifest/SW
│   ├── dev-static-server.js # Local dev server (`node tools/dev-static-server.js . 4173`)
│   └── regression/         # 🧪 Banc permanent : montage 13 s/5 pistes → 3 exports → vérifs ffmpeg
│       ├── README.md       #   mode d'emploi + ce qui est mesuré + pourquoi c'est fiable
│       ├── make-media.ps1  #   génère media/ (ffmpeg) : a.mp4, b.mp4, img.png, music.wav, beep.wav
│       ├── serve.cjs       #   serveur statique + Range (indispensable au <video>) + POST /__upload
│       └── montage.cjs     #   pilote Chrome en CDP : montage, exports, .ctf/.json, vérifications
├── manifest.json            # PWA manifest (theme/bg #1a1a1a, landscape-primary, 4 icons)
├── service-worker.js        # PWA offline support (CACHE_NAME = cuttheflow-shell-v3.9.x)
├── .htaccess               # Apache config
├── humans.txt / robots.txt / sitemap.xml / llms.txt / llms-full.txt
├── README.md               # Project README
├── CHANGELOG.md            # Version history
├── EXPORT-AUDIT-2026-09-10.md # Audit complet des exports (mesures + causes racines)
├── GPU-QUICK-START.md      # User guide: GPU acceleration
├── GPU-ACCELERATION-GUIDE.md # User guide: GPU features
├── GUIDE-4K-UTILISATEUR.md # User guide: 4K workflow
├── INTEGRATION_GUIDE.md    # Technical: export integration
├── EXPORT_OPTIMIZATION_GUIDE.md # Technical: export modules
└── logo_cut_the_flow_*.png # Logos (10px, 20px blanc)
```

CDN dependencies (loaded in index.html):
- `jszip@3.10.1` — .ctf project file packaging
- `mp4box@0.5.2` — MP4 muxing for the WebCodecs H.264 engine
- `lamejs@1.2.1` (LAME 3.100) — MP3 encoding for the audio-only export

### ⚠️ Pièges connus (à lire avant de modifier)

1. **Cache du service worker.** Le SW sert l'ancien JS avec l'ancien `?v=`. Après avoir modifié
   `js/*.js`, soit incrémenter le `?v=` dans `index.html`, soit — pour tester — désenregistrer
   le SW et vider les caches (`navigator.serviceWorker.getRegistrations()` puis `caches.delete`),
   sinon les changements semblent ne pas s'appliquer.
2. **Les moteurs d'export ne sont pas bundlés.** Tout nouveau fichier JS doit être ajouté
   comme balise `<script>` dans `index.html`.
3. **`detectVideoFps()`** (dans `app.js`) mesure le vrai frame rate source au moment de l'import.
   Ne pas le remplacer par `getVideoPlaybackQuality()` seul : cette API renvoie 0 avant lecture.
   La valeur retenue est la **médiane** des intervalles entre images présentées, alignée sur une
   cadence standard si l'écart est ≤ 2 %. ⚠️ Ni le **minimum** (il annonçait toujours la cadence
   inférieure : un fichier 30 fps « détecté » **29,97**) ni la moyenne (un décrochage suffit à la
   fausser) ne conviennent.
4. **Toujours sonder les codecs sans forcer le matériel d'abord.**
   `hardwareAcceleration: 'prefer-hardware'` fait répondre « non supporté » quand l'encodeur
   matériel n'existe pas (cas de VP9 sur presque toutes les machines). Ordre correct :
   `prefer-hardware` → sans option (auto) → `prefer-software`.
5. **🔬 Extraction d'images : UN SEUL chemin autorisé — `CTFFrameSource` (`js/frame-source.js`).**
   Règle : la source est **EN PAUSE**, on **seek** (`currentTime` + attente de `seeked`) et on
   dessine. Ne JAMAIS revenir à « laisser jouer + dessiner ce qui est là » : mesuré, cela
   décalait l'image de **878 ms en moyenne / 2,08 s au pire** par rapport à la timeline (le
   décodeur prend de l'avance sur une boucle d'export plus lente que le temps réel) → c'était
   le décalage son/image ET les saccades. Coût de l'extraction exacte : 33,9 ms/frame à 1080p,
   **donc être exact ne coûte rien**.
   *Symptôme à reconnaître :* le son semble décalé de plusieurs dixièmes de seconde et l'image
   « saute » par rapport à la timeline.
6. **🎯 On seek sur le MILIEU de la frame, jamais sur son début (`midFrameOffset`).**
   Chrome tombe sur la **mauvaise image une fois sur trois** quand la cible tombe pile sur une
   frontière de frame. Relevé sur 60 seeks à `k/30` : images présentées `0, 1, 1, 3, 4, 4, 6, 7…`
   → `deltas = {0: 20, 1: 20, 2: 19}` (20 images dupliquées + 19 sautées, cadence 20 fps au lieu
   de 30 !). En visant le milieu (`t + demi-frame`) : `deltas = {1: 59}`, erreurs `{0 ms: 60}`.
   *Ne pas* réintroduire un biais fixe en ms : un biais de −1 ms faisait tomber **chaque** image
   sur la précédente (erreur 33,1 ms sur 300/300).
7. **La durée de frame SOURCE s'estime par le 10ᵉ CENTILE des écarts observés**, jamais par un
   `Math.min()` partant d'une valeur initiale : l'estimation ne pourrait alors que diminuer et
   toute la détection de cadence devient absurde (58 duplications + 121 sauts sur 180 images).
   `stats.duplicates` / `stats.skips` (journalisés en fin d'export) sont la mesure de référence
   de la cadence : ils doivent être à **0**.
8. **`requestVideoFrameCallback` ne rappelle JAMAIS si on l'enregistre après un seek.**
   Il se déclenche quand une **nouvelle** frame est présentée : à enregistrer **avant** de
   déplacer la tête de lecture. Même piège dans `getVideoPlaybackQuality`-like : ne pas
   confondre « position demandée » et « frame présentée ».
9. **Les horodatages d'export se CALCULENT par arrondi direct de l'index**
   (`round(i × 1e6 / fps)` en µs, `round(i × 90000 / fps)` en ticks MP4, la durée étant l'écart
   avec la frame suivante). Ne jamais accumuler (`i × ticksPerFrame`), l'erreur dérive sur les
   longues timelines et sur 29,97 / 59,94 fps.
10. **🖥️ Aperçu : double tampon obligatoire (`#previewVideo` + `#previewVideoB`).**
   `_swapPreviewVideoIfReady()` permute les deux lecteurs au changement de séquence ; le clip
   suivant est pré-positionné par `preloadUpcomingClips()` (fenêtre **0,7 s**, contrôlée toutes
   les **250 ms** — à 1 s un clip sur trois n'était jamais préchargé). Toujours mettre **les
   deux** lecteurs en pause (`pause()`) et rendre **muet** celui qui n'est pas affiché, sinon
   audio doublé (+6 dB). `this._previewVideo` = élément ACTIF, il change au fil de la lecture.
11. **`_loadListener` sur `previewVideo`** contient SOIT un id de `setInterval` (number) SOIT un
   listener : toujours tester le type avant `removeEventListener`, sinon exception (cassait Ctrl+Z).
12. **`el.className = '...'` écrase les classes** : ajouter une classe d'état (ex. `ctf-selected`)
   APRÈS l'affectation, jamais avant.
13. **🐛 `vendor/mp4box.all.min.js` — bug `first_dts` (CORRIGÉ en 3.9.7, ne pas régresser).**
   Le vendor d'origine fait `t.first_dts || (t.first_dts = r.dts)`. Comme la 1ʳᵉ frame a
   `dts = 0` (falsy), `first_dts` était réécrit à chaque `addSample()` → dans
   `createSingleSampleMoof()`, `baseMediaDecodeTime = t.dts - (s.first_dts || 0)` valait
   **toujours 0** → **toute la piste glissait d'une frame** et la **dernière frame disparaissait**
   (299/300, durée 9.984 s au lieu de 10.000 s). Correctif en place :
   `void 0 === t.first_dts && (t.first_dts = r.dts)`.
   *Symptôme à reconnaître :* décalage constant d'une frame dans les MP4 + durée légèrement courte.
   *Méthode de diagnostic :* `_mt/parse-frags.cjs` (lit `tfdt`/`trun`) — si deux samples partagent
   le même DTS au début, c'est ce bug. Le bug se reproduit **hors navigateur** en Node
   (`require('../vendor/mp4box.all.min.js')`), ce qui permet de le prouver sans Chrome.
14. **Ordre des calques : piste 0 (haut de l'UI) = PREMIER PLAN, dessinée EN DERNIER.**
   Un overlay placé sur une piste *inférieure* est masqué par les pistes du dessus.
   C'est volontaire — ne pas « corriger » en inversant la boucle de rendu.
15. **🐛 Audio WebM — ne JAMAIS fabriquer l'en-tête Opus à la main (CORRIGÉ en 3.9.8).**
    Le muxeur reconstruisait `OpusHead` avec un `preSkip` **figé à 3840** échantillons (80 ms),
    alors que l'encodeur Opus de Chrome en utilise **312** (6,5 ms). Le `preSkip` dit au décodeur
    combien d'échantillons jeter au début : 3528 échantillons de trop = **l'audio démarrait
    73,5 ms trop tôt** et le fichier sortait **plus court que la vidéo**. Mesuré : bascule de
    piste à **4,917 s au lieu de 5,000 s** (erreur −83 ms) ; après correctif **4,991 s (−9 ms)**,
    identique au moteur MP4. Correctif : on transmet désormais l'`OpusHead` **réel** de
    l'encodeur (`metadata.decoderConfig.description` dans le callback `AudioEncoder.output`)
    via `opusHead:` au muxeur. `buildOpusHead()` ne sert plus que de repli (avec 312).
    *Symptôme :* son du WebM légèrement en avance sur l'image + fichier audio plus court que la vidéo.
16. **`unlinkAudio()` est protégé contre le double appel** : un 2ᵉ clic créerait un 2ᵉ clip audio
    sur la même plage → piste jouée deux fois → **+6 dB** et saturation. L'outil refuse si
    `clip.audioUnlinked` est déjà vrai.
17. **L'outil « Separate Audio and video » existe en 3 endroits** dans `app.js` : `unlinkAudio()`
    (~L2238, la barre d'outils), l'action IA `UNLINK_AUDIO` (~L1640) et un 3ᵉ chemin (~L7170).
    **Toute correction audio doit être appliquée aux trois**, sinon le comportement diffère
    selon le chemin d'appel. Ils pointent tous vers `media.originalUrl` (qualité source,
    pas le proxy de prévisualisation).
18. **🚀 FX — ne JAMAIS allouer de canvas dans `applyClipEffectToCanvas()` (corrigé en 3.9.9).**
    Cette fonction est appelée **une fois par frame d'export**. Cinq branches (`pixelate`,
    `invert`, `blur`, `shake`, `mirror`) faisaient `document.createElement('canvas')` à chaque
    appel → plusieurs Go alloués et ramasse-miettes en pleine boucle d'encodage. Utiliser
    **`this._fxScratch(role, w, h)`** (pool réutilisable). Après correctif, `pixelate` est
    **gratuit** (2448 ms contre 2447 ms sans FX) et les 4 autres coûtent +2 à +6 %.
    Restent intrinsèquement lourds (grain aléatoire par pixel) : `vhs` +70 %, `noise` +52 %.
19. **🖱️ Le ruler ne doit PAS être un conteneur défilant indépendant (corrigé en 3.9.9).**
    Le ruler n'a pas les 120 px d'en-tête de piste : sa largeur défilable diffère de celle des
    pistes de 20 à 130 px, donc `rulerContent.scrollLeft = timelineScroll.scrollLeft` finit par
    **désaligner les numéros de temps des clips** au zoom (« je perds les numéros »). Le ruler est
    désormais **translaté** par `_syncRulerScroll()` (`transform: translateX(-scrollLeft)`), et
    `overflow: hidden` en CSS. `handleRulerClick()` lit `this._rulerScrollLeft` et non plus
    `rulerContent.scrollLeft` (qui vaut toujours 0).
20. **🌐 `service-worker.js` — `APP_SHELL` doit suivre `index.html`.** Les `?v=` de cette liste
    DOIVENT être les mêmes que ceux d'`index.html`, sinon le SW précache de vieilles versions.
    Toujours bumper `CACHE_NAME` en même temps. `precacheAppShell()` utilise `Promise.allSettled()`:
    un asset en échec ne doit JAMAIS faire échouer `install()` (sinon le SW ne s'active jamais).
21. **🔬 MÉTROLOGIE — ne JAMAIS mesurer un poste « par soustraction d'une moyenne ».**
    Instrumentation fautive (2026-09-17) : `draw = (fin_image − début_seek) − moyenne(seek)`.
    Sur la portion où le clip actif est une **image fixe** (aucun seek), tout le temps de
    l'image était compté comme « draw », et comme la moyenne du seek baissait, le « draw »
    cumulé montait de **7 → 217 ms/image** — pile pendant l'affichage du titre et de la forme.
    Conclusion fausse : « le texte avec ombre fait ramer l'export ». Mesure refaite avec des
    compteurs **indépendants** (seek / rendu / overlays / `new VideoFrame` / `encode`) :
    le texte + la forme coûtent **0,12 ms par image**.⇒ Toujours mesurer des postes qui ne se
    recouvrent pas, et vérifier que la somme des postes ≈ le temps réel total.
22. **🛡️ Toute boucle d'attente de l'encodeur DOIT avoir une limite de temps.**
    `while (encoder.encodeQueueSize > 4) await sleep(1)` attendait sans fin : si l'encodeur
    matériel se bloque (« Codec reclaimed due to inactivity »), le thread principal reste
    libre (l'UI répond, la barre de progression se fige) mais l'export ne finit **JAMAIS** —
    un blocage silencieux, le pire des symptômes. Limite en place : **20 s** puis erreur
    explicite (images en attente, image courante, conseil « désactivez l'accélération
    matérielle »). Ne pas retirer ce garde-fou pour « aller plus vite ».
23. **🌙 Un onglet en ARRIÈRE-PLAN gèle l'export (cause : Chrome, pas l'app).**
    Les moteurs rendent la main entre chaque image par `setTimeout` (contrôle de flux de
    l'encodeur). Chrome bride les `setTimeout` d'un onglet non visible à **1 s**, puis
    **gèle** l'onglet : l'export s'arrête net (mesuré au banc : figé à **271/390 images**) et
    ne reprend jamais, **sans lever la moindre erreur** (le thread est suspendu, donc ni le
    garde-fou 20 s du piège 22 ni aucun `catch` ne s'exécutent). `handleExport()` prévient
    désormais l'utilisateur via `_watchBackgroundExport()` (`visibilitychange`).
    ⇒ Pour un banc/tests : lancer Chrome avec `--disable-background-timer-throttling
    --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
    --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling`. Ne JAMAIS
    conclure « l'export est buggé » sur un onglet non visible.
24. **🧪 Le banc (`tools/regression/`) refuse de démarrer si un Chrome occupe déjà le port
    de debug.** Le script supprime le profil au démarrage : si le CDP se connecte à un
    navigateur préexistant, celui-ci perd son profil sous ses pieds → imports refusés
    (« durée invalide (0) »), exports qui n'avancent plus. Fermer Chrome avant, ou laisser le
    script tuer l'arbre de processus (`taskkill /T`) en fin de run.

25. **🎨 DESIGN — la règle du « noir franc » (2026-09-17).** Les grandes surfaces (barre du
    haut, barre du bas, ruler, panneau MÉDIA, panneau PROPRIÉTÉS, timeline, fonds de piste)
    sont en `#000000`. Ne PAS réintroduire de gris d'aplat (`#0a0a0a`, `#0d0d0f`, `#161616`) :
    c'est le repérage qui porte l'ergonomie, pas les fonds — ligne de piste **`#131317`**,
    grille temporelle à **3 %** de blanc, survol `#0d0d12`. ⚠️ **Ne pas éclaircir ces lignes :**
    un premier essai à `#232328` + grille à 4,5 % a été jugé « trop voyant » par l'utilisateur
    (sur du noir pur, un trait à 35/255 se voit énormément). Les valeurs ci-dessus sont le
    réglage validé. **L'alternance de fond paire/impaire a été
    SUPPRIMÉE** : toutes les pistes doivent avoir exactement le même fond. Les boutons
    **M**/**S** des pistes sont **en contour seul** (fond transparent, bordure `#2f2f33`) ;
    seuls les états actifs sont remplis (rouge = muet, orange = solo), précisément parce
    qu'ils doivent sauter aux yeux. Les modales et menus gardent un fond légèrement plus clair
    (`#141414`/`#1a1a1a`) : ils doivent se détacher de la page.
26. **⚠️ Ne JAMAIS écrire `background:` (raccourci) sur une règle qui doit garder un
    `background-image`.** C'est ce qui a produit « la piste 2 a un fond bleu foncé opaque » :
    la règle des pistes paires faisait `background: #0d0d0f`, ce qui **remettait
    `background-image` à `none`** et effaçait la **grille temporelle** de `.track-content`.
    Mesuré : pistes 1/3/5 → grille présente + `rgb(10,10,10)` ; pistes 2/4 → `background-image:
    none` + `rgb(13,13,15)` (composante bleue supérieure) = aplat uni légèrement bleuté, sans
    repère. ⇒ Sur ces sélecteurs, utiliser **`background-color`** exclusivement.
27. **🖱️ Tout état visuel de survol de glisser passe par une CLASSE, jamais par un style
    inline.** `dragover` écrivait `el.style.background = 'rgba(102,126,234,.2)'` et seuls
    `dragleave`/`drop` l'effaçaient — or `dragleave` n'arrive pas toujours (dépôt hors zone,
    glisser annulé, onglet qui perd le focus, éléments recréés pendant le drag) : la piste
    gardait un fond bleu définitif. Utiliser la classe `.drop-target` et la nettoyer via
    `_clearDropTargets()` (appelée sur `dragend`, `drop`, `blur`, `Échap` et dans
    `renderTracks()`). Idem : ne jamais lire `e.dataTransfer` sans garde (`dtFiles(e)` /
    `dtHasFiles(e)`) — un `DragEvent` synthétique n'en a pas, et l'exception interrompt le
    glisser.

28. **🖼️ Une fonctionnalité n'est pas livrée tant que son CSS n'existe pas — « les vignettes
    de timeline invisibles » (2026-09-17).** `createClipElement()` créait bien, depuis la 3.10,
    un `div.clip-thumb-surface` et un `div.clip-thumb-meta` (durée, `+sourceStart`, `%scale`)
    pour chaque clip vidéo/image. **Mais aucune règle CSS ne stylait ces deux classes** : sans
    `position: absolute` ni dimensions, un `div` vide fait 0 × 0 → aucun aperçu visible.
    ⇒ Pour vérifier, chercher **`.clip-thumb-surface`** et lire `getBoundingClientRect()`
    (attendu : largeur du clip × ~61 px) — pas seulement la présence de la classe.
    ⚠️ **Ne PAS conclure depuis `.clip-thumb`** : l'ancien système `.clip-thumb-strip` /
    `.clip-thumb-img` a été **retiré du CSS** (il n'était plus utilisé par le JS et faisait
    croire que rien n'était généré).

    **Mise en forme retenue après deux essais ratés** (à ne pas refaire) :
    - ❌ plusieurs images réparties sur toute la largeur → la vignette de 60 px est **étirée**
      sur 500 px, méconnaissable ;
    - ❌ la même image **répétée** en mosaïque (`repeat-x`) → effet « pellicule » bruyant ;
    - ✅ **une seule image, au DÉBUT du clip, à sa taille naturelle** : `background-size: auto
      100%` + `left center` + `no-repeat`. Ces trois valeurs sont posées en **style inline**
      dans `createClipElement` (elles dépendent du média) — ne pas les figer dans la règle CSS,
      sinon la vignette se remet à s'étirer. On affiche l'image la plus proche de
      `clip.sourceStart`, donc la bonne image si le début du clip a été rogné.
    - Les vignettes sont générées **au rapport de l'image** (hauteur 62 px imposée, largeur
      déduite : mesuré **110×62** en 16:9). Avant, un cadre fixe de 60×62 laissait des **bandes
      noires** autour d'une vidéo 16:9. Une image toutes les 2,5 s, 8 maximum, JPEG qualité 0,28
      ≈ **1,9 Ko par vignette** (~6 Ko par média). Sur un clip plus étroit que la vignette, le
      `overflow: hidden` de `.timeline-clip` la rogne proprement.
    - ⚠️ Piège de **test** : importer via `setInputFiles` alors qu'un dialogue de fichier est
      resté ouvert ne délivre qu'un fichier et laisse des médias sans vignettes — cela ressemble
      à une régression de `generateThumbnails()` qui n'en est pas une. Vérifier en appelant
      `handleFiles(files)` directement avec une `DataTransfer`, ou en fermant le dialogue.

29. **🔍 Le dézoom qui « perd les numéros de temps » (2026-09-17).** Deux causes cumulées,
    corrigées ensemble :
    (a) `getMinZoomLevel()` renvoyait `Math.min(5, Math.max(0.05, fitZoom))` — le plafond à
    **5 px/s** autorisait un dézoom extrême : mesuré, un montage de 14 s écrasé à **109 px de
    large** avec **une seule étiquette « 00:00 »**. Nouvelle formule :
    `Math.max(0.05, Math.min(fitZoom / 3, 60))` (le montage occupe au minimum un tiers de la
    largeur visible).
    (b) `renderRuler()` ne dessinait que `timelineEnd * zoomLevel` : dès que la largeur visible
    dépassait le montage, les repères s'arrêtaient en plein milieu de l'écran. Il calcule
    maintenant `span = max(timelineEnd, (scrollLeft + viewport × 1,3) / zoomLevel)` et choisit
    un intervalle « nice » (`NICE_INTERVALS`) visant **120 px** par étiquette.
    ⇒ Après toute modification du zoom ou de la règle, **mesurer** : compter les étiquettes
    visibles après 10-12 `zoomOut()` — il doit en rester **≥ 4**, jamais 1.

30. **🎧 Un même projet doit sonner pareil en MP4, WebM et MP3 — « le plus proche voisin »
    (2026-09-17).** `mp3-export.js` rééchantillonnait par **interpolation linéaire** (avec un
    commentaire expliquant que le plus proche voisin « créait un souffle audible »), mais
    `webcodecs-export.js` et `webm-webcodecs-export.js` faisaient toujours
    `Math.round(s * srcSR / AUDIO_SAMPLE_RATE)` = **plus proche voisin**. Une source 44,1 kHz
    (vidéo de téléphone, musique MP3/AAC — le cas le plus courant) sonnait donc différemment
    en MP4 et en MP3. Les trois moteurs partagent désormais la **même** enveloppe de fondu
    (`tSec < fi`, `tSec > duration - fo`, fondu **linéaire**) et la **même** interpolation
    (`i0 = floor(srcPos)`, `val = a + (b - a) * frac`). ⇒ Toute retouche de mixage audio doit
    être appliquée **aux trois** fichiers, sinon l'écart se réintroduit.

### 🎛️ Ergonomie — conventions à respecter

L'audit ergonomie du 2026-09-10 a mesuré les cibles réelles dans le navigateur. Toute nouvelle
commande doit s'aligner sur ces seuils (une interface dense reste acceptable, mais pas en dessous) :

| Zone | Minimum retenu |
|---|---|
| Boutons d'icône de la barre d'outils | 32×32 px |
| Boutons d'action de piste (M / S) | 24 px de haut |
| Poignées de rognage de clip | 14 px de large (17 px au survol) |
| Tête de lecture — zone de prise | 16 px (le trait reste à 2 px) |
| Contrôles de lecture (mobile) | 36–40 px |

**Contraste** : viser ≥ 4,5:1 pour tout texte informatif. Valeurs de référence validées :
- texte secondaire `#9498a0` / `#8f9199` au-dessus de `#0a0a0a`–`#000` (≈ 6,3:1)
- nom de piste `#9a9aa2` (≈ 7,5:1)
- ⚠️ éviter `#444` / `#555` sur fond noir (2,1–2,7:1 = illisible)

**Accessibilité déjà en place (ne pas régresser) :**
- Anneau de focus `:focus-visible` global (bleu `#4dc3ff`, 2 px) — beaucoup de composants ont
  `outline: none` par ailleurs, la règle globale doit rester.
- Bloc `@media (prefers-reduced-motion: reduce)` qui neutralise animations et transitions.
- Les infobulles (`title`) de l'interface passent par `window.tr(en, fr)`, jamais en français codé en dur.
- Les pistes alternent leur fond (`nth-child(even)`) et se surlignent au survol : c'est ce qui
  permet de suivre une ligne horizontalement sur 5+ pistes.

**Actions destructrices** : toute suppression non triviale doit demander confirmation,
surtout quand le bouton est voisin d'une autre commande (cas du × de piste collé à M/S).

---

## Data Models

### Media item (`this.mediaLibrary[]`)
```js
{
  id,           // string — unique
  name,         // string
  type,         // 'video' | 'audio' | 'image'
  url,          // blob: URL (may be a proxy for large videos)
  originalUrl,  // blob: URL — always the original full-quality file
  file,         // File object (needed to refresh blob URL on export)
  duration,     // seconds (Infinity for images/blocks/text)
  width, height // px (video/image)
}
```

### Clip (`track.clips[]`)
```js
{
  id,               // string
  mediaId,          // string — links to mediaLibrary
  name,             // string
  type,             // 'video' | 'audio' | 'image' | 'text' | 'block'
  url,              // blob: URL (proxy during editing, refreshed for export)
  originalUrl,      // blob: URL — full quality
  trackId,          // string
  startTime,        // seconds on timeline (quantized to 0.0001s)
  duration,         // seconds
  sourceStart,      // seconds into source file (IN point)
  sourceDuration,   // seconds — total source length (Infinity for non-media clips)
  effect,           // 'none' | 'grayscale' | 'sepia' | 'blur' | 'pixelate' | …
  effectIntensity,  // 0–100
  fadeIn, fadeOut,  // seconds
  videoScale,       // 0–200 (100 = fit)
  videoPosX, videoPosY, // 0–100 (% of canvas, 50/50 = center)
  audioUnlinked,    // bool — audio track was split from video
  audioMuted,       // bool
  trackVolume,      // 0–200 (100 = normal)
  // text/block extras:
  content,          // string (text clips)
  style,            // { fontFamily, fontSize, fontWeight, color } (text)
  color,            // CSS color (block clips)
  opacity,          // 0–1 (block clips)
  posX, posY,       // 0–100 % (text/block overlay position)
  width, height     // 0–100 % (block clips)
}
```

### 🅣 Ombre du texte (`clip.style`, clips `type: 'text'`)

Ajouté le 2026-09-10. Une **seule source de vérité** dans `app.js` alimente l'aperçu ET les
3 moteurs d'export :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `shadowEnabled` | bool | `false` | Ombre activée/désactivée (**OFF par défaut**) |
| `shadowColor` | CSS color | `rgba(0,0,0,0.8)` | Couleur de l'ombre |
| `shadowBlur` | 0–40 px | `4` | Flou |
| `shadowOffsetX` | −20…+20 px | `2` | Décalage horizontal |
| `shadowOffsetY` | −20…+20 px | `2` | Décalage vertical |

Helpers (dans `app.js`) :

| Méthode | Rôle |
|---|---|
| `_getTextShadow(style)` | Renvoie `{color, blur, offsetX, offsetY}` ou `null` si désactivé |
| `_applyTextShadow(ctx, style)` | Applique/efface l'ombre sur un contexte canvas (export) |
| `_getTextShadowCss(style)` | Renvoie la valeur CSS `text-shadow` (aperçu) |
| `setClipTextShadow(prop, value)` | Met à jour un réglage depuis le panneau Propriétés |

**⚠️ Compatibilité ascendante :** si `shadowEnabled` est `undefined` (projet créé avant cette
version), `_getTextShadow()` renvoie **l'ancienne ombre** (`rgba(0,0,0,0.8)`, blur 4, offset 2/2)
pour ne pas altérer l'aspect des projets existants. `false` = vraiment aucune ombre.

UI : bloc « Ombre du texte » dans la modale `editTextClip()` (voir `createTextEditorModal()`)
et dans `renderProperties()` pour les clips texte.

### 🖱️ Sélection / transformation dans l'aperçu

| Élément | Poignées | Ancrage du resize |
|---|---|---|
| Vidéo / image | 8 (4 coins + 4 bords), `.video-handle-{nw,n,ne,e,se,s,sw,w}` | Coin/bord **opposé** fixe, ratio d'aspect conservé |
| Bloc couleur | 8, `.block-handle-*` | idem |
| Texte | déplacement seul (pas de resize) | — |

- Le cadre de sélection est `.video-select-overlay` (vidéo/image) et `.ctf-selected`
  (texte/bloc, classe d'état ajoutée **après** `el.className`).
- `_previewHandlesActive` est activé par `selectClip()` pour tout clip visuel — pas uniquement
  par un clic dans l'aperçu.

### Track (`this.tracks[]`)
```js
{
  id,       // string
  name,     // string
  clips,    // Clip[]
  muted,    // bool
  solo,     // bool
  _effectiveMute, // bool — computed from solo logic
  volume    // 0–200 (100 = normal)
}
```

### Color grading (`this.colorGrading`)
```js
{ lift: 0, gamma: 0, gain: 0, saturation: 100, contrast: 100, temp: 0 }
```
All values are numbers; `lift/gamma/gain/temp` are offsets (0 = neutral), `saturation/contrast` are percentages (100 = neutral).

### Preferences (`this.prefs`)
```js
{
  gpuPreview: true,    // GPU acceleration for preview canvas
  gpuExport: true,     // GPU acceleration for export canvas
  snapEnabled: true,   // Magnetic snap on timeline
  snapThreshold: 0.3,  // Snap radius in seconds
  loopPlayback: false, // Loop at end of timeline
  autoSaveDelay: 30,   // Auto-save interval (seconds)
  previewQuality: 1,   // Preview quality multiplier
  showWaveform: true,  // Show audio waveforms on clips
  rippleEnabled: false, // Ripple edit mode
  darkUI: true         // Dark theme
}
```
Persisted in `localStorage` key `ctf_prefs`. Legacy flags (`this.useGpuAcceleration`, `this.useGpuExport`) kept in sync via `_loadPrefs()` and `setPref()`.

**GPU flag invariants** (do not break):
- `this.useGpuAcceleration` ⇔ `prefs.gpuPreview` (preview canvas / compositor layer hints)
- `this.useGpuExport`       ⇔ `prefs.gpuExport`  (export-time canvas + WebCodecs hardware preference)
- The two prefs are independent, but the export-modal master toggle (`gpuAccelerationBtn`) flips **both** at once for clarity. Power users override per-flag in the Préférences modal (`pref-gpuPreview` / `pref-gpuExport`).
- **Never** assign one flag from the other (e.g. `useGpuAcceleration = prefs.gpuExport`) outside of `_loadPrefs()` / `setPref()` — that desyncs the editor.

---

## Key Constants

| Constant | Value | Purpose |
|---|---|---|
| `TIME_PRECISION` | 10000 | Divide/multiply for quantized time (0.0001s resolution) |
| `TIME_EPSILON` | 1/10000 | Float boundary tolerance for clip range checks |
| `SNAP_THRESHOLD` | 0.3s | Magnetic snap radius |
| `TRACK_HEADER_WIDTH` | 120px | Left header width for ruler offset |
| `MAX_TIMELINE` | 10800s | 3-hour hard cap |
| `maxHistorySize` | 50 | Undo/redo stack depth |
| `autoSaveInterval` | 30000ms | IndexedDB auto-save period |

---

## Core Methods

### Initialization
- `init()` — called once on load; creates default tracks, sets up listeners, starts auto-save
- `setupEventListeners()` — all keyboard shortcuts + global drag/drop
- `initColorWheels()` — drag logic for Lift/Gamma/Gain color wheels
- `initAIPanel()` — AI chat sidebar setup

### Playback
- `togglePlay()` — play/pause toggle
- `play()` — starts `requestAnimationFrame` loop, creates audio elements via `preloadAudioAtCurrentTime()`. Loop playback resets `currentTime`, re-anchors wall clock, schedules next rAF.
- `pause()` — stops rAF loop; resets `_lastPreviewKey`, `_lastColorGradingFilter`, `_lastPreloadTime` so caches rebuild on next frame
- `updatePlayhead()` — called each rAF; uses cached `_domPlayhead / _domRulerPH / _domTimeDisplay / _domTimelineScroll / _domRulerContent` (invalidated in `fullRefresh()`)
- `updatePreview()` — draws current frame to preview panel; skips overlay rebuild if `_lastPreviewKey` unchanged during playback (cache keyed on active videoId + overlayIds + selectedClipId). Throttles `preloadUpcomingClips()` to once/sec.
- `updateAudioTracks()` — sync HTMLAudioElement play/pause/seek to `this.currentTime`

### Timeline / Clips
- `addClipToTrack(media, trackId, startTime)` — creates clip object and pushes onto track
- `deleteClip(clip)` — removes clip, saves state, calls `updatePreview()`
- `rippleDeleteClip(clip)` — Shift+Delete: deletes and shifts right-side clips left, calls `updatePreview()`
- `cutAtPlayhead()` — splits clip at `this.currentTime` into two clips
- `unlinkAudio()` — extracts audio from selected video clip into a new audio clip on the first audio track; uses `media.originalUrl` (not proxy)
- `copyClip() / pasteClip()` — clipboard (stored in `this.clipboardClip`)
- `startDragClip(clip, e)` — mousedown-based drag; **selects clip immediately on mousedown** (4px `hasMoved` threshold before DOM rebuild); calls `renderTracks()` only if moved
- `startTrimClip(clip, side, e)` — left/right trim; clamps delta so `sourceStart` never goes below 0 (B1 fix)
- `selectClip(clip)` — sets `this.selectedClip`, updates CSS, calls `renderProperties()` + `updatePreview()` (when not playing)
- `quantizeTime(t)` — rounds to `TIME_PRECISION` to avoid float drift
- `trySnap(newStartTime, clipDuration, excludeClipId)` — returns `{ snappedTime, snapX }` or null
- `getSnapPoints(excludeClipId)` — all clip start/end times + playhead position

### Rendering
- `render()` — top-level: calls `renderMediaLibrary()`, `renderRuler()`, `renderTracks()`, `renderProperties()`
- `fullRefresh()` — same as `render()` + `updatePlayhead()` + `updatePreview()` + invalidates ALL DOM caches
- `renderTracks()` — rebuilds timeline DOM from `this.tracks`; calls `createClipElement()` per clip
- `createClipElement(clip)` — creates `.timeline-clip` div; attaches `mousedown → startDragClip` and trim handles
- `renderProperties()` — right panel: shows clip properties for `this.selectedClip`
- `renderRuler()` — time ruler with dynamic tick interval based on `this.zoomLevel`
- `applyColorGrading()` — applies CSS filter to live preview
- `applyColorGradingToContext(ctx)` — applies color grading to export canvas via `ImageData`
- `applyClipEffectToCanvas(ctx, clip, width, height, frameCount)` — FX (grayscale, sepia, blur, pixelate, etc.) applied per clip during export

### Undo / Redo
- `saveState()` — deep-clones `{ tracks, selectedClip, currentTime }` into `this.history`; trims at `maxHistorySize`
- `restoreState(state)` — replaces tracks/selectedClip/currentTime; calls `fullRefresh()`
- `undo() / redo()` — navigate `historyIndex`

### Property editing
- `updateClipProperty(prop, value)` — live update (no saveState; used for sliders during drag)
- `commitClipProperty(prop, value)` — saves state after user releases (e.g. mouseup on slider)
- `updateClipStyle(prop, value)` — updates `clip.style[prop]` and saves (text clips; currently has no callers from HTML)

### Export (depuis 3.10.0 — 3 formats, 1 moteur par format)
- **`handleExport()`** est le SEUL point d'entrée. Il route **par format** :
  | `selectedFormat` | Moteur appelé | Fichier produit |
  |---|---|---|
  | `mp4` | `startWebCodecsExport()` | H.264 + AAC (MP4Box) |
  | `webm` | `startWebMWebCodecsExport()` | VP9 + Opus (muxer EBML inline) |
  | `mp3` | `startMp3Export()` | MP3 (LAME 192 kbps) |
  Replis annoncés (jamais silencieux) : H.264 absent → WebM ; VP9 absent → `startCanvasExport()`.
- **Il n'y a plus de choix de moteur dans l'interface.** `selectExportFormat(fmt)` fait
  `selectedEncoder = _exportEngineFor(fmt)` : le moteur est une *conséquence* du format.
  La popin ne contient que 3 cartes (`.export-card`) + 2 listes (`#exportResSelect`,
  `#exportFpsSelect`) — les onglets de mode, les cartes « moteur » et l'étape « YOUR DEVICE »
  ont été supprimés. `switchExportMode()` et `updateAutomaticModeDisplay()` sont des no-op
  conservés pour compatibilité ; `selectEncoder()` ne fait plus que du texte informatif.
- **Extraction d'images — `js/frame-source.js`.** Une `CTFFrameSource` par clip vidéo, élément
  **en pause**. `frameAt(sourceTime)` cherche le **milieu** de la frame (voir pièges 5-7), ne
  travaille que par seek, et expose `stats` (`seeks`, `duplicates`, `skips`, `errAvg/Max`,
  `failures`) journalisées en fin d'export. Un `frameAt()` qui renvoie `false` ⇒ le moteur
  reconduit la dernière image valide (jamais de noir au milieu d'un clip).
- **Moteurs offline (MP4 / WebM)** : décodage audio complet → mixage (volume de piste, fondus,
  bornes) → `AudioEncoder` → muxage. Rendu vidéo frame par frame sur un canvas
  (pistes de fond vers premier plan, `contain` sans déformation, FX par clip sur un calque
  isolé, étalonnage global une fois, textes/blocs, sous-titres, transitions).
- **Moteur de repli `canvas-export.js`** : `MediaRecorder` **temps réel**, NON déterministe
  (dérives mesurées de −2,4 % à +11,6 % sur de longs montages). Il ne doit servir que de
  dernier recours et l'utilisateur doit en être averti (`_warnRealtimeFallback`).
- Supprimés / inutilisés : `startExport()` (ancien pipeline MediaRecorder de `app.js`) et
  `unified-export.js` ne sont **plus appelés** par `handleExport()`.
- `startExport()` lit `this.prefs.gpuExport` (PAS `this.useGpuAcceleration` directement) — le
  drapeau historique reste synchronisé via `_loadPrefs()` / `setPref()`.
- **Où passe le temps d'un export (mesuré le 2026-09-17, montage 13 s / 390 images / 1280×720) :**
  | Poste | ms/image | part |
  |---|---|---|
  | **Extraction de l'image (seek + `seeked`)** | **24,5** | **≈ 80 %** |
  | `encoder.encode()` | 2,0 | 6 % |
  | `ctx.drawImage` (vidéo / image) | 0,23 | 0,8 % |
  | Overlays (texte + ombre, forme) | 0,12 | 0,4 % |
  | `new VideoFrame(canvas)` | 0,06 | 0,2 % |
  ⇒ Le rendu, le texte, l'ombre et la composition sont **gratuits**. Le seul poste à optimiser
  est le **décodage** : passer d'un seek par image à un décodage **séquentiel** WebCodecs
  (`VideoDecoder` + démuxeur — voir la note mediabunny) ramènerait ~80 % du temps à quelques ms.

#### 🚀 Note « mediabunny » — la piste qui remplace le décodage par seek
`mp4-muxer` et `webm-muxer` sont **dépréciés** au profit de **mediabunny** (≈ 5 ko gzip,
MPL-2.0, zéro dépendance) : démux + mux + abstraction WebCodecs, et surtout un
`VideoSampleSink` qui **décode séquentiellement** un fichier. L'adoption (accord utilisateur
obtenu le 2026-09-17) permettrait de :
1. Supprimer `js/frame-source.js` et son seek par image (≈ **80 % du temps d'export**),
   en gardant l'exactitude (on choisit la frame par son horodatage, sans seek).
2. Supprimer le muxeur EBML écrit à la main (`webm-webcodecs-export.js`) **et** `vendor/mp4box.all.min.js`
   (donc aussi son bug `first_dts`, piège 13).
3. Supprimer le repli audio MP4 maison (`createEsdsBox`).
C'est un **chantier**, pas un correctif : à traiter seul, avec le banc `tools/regression/`
comme filet de sécurité (les valeurs de référence doivent rester identiques).

### Cadence & synchronisation — les chiffres de référence (2026-09-16)
Mesuré dans Chrome 153 (`_bench/`) sur un montage de 10 s : 6 s de `sync_a.mp4`
(440 Hz 0-2 s, 880 Hz 2-4 s, 440 Hz 4-6 s) puis 4 s de `sync_b.mp4` (1200 Hz).
- MP4 : 300/300 images, bascules audio **2,005 / 4,005 / 6,005 s** ; WEBM et MP3 : identiques.
- Dérive : **0 ms**. Luminance à la coupe (6,000 s) : **130/255** → aucune image noire.
- Extraction : **0 duplication, 0 saut, erreur 0,0 ms** ; fidélité pixel vs source **0/255**.
- Aperçu à travers la coupe : **0 image non affichée**, 16,7 ms d'écart max (60 fps).
Tout écart sur ces valeurs = régression à investiguer avant toute autre modification.

**`detectVideoFps()`** : les intervalles entre images réellement présentées (rVFC) sont
mesurés, puis on prend la **médiane** (`fps = 1 / médiane`) et on l'aligne sur une cadence
standard si l'écart est ≤ **2 %** (24, 25, 29.97, 30, 50, 59.94, 60…). Ni le **minimum** (il
annonçait toujours la cadence inférieure : un fichier 30 fps détecté **29,97**) ni la moyenne
(un seul décrochage la fausse) ne conviennent. Repli sur l'ancienne méthode si la mesure
n'est pas concluante (< 5 intervalles exploitables).

**Comment refaire ces mesures — c'est AUTOMATISÉ depuis la 3.10.1** (le banc est désormais
versionné dans `tools/regression/`, voir son `README.md`) :

```powershell
powershell -ExecutionPolicy Bypass -File tools/regression/make-media.ps1   # médias, une fois
node tools/regression/montage.cjs            # montage + 3 exports + .ctf/.json + vérifs ffmpeg
node tools/regression/montage.cjs --quick    # export MP4 seul (itération rapide)
```

Si un jour le banc doit être réécrit, voici les règles qui le rendent fiable :
1. Un serveur statique **avec support Range** (indispensable pour `<video>`) + un endpoint
   `POST /__upload` pour récupérer les fichiers exportés depuis la page.
2. Chrome réel en `--remote-debugging-port`, profil neuf, piloté en CDP avec le `WebSocket`
   natif de Node ≥ 22 (aucune dépendance npm). **Attention** : au 1ᵉʳ chargement le service
   worker prend le contrôle et `index.html` se recharge (`controllerchange` → `location.reload`) ;
   attendre ~9 s après `Page.navigate`, puis `Runtime.disable` + `Runtime.enable`, sinon on
   évalue dans l'ancien contexte (`window.app` = undefined).
3. Médias de test générés par ffmpeg : une vidéo 30 fps à **repères audio** (440 Hz 0-2 s,
   880 Hz 2-4 s, 440 Hz 4-6 s) + une seconde (1200 Hz) pour tester la coupe entre 2 clips.
4. Mesure de la synchro : extraire l'audio en PCM mono 48 kHz (`ffmpeg -f s16le -`) puis
   **Goertzel** par fenêtres de **10 ms** sur 440/880/1200 Hz ; les bascules doivent tomber à
   2,005 / 4,005 / 6,005 s (l'écart constant de 2 s prouve une dérive nulle).
5. Mesure des images noires : `ffmpeg -ss T -i out.mp4 -frames:v 1 -vf scale=1:1,format=gray
   -f rawvideo -` → 1 octet = luminance moyenne (0 = noir).
6. Fidélité des images : décoder **la source** et **l'export** en `scale=1:1,format=gray` et
   comparer octet par octet (obtenu : écart 0/255). ⚠️ Ne PAS utiliser une mire dont la
   luminance code le n° de frame : la compression H.264 la rend inexploitable.

### Assistant IA (panneau `#aiPanel`)
- **Fournisseurs, dans l'ordre d'affichage** : `deepseek` (défaut), `openrouter`, `groq`,
  `openai`, `anthropic`, `google` — définis dans `CutTheFlow.AI_PROVIDERS` (libellé + lien de
  création de clé + placeholder) et `CutTheFlow.AI_OPENAI_COMPATIBLE` (endpoints).
  ⚠️ **L'ordre des `.ai-provider-btn` dans `index.html` ET les `optgroup label="<provider>"`
  du `<select id="aiModelSelect">` DOIVENT rester synchronisés avec ces deux tables.**
- **DeepSeek `deepseek-flash` = V4.1-Flash** est le modèle par défaut (noms officiels de l'API ;
  `deepseek-chat` et `deepseek-v4-flash` ont été retirés côté DeepSeek).
- **Une clé par fournisseur** : `localStorage['ctf_ai_apikey_<provider>']`, exposées via
  `app.aiKeys`. L'ancienne clé globale `ctf_ai_apikey` reste lue en repli pour `deepseek`.
- **`_aiCallOpenAICompatible(system, user, provider, endpoint)`** sert DeepSeek, OpenRouter,
  Groq et OpenAI : gère `max_completion_tokens` pour les modèles de raisonnement, et **réessaie
  sans paramètres optionnels** si l'API répond 400/422. `_aiCallAnthropic` et `_aiCallGoogle`
  ont leur propre format. `_aiCallDeepSeek`/`_aiCallOpenAI` ne sont plus que des enveloppes.
- `_aiParseJSON()` nettoie les réponses (```json … ```, texte avant l'objet, virgule finale) au
  lieu de faire un `JSON.parse` sec.
- Le prompt système (`_aiBuildSystemPrompt()`) décrit la timeline en JSON et la liste des
  actions ; les actions sont exécutées par `_aiExecuteActions()`.

### Save / Load
- Save formats: `.ctf` (JSZip: `project.json` + media blobs), `.json` (no media), Pinata/IPFS
- `Infinity` serialized as `'__INF__'` via replacer: `(k, v) => v === Infinity ? '__INF__' : v`
- **Both `.ctf` and `.json` load** use reviver: `(k, v) => v === '__INF__' ? Infinity : v`
- **`appVersion` + `selectedFormat` sont écrits dans les deux formats** (3.10.1) : le projet
  rechargé retrouve donc son format d'export (MP4 / WEBM / MP3). Les projets antérieurs, qui
  n'ont pas ces clés, restent lisibles (valeurs ignorées).
- **Une seule implémentation de chargement par format, symétriques** :
  `loadProject()` = sélection du fichier (dialogue) → aiguille vers `loadCtfProject(file)` ou
  `loadJsonProject(file)`. Les deux sont appelables directement depuis un banc de test (c'est
  ce que fait `tools/regression/montage.cjs`). Ne pas remettre la logique JSON dans le dialogue.
- Le format d'export courant est aussi mémorisé entre deux sessions :
  `localStorage['ctf_export_format']` (`_restoreSelectedFormat()` / `_persistSelectedFormat()`).
- Auto-save: IndexedDB (`ctf_autosave` db), key `latest`; restored on load if found
- Pinata JWT stored in `sessionStorage` (key `ctf_pinata_jwt`) — clears on tab close

### Proxy generation
- `generateSmartProxy(media)` — detects GPU, picks proxy resolution, calls `generateVideoProxy()`
- Proxy: lower-res video used during editing; `media.originalUrl` always preserved for export
- `proxyTasks` Map (keyed by `mediaId`) cleared on failure

---

## GPU Acceleration

Two independent prefs, two surfaces, one master button.

### Surfaces & flags
| Surface | Pref key | Legacy mirror | Driven by |
|---|---|---|---|
| Preview / compositor layers | `prefs.gpuPreview` | `this.useGpuAcceleration` | Préférences toggle `pref-gpuPreview` + master button |
| Export canvas + WebCodecs hardware encoder | `prefs.gpuExport` | `this.useGpuExport` | Préférences toggle `pref-gpuExport` + master button |

### Master toggle (`toggleGpuAcceleration()`)
Wired to the `gpuAccelerationBtn` in the export modal AND to `applyHardwareProfile()` (auto-tune by hardware). Flips **both** `gpuPreview` AND `gpuExport` together, persists, re-syncs the Préférences toggles if open, and calls `_applyGpuLayerHints(next)`.

### Per-flag toggles (`setPref('gpuPreview' | 'gpuExport', value)`)
Power-user surface in the Préférences modal. Each updates its own legacy mirror and (for `gpuPreview`) calls `_applyGpuLayerHints(value)`. `gpuExport` has no immediate visual effect — it only changes what `startExport()` reads.

### `_applyGpuLayerHints(enable)` — preview compositor layer hints
Promotes 6 hot rendering surfaces to their own GPU compositor layer when `enable=true`, releases on `false`:
- `#previewVideo`, `#previewImage`, `#previewContainer`, `#canvasContainer`, `.timeline-content`, `.tracks-area`

CSS applied (enable):
- `will-change: transform, opacity`
- `transform: translateZ(0)` (forces immediate layer creation, avoids first-frame jank)
- `backface-visibility: hidden`
- `contain: layout paint`
- `image-rendering: auto` (smooth resampling for scaled previews)

Released on disable so VRAM is freed when the user opts out.

Called: once at init from `setupEventListeners()`, then on every `toggleGpuAcceleration()` and `setPref('gpuPreview', …)`.

### Hardware detection (`detectGpuInfo()` + `_updatePrefsGpuInfo()`)
Both probe a throwaway WebGL context (`webgl2` then `webgl`), read `WEBGL_debug_renderer_info`, and **must release the context via `WEBGL_lose_context`** before returning. Holding the probe context is a real VRAM/driver leak: every preferences open or app launch would otherwise keep an extra GL context alive.

### Export-time GPU pipeline (`startExport()` in `js/app.js`)
1. `useGpu = this.prefs.gpuExport` — single source of truth for this export.
2. Probe WebGL on a throwaway canvas; release immediately.
3. If `useGpu`: try 4 `getContext('2d', …)` configs (full GPU → minimal → alpha-only → bare) on the export canvas. Throw if all fail.
4. If not `useGpu`: 3 CPU-friendly `getContext('2d')` attempts (`alpha:false, willReadFrequently:false` → `alpha:false` → bare).
5. WebCodecs encoder (`js/webcodecs-export.js`): always created with `hardwareAcceleration: 'prefer-hardware'`. The `gpuExport` flag does NOT change this constructor option — only the canvas pipeline differs. Hardware availability is decided by the browser/OS.

### Auto-tuning (`applyHardwareProfile(profile)`)
- `tier === 'high' | 'ultra'` → forces both `gpuPreview` and `gpuExport` ON.
- `tier === 'low'` → forces both OFF.
- `tier === 'medium'` → leaves user prefs untouched.
Uses `toggleGpuAcceleration()` for the symmetric flip when possible; patches the leftover flag explicitly otherwise. Never relies on `_loadPrefs()` to re-derive.

### Common pitfalls
- **Do not** clobber `useGpuAcceleration` from `prefs.gpuExport` (or vice-versa) inside `startAutomaticExport()` / `startExport()` — that was the v3.5 bug. Read prefs into a local (`useGpu`), do not write back.
- **Do not** add a 3rd GPU flag. Two flags + one master button is the contract.
- **Do not** forget `WEBGL_lose_context` on probe canvases — Chrome caps total live WebGL contexts (~16 across tabs) and silent failures begin once the cap is reached.
- **Do not** call `_applyGpuLayerHints` before the DOM elements exist. It is safe from `setupEventListeners()` onward (script tag is at end of body), not from the constructor.
- The `gpuAccelerationBtn` lives in the export modal but is a global master switch — its label says "GPU ACCELERATION" without scoping. If you ever rename it, also rename the corresponding console log.

---

## Performance Patterns

### DOM caching (per-rAF)
```
_domPlayhead, _domRulerPH, _domTimelineScroll, _domRulerContent, _domTimeDisplay
_previewVideo, _previewImage, _noVideoIcon, _previewOverlays
```
All initialized lazily on first access, nulled in `fullRefresh()`.

### Preview overlay skip
`_lastPreviewKey = "${videoId}|${overlayIds}|${selectedClipId}"`
If key unchanged during playback → skip `innerHTML = ''` + overlay rebuild entirely.
Reset to `null` in: `pause()`, scrub `onUp`, `fullRefresh()`.

### Color grading cache
`_lastColorGradingFilter` — skip DOM `style.filter` write if filter string identical.

### FX effect cache
`_lastFxKey` — skip effect re-application during playback if same clip+effect unchanged.

### Preload throttle (double tampon d'aperçu)
`preloadUpcomingClips()` throttled via `_lastPreloadTime` to **250 ms** (fenêtre de pré-roulage
de 0,7 s ; à 1 s un clip sur trois n'était jamais préchargé). La fonction doit rester très bon
marché : elle sort immédiatement s'il n'y a pas de clip à préparer. `_swapPreviewVideoIfReady()`
n'est PAS throttlé (vérifié à chaque frame, mais ne fait que quelques lectures de propriétés).

### DOM caching (per-rAF) — complément
`_previewVideo` = lecteur ACTIF ; `_previewVideoB` = second tampon. Les deux sont initialisés
ensemble et remis à `null` par `fullRefresh()`. `_getIdlePreviewVideo()` renvoie celui qui n'est
pas affiché (cible du préchargement).

### Clip drag — no rebuild on click
`startDragClip` sets `this.selectedClip` on `mousedown`. `hasMoved` flag (4px threshold) gates `saveState()` + `renderTracks()`. Pure clicks never trigger DOM rebuild.

### Collision detection on drag drop
After drag release, iterates other clips on track and pushes overlapping clips to nearest free position (max 10 passes).

### Data integrity
- `renderTracks()` sorts all clip arrays by `startTime` before rendering
- Cut/split sorts clips after push
- Drag sorts clips after collision resolution

---

## Safety Guards

- **Keyboard shortcuts blocked during export** (`this.isExporting` check)
- **Empty timeline stops playback** (guard in play loop)
- **Loop playback re-anchors wall clock** (prevents drift on loop)
- **MediaRecorder `onerror`** handler prevents permanent UI lockup
- **Trim clamps** `sourceStart + duration <= sourceDuration` (prevents seek past source end)
- **TransitionCanvas letterboxing** — draws at clip's videoScale/videoPosX/videoPosY instead of native resolution

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play/Pause |
| K | Play/Pause |
| J | Step backward (0.1s) |
| L | Step forward (0.1s) |
| ← / → | Step ±0.1s |
| Home | Go to start |
| End | Go to end |
| Delete | Delete selected clip |
| Shift+Delete | Ripple delete selected clip |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+C | Copy clip |
| Ctrl+V | Paste clip |
| Ctrl+X | Cut at playhead |
| Ctrl++ / Ctrl+- | Zoom in/out timeline |
| Ctrl+Scroll | Zoom in/out timeline |
| F | Toggle video focus mode |
| Escape | Deselect / close modals |

---

## PWA / Offline

- **Service Worker** (`service-worker.js`): app-shell precache, version is `cuttheflow-shell-v3.4.0`. **Bump `CACHE_NAME`** whenever the app shell list changes — old caches are pruned in `activate`.
- **APP_SHELL** lists 16 cacheable assets + `FONT_ASSETS` (self-hosted woff2). Splash photos are NOT precached — splash uses `picsum.photos` web URL only (see `initSplashScreen` in `js/app.js`).
- **Asset versioning**: `tools/sync-asset-hashes.js` computes a 10-char SHA-256 of each tracked file and rewrites `?v=<hash>` references in `index.html`, `manifest.json`, `service-worker.js`. Run after **every** edit to any tracked CSS/JS/icon asset:
  ```
  node tools/sync-asset-hashes.js
  ```
- **PWA icons**: regenerated from the master `img/CUT_THE_FLOW_b.svg` (extracts the only visible group `CUT_x5F_THE_x5F_FLOW_-_blanc`). Run:
  ```
  node tools/generate-icons.js && node tools/sync-asset-hashes.js
  ```
  Outputs: `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (logo at 70% scale + 90px translate for Android safe-area), `apple-touch-icon.png`. All on `#1a1a1a` background to match `theme_color` / `background_color`.
- **Splash screen** (`initSplashScreen`): picsum-only, no local fallback. `<img id="splashImage" src="" style="opacity:0">` in `index.html` (L412); JS sets `src` to a picsum URL, fades in on `onload`, hides on `onerror`.
- **Install / Export buttons** (`installPwaBtn`, `export-btn` in toolbar L566/L574): both visible on desktop AND mobile (no `desktop-only` class). Both use the toolbar `.toolbar-icon` 32×32 sizing — `.toolbar-icon.export-btn` rule in `css/style.css` forces `padding:0; flex:none; width:32px; height:32px` to override the generic `.export-btn` modal-button style.
- **PWA install icon SVG**: phone outline + downward arrow (rect + polyline + line). Distinct from the export icon (upload arrow).

---

## Common Pitfalls

- **Never** call `renderTracks()` on every mouse event — it destroys/rebuilds all clip DOM nodes. Only call after actual state change.
- **Always** call `updatePreview()` after any mutation that affects what the user sees (selectClip, deleteClip, drag, cut, etc.). Missing `updatePreview()` is the #1 source of "stale preview" bugs.
- **Always** use `quantizeTime()` when setting `clip.startTime`, `clip.sourceStart`, `clip.duration`.
- **Image/text/block** clips have `sourceDuration = Infinity` — always use `'__INF__'` reviver on JSON.parse.
- **`media.url`** may be a proxy. For audio extraction and export, use **`media.originalUrl`**.
- **`audioContext.resume()`** must happen **before** `mediaRecorder.start()` to avoid audio leading video.
- **WebCodecs encoder is video-only** — no audio is muxed. The UI badge says so explicitly (`⚠️ Video Only (No Audio)`). Do not pretend otherwise.
- **"transmux" is not a real transmux** — it's MediaRecorder with MP4 codec preference + WebM fallback. There is no demux/remux step. Don't add MP4Box.js calls here.
- **WebCodecs MP4 muxing** uses a fixed 90 kHz timescale (industry standard); `ticksPerFrame = 90000 / fps`. Never use `fps * 1000` as timescale with `1000000 / fps` durations — that produces ~33× slowdown.
- **`saveState()`** takes a deep clone — call it once after all mutations, not inside loops.
- `updateClipProperty` is a live/preview update (no save). `commitClipProperty` is the final save-triggering version.
- Tracks have `_effectiveMute` (computed from solo logic) — check both `track.muted` and `track._effectiveMute` before rendering or exporting.
- **Never** allow `this.isExporting = true` to persist without cleanup — always have error handlers that reset it.
- **Preview video resync threshold** is 8ms (0.008s) — lowered from 50ms for snappier response.
- **Service Worker `CACHE_NAME`** must be bumped whenever `APP_SHELL` content changes — otherwise clients keep serving the old cached version. Without a bump, even `sync-asset-hashes.js` won't help (the SW will return the old precached entry on its first match). Currently at `cuttheflow-shell-v3.5.0`.
- **PWA icons must NOT be edited by hand** — regenerate via `tools/generate-icons.js` so the brand stays consistent. Then run `tools/sync-asset-hashes.js` to refresh `?v=` query strings everywhere.
- **Splash photo source** is intentionally `picsum.photos` (not a local file). Never re-introduce local `splash-photo-*.webp` precaching — they were removed from APP_SHELL in v3.4.0 to save 160KB.
