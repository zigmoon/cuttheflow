# CUT THE FLOW — interface Astro

Interface d'édition du moteur Rust. Astro est utilisé comme **bundle statique** :
aucun serveur Node n'est livré, `dist/` est embarqué dans le binaire Rust.

Le studio reprend le langage visuel de **SuperPhoto** (dossier `2.13/superphoto`,
thème sombre) : jetons de couleur, barre supérieure fine (58 px), panneaux
latéraux avec en-tête « surtitre + titre », toile posée sur une grille avec une
ombre profonde, barre d'état monospace. Le thème clair existe aussi (bouton
soleil/lune, préférence mémorisée) ; le sombre est le défaut.

## Développement

```bash
cd astro
npm install
npm run dev            # http://127.0.0.1:4321
```

Dans un autre terminal :

```bash
cd rust
cargo run -- serve --port 7317 --no-open
```

L'interface détecte le port de développement et parle à `http://127.0.0.1:7317`.
Sur un autre port : `?api=http://127.0.0.1:PORT`. `?reset=1` ignore et efface la
reprise de session locale (utile pour repartir d'un projet vierge).

## Construction

```bash
npm run check          # diagnostics TypeScript/Astro (0 erreur attendue)
npm run build          # → dist/ (index.html + _astro/*)
cd ../rust && cargo build --release -p ctf-app
```

`crates/ctf-app/build.rs` lit `astro/dist` **à la compilation**. Si le dossier est
absent, le binaire reste compilable et sert une page de secours qui explique la
marche à suivre.

## Organisation

```
src/layouts/StudioLayout.astro   <head>, thème appliqué avant le premier rendu
src/components/BrandMark.astro   logo CUT THE FLOW (tracés d'origine, currentColor)
src/components/IconSprite.astro  sprite SVG inline (aucune requête réseau)
src/pages/index.astro            structure de l'écran (aucune logique métier)
src/styles/studio.css            design system (jetons clair/sombre + composants)
src/scripts/editor.ts            état, import, propriétés, effets, export
src/scripts/state.ts             modèle identique à ctf-core (µs, cadence rationnelle)
src/scripts/preview.ts           composition canvas, effets approximés, audio
src/scripts/timeline.ts          rendu DOM, déplacement, rognage, playhead
src/scripts/api.ts               client de l'API Rust (import, médias, jobs)
public/img/                      icônes et logo d'origine, repris tels quels de la v1
public/manifest.webmanifest      identité d'installation (mêmes icônes que la v1)
```

### Identité visuelle

Le logo n'est **pas** redessiné. `BrandMark.astro` reprend les tracés exacts du
groupe `CUT_x5F_THE_x5F_FLOW` de `img/CUT_THE_FLOW_b.svg` (le fichier de la v1) :

- rendu en `currentColor`, donc blanc sur le thème sombre et noir sur le thème
  clair, sans second fichier ni bascule JavaScript ;
- `viewBox` recadré sur l'encre réelle (`21 127 558 346`) au lieu du carré
  `0 0 600 600` d'Illustrator, qui réservait 40 % de vide ;
- vérifié au pixel : rendu comparé au fichier d'origine, **0 pixel différent**
  sur 193 068 (mêmes formes, mêmes proportions, même place) ;
- barre supérieure 28 px de haut, état vide 58 px, clic = raccourcis (comme
  `app.showLogo` → FAQ dans la v1).

Les icônes d'onglet et d'installation sont les fichiers d'origine, servis tels
quels : `CUT_THE_FLOW_b.svg`, `icon-192.png`, `icon-512.png`,
`icon-512-maskable.png`, `apple-touch-icon.png`.

L'interface **n'encode rien** : elle envoie le projet au moteur, qui rend le
fichier. C'est ce qui garantit un résultat identique sur toutes les machines.

## Fonctionnalités

- **écran d'accueil** avec le logo : il s'efface quand le moteur a répondu
  (≈ 0,5 s, plafond 2,5 s) et ne bloque jamais — un filet de sécurité le retire
  même si l'initialisation échoue ;
- import par glisser-déposer (depuis le bureau, voile plein écran) ou sélecteur,
  vignettes, métadonnées ; dédoublonnage par nom + taille ;
- pistes vidéo et audio, insertion de texte, rectangles et ellipses ;
- déplacement, rognage gauche/droit, accrochage (0 s, playhead, bords de clips) ;
- **coupe au playhead** (bouton, `S`, ou ciseaux de la barre supérieure) ;
- propriétés : nom, début, durée, départ source, volume, fondus, échelle,
  position, **rotation**, opacité, texte, forme, coupure du son d'un clip vidéo ;
- **effets** par clip (flou, netteté, vignette, grain, luminosité, noir et blanc,
  sépia, chaud, froid, inversion, miroir, retournement, pixelisation) avec
  intensité ; un effet reste dans son clip ;
- **transitions** entre clips adjacents d'une même piste : fondu depuis le fond
  ou fondu enchaîné, avec affichage des marges disponibles ;
- preview temps réel avec audio (recalage au-delà de 180 ms de dérive), zoom et
  ajustement à la fenêtre ;
- enregistrement local automatique, ouverture/export de projet `.ctf.json` ;
- export MP4 / WebM / MP3 avec avancement, annulation et téléchargement ;
- panneaux escamotables, timeline redimensionnable, thème clair/sombre.

## Raccourcis

| Touche | Action |
|---|---|
| Espace | lecture / pause |
| ← / → | ±1 image (Maj : ±1 s) |
| Début / Fin | début / fin de timeline |
| S | couper le clip au playhead |
| Suppr / Retour arrière | supprimer le clip sélectionné |
| Ctrl/Cmd + D | dupliquer le clip |
| T / R / C | ajouter un texte / rectangle / ellipse |
| N | accrochage |
| + / − | zoom de la timeline |
| Ctrl/Cmd + 0 | ajuster l'aperçu |
| Ctrl/Cmd + I | importer |
| Ctrl/Cmd + O | ouvrir un projet |
| Ctrl/Cmd + S | enregistrer |
| Ctrl/Cmd + E | exporter |
| Ctrl/Cmd + N | nouveau projet |
| Ctrl/Cmd + , | préférences |
| ? | raccourcis |

## Limites (v2.1)

- Les sous-titres, proxys 4K et l'historique undo/redo ne sont pas encore
  exposés (le modèle et le moteur sont prévus).
- La preview approxime certains effets (grain, pixelisation) : l'export, lui,
  est exact. Les effets qui changent la géométrie (miroir, retournement,
  rotation) sont, eux, fidèles.
