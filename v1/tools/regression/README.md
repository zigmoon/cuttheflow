# Banc de régression — CUT THE FLOW

Ce dossier contient les outils qui **prouvent** que l'export est correct. Ils ont servi à
trouver et corriger, le 2026-09-16, le décalage son/image (erreur d'image de 878 ms en
moyenne avant correctif → 0 ms après) et les saccades (1 image sur 3 dupliquée/sautée → 0).

Les scripts ne font partie d'aucun chemin de production : ils pilotent un **Chrome réel**
via le protocole CDP et vérifient les fichiers produits avec **ffmpeg**.

## Prérequis

- Node ≥ 22 (le `WebSocket` natif est utilisé — aucune dépendance npm).
- Google Chrome installé dans `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- ffmpeg / ffprobe dans le `PATH`.

## Utilisation

```powershell
# 1. Générer les médias de test (une seule fois, ~30 Mo dans media/)
powershell -ExecutionPolicy Bypass -File tools/regression/make-media.ps1

# 2. Lancer le montage complet, les exports et les vérifications
node tools/regression/montage.cjs

# 3. Itérer vite : export MP4 seul (~2 min au lieu de ~6)
node tools/regression/montage.cjs --quick
```

Le rapport est écrit dans `tools/regression/out/report.json` et les fichiers produits dans
`tools/regression/out/` (ignorés par git). Le script sort en **code 0** seulement si **toutes**
les vérifications passent ; le bilan est affiché à la fin (ex. `29/29 vérifications réussies`).

## Ce que le banc construit

Un montage de **13 s sur 5 pistes** qui exerce tous les types de clip et l'ordre des calques :

| Piste | Contenu |
|---|---|
| `VIDEO 1` (premier plan) | texte « TITRE » (blanc, 140 px, **ombre activée**) de 6,5 à 8,5 s |
| `VIDEO 2` | forme (bloc bleu 40 %×40 %, opacité 0,8) de 6,5 à 8,5 s |
| `VIDEO 3` | `a.mp4` 0→6 s, `img.png` (magenta) 6→9 s, `b.mp4` 9→13 s |
| `AUDIO 1` | `music.wav` (300 Hz) 0→13 s |
| `AUDIO 2` | `beep.wav` (1500 Hz) 6→9 s |

Les sources vidéo portent des **repères audio** : `a.mp4` = 440 Hz 0-2 s, 880 Hz 2-4 s,
440 Hz 4-6 s ; `b.mp4` = 1200 Hz. On peut donc vérifier l'alignement son/image au
millième de seconde en suivant ces fréquences dans le fichier exporté.

> Le texte et la forme sont volontairement placés **en même temps** que l'image magenta :
> c'est la seule façon de vérifier l'ordre des calques (premier plan vs fond) sur un fond
> de couleur connue.

## Ce qui est vérifié

1. **Durée et nombre d'images** (390 images à 30 fps pour 13 s).
2. **Synchro son/image, mesurée par fréquence repère.** Chaque fréquence est suivie
   séparément (`freqRanges` : Goertzel par fenêtres de 20 ms, seuil relatif à son propre
   maximum) et sa plage d'apparition doit tomber à ±40 ms de l'attendu :
   `880 Hz` = a.mp4 de 2 à 4 s · `1500 Hz` = beep.wav de 6 à 9 s · `1200 Hz` = b.mp4 à partir
   de 9 s.
   ⚠️ **Ne pas revenir à « la fréquence dominante par fenêtre »** (1ʳᵉ version) : la musique
   (300 Hz) joue **en même temps** que le son des clips, la dominante oscille d'une fenêtre à
   l'autre et le détecteur annonçait **33 bascules** au lieu des 4 réelles — tout en accusant
   à tort la synchronisation de l'export.
3. **Aucune image noire** aux deux coupes (6,000 s et 9,000 s) : luminance moyenne ≥ 20/255.
4. **Calques composites** : la teinte bleue de la forme doit être présente à 7,5 s et absente
   à 6,1 s et 8,9 s ; le texte doit amener du **blanc pur** (luminance max > 200/255) dans la
   bande centrale à 7,5 s. ⚠️ **Ne pas mesurer la luminance MOYENNE de l'image entière** pour
   prouver la présence du texte : la forme bleue (opacité 0,8, sombre) s'affiche en même temps
   et fait baisser la moyenne — le test comparait « texte + forme » à « magenta seul » et
   échouait alors que tout était correct.
5. **Fidélité de la séquence** — le contrôle le plus fort. Les images de la 1ʳᵉ séquence
   (`a.mp4`, 0→5,9 s, **aucun overlay** sur cette plage) sont comparées à la SOURCE image par
   image : chaque image est réduite à 1 pixel de luminance (`scale=1:1,format=gray`) dans les
   deux fichiers, puis on exige **0 image d'écart > 2/255**. Cela prouve d'un coup qu'aucune
   image n'est décalée, dupliquée, noire ou tirée d'un autre instant de la timeline.
   ⚠️ Ne pas chercher à coder le numéro d'image dans la luminance : la compression H.264 la
   rend illisible (essayé, chiffres incohérents) — la moyenne 1×1, elle, est fiable.
6. **Cadence** : les statistiques de `CTFFrameSource` doivent afficher
   `0 duplication, 0 saut, erreur 0,0 ms`.
7. **Aller-retour projet** : le montage est enregistré en `.ctf` **et** en `.json`, puis la
   page est **rechargée** et les deux fichiers sont rechargés ; pistes, clips et **format
   d'export** doivent être identiques (c'est le test qui valide le format projet). Le format
   mémorisé en `localStorage` est **effacé avant le rechargement**, sinon la page repartirait
   déjà sur la bonne valeur et le test ne prouverait rien.
8. **MP3** : vrai MP3 décodable, mêmes plages de fréquence que le MP4 (±20 ms).
9. **WEBM** : 390 images et repères audio identiques au MP4 (±20 ms).

## Où passe le temps d'export (mesuré, 2026-09-17)

Montage de 13 s / 390 images à 1280×720 (export MP4 ≈ 12 s) :

| Poste | ms/image | part |
|---|---|---|
| **Extraction de l'image (seek + `seeked`)** | **24,5** | **≈ 80 %** |
| `encoder.encode()` | 2,0 | 6 % |
| `ctx.drawImage` (vidéo / image) | 0,23 | 0,8 % |
| Overlays (texte avec ombre + forme) | 0,12 | 0,4 % |
| `new VideoFrame(canvas)` | 0,06 | 0,2 % |

Conclusion : le rendu et les overlays ne coûtent rien, **tout se joue sur le décodage**.

⚠️ **Piège de mesure déjà tombé dedans** : calculer `draw = (fin d'image − début du seek) −
moyenne du seek` fabrique un **faux pic** sur les portions sans vidéo (image fixe), car tout le
temps de l'image y est compté comme « draw ». Cette erreur a fait monter le « draw » cumulé de
7 à 217 ms/image pendant l'affichage du titre, ce qui accusait à tort le texte. Le texte coûte
en réalité 0,12 ms. **Toujours mesurer des postes indépendants, et vérifier que leur somme
retombe sur le temps réel.**

## ⚠️ Deux pièges d'environnement qui font échouer le banc

1. **Un Chrome déjà lancé sur le port de debug.** Le script démarre Chrome avec
   `--remote-debugging-port=9222` et supprime le profil au passage. Si un Chrome tourne déjà sur
   ce port, le nouveau n'ouvre rien, le CDP se connecte au **vieux** navigateur (dont le profil
   vient d'être effacé) et tout part de travers : imports refusés (« durée invalide (0) »),
   exports qui n'avancent plus. Le script refuse maintenant de démarrer dans ce cas, et tue
   l'arbre de processus Chrome à la fin (`taskkill /T`).
2. **Le gel des onglets en arrière-plan.** Un export dure plusieurs minutes pendant lesquelles
   la fenêtre Chrome n'est pas au premier plan (on travaille dans l'éditeur). Chrome bride alors
   les `setTimeout` à 1 s, puis **gèle** l'onglet : la boucle d'encodage se fige
   (`271/390 images` et plus rien). Le lancement passe donc
   `--disable-background-timer-throttling --disable-renderer-backgrounding
   --disable-backgrounding-occluded-windows
   --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling`.

   En clair : un export « qui ne finit jamais » dans un onglet non visible est un artefact de
   Chrome, pas un bug de CUT THE FLOW.

## Pourquoi ces mesures sont fiables

- Le son est mesuré par **transformée de Goertzel** par fenêtres de 10 ms, pas à l'oreille.
- La luminance moyenne est extraite par `ffmpeg -vf scale=1:1,format=gray -f rawvideo -`
  (1 octet par image).
- ⚠️ **Ne pas** utiliser une mire dont la luminance code le numéro de frame : la compression
  H.264 la rend inexploitable (test essayé, chiffres incohérents).
- Le service worker recharge la page au premier chargement (`controllerchange`) : le banc
  attend la fin de ce rechargement, sinon il évalue dans un ancien contexte et croit que
  l'application n'a pas démarré.
