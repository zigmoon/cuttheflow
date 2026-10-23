# CUT THE FLOW — moteur Rust

Moteur d'import/export déterministe, et serveur local de l'interface Astro.
Un seul binaire autonome par plateforme : l'interface est **embarquée** dans
l'exécutable, il n'y a ni Node ni installation à faire chez l'utilisateur.

```
crates/
  ctf-core/     modèle de timeline, plan de transitions, sondage ffprobe,
                graphe de filtres (pur — aucun processus)
  ctf-engine/   exécution ffmpeg : formes, mixage audio, composition, export
  ctf-app/      binaire : CLI + serveur HTTP + interface embarquée
scripts/
  build.ps1             construction Windows + Linux (hôte Windows)
  verify-export.mjs     banc de régression (45 vérifications)
  macos-entitlements.plist  droits de la signature macOS
```

## Pourquoi ce moteur

La v1 (navigateur) exportait correctement — le banc `tools/regression` le prouve,
29/29 — mais elle dépendait de WebCodecs : Safari/Firefox n'ont pas d'encodeur
H.264, le repli temps réel étire les montages longs, et un export dans un onglet
caché se fige. Surtout, le résultat dépendait du matériel (encodeur du GPU).

Le moteur Rust confie l'encodage à **ffmpeg**. Il ne fait que deux choses, mais
il les fait exactement :

1. **Mixage audio séparé**, en PCM flottant 48 kHz, échantillon par échantillon.
   Chaque clip est placé par `adelay` en **nombre d'échantillons** (pas en
   millisecondes), puis mélangé avec `amix=normalize=0` sur un lit de silence de
   la durée exacte de la timeline.
2. **Composition vidéo** avec une entrée par clip, un `trim` au cadre source,
   `setpts` pour placer le clip sur la timeline, `fps` pour imposer la cadence,
   puis `overlay` activé sur la fenêtre temporelle du clip.

Les deux flux commencent à t = 0 et sont coupés à la même durée (`-t`), donc
aucun décalage ne peut s'installer.

> ⚠️ Le point le plus fragile est le décalage `setpts`. `overlay` synchronise ses
> deux entrées par PTS : sans `setpts=PTS+start/TB`, un clip placé à 6 s
> afficherait sa propre 6ᵉ seconde dès la première image de sa fenêtre.

## Effets, transitions, formes

### Effets

Un effet est une propriété du **clip** : il est appliqué dans sa chaîne de
filtres, après le redimensionnement et avant la composition. Il ne peut donc pas
déborder sur le clip voisin.

| Nom | Filtre ffmpeg |
|---|---|
| `blur` | `gblur=sigma=0.4…22` |
| `sharpen` | `unsharp=5:5:0…2` |
| `vignette` | `vignette=angle=0.3…1.0` |
| `grain` | `noise=alls=0…40:allf=t` |
| `brightness` | `eq=brightness=-0.3…+0.3` |
| `grayscale` | `hue=s=0` |
| `sepia` | `colorchannelmixer` (matrice sépia) |
| `warm` / `cool` | `colorbalance` |
| `invert` | `negate` |
| `mirror` / `flip` | `hflip` / `vflip` |
| `pixelate` | `scale` réduit puis `scale` retour, `flags=neighbor` |

Un nom inconnu est **ignoré** : un projet écrit par une version plus récente
s'exporte quand même.

### Transitions

Deux natures, dans `crates/ctf-core/src/plan.rs` :

- **`fade`** — fondu depuis le fond : simple rampe alpha au début du clip,
  aucune fenêtre déplacée. La synchronisation est garantie par construction.
- **`dissolve`** — fondu enchaîné : la fenêtre du clip entrant recule de `d`,
  s'allonge de `d` (le point de sortie reste inchangé, donc pas de trou avant
  le clip suivant) et son point d'entrée source recule **exactement de `d`**.
  L'image et le son subissent le même décalage et le même allongement, sinon le
  son arriverait `d` trop tard.

`d` est borné par les marges réellement disponibles : marge avant du clip
entrant (`source_start`), marge après du clip sortant (durée du média − point de
sortie), et la moitié de chaque clip. Sans marge, `d` tombe à 0 et la transition
devient un fondu depuis le fond — **jamais** un décalage approximatif.

Les clips doivent se toucher : on ne rapproche jamais deux clips pour forcer une
transition.

### Formes

Une ellipse (ou un rectangle arrondi) n'existe pas comme filtre ffmpeg. `geq`
les dessine exactement mais coûte cher par image ; le moteur le paie donc **une
seule fois** : la forme est rasterisée en PNG RGBA transparent, puis bouclée
comme une image. Un seul jeu de formules couvre rectangle net (`radius = 0`),
rectangle arrondi et ellipse (`radius = min(w,h)/2`).

## Garanties mesurées

Le banc `scripts/verify-export.mjs` rejoue le montage de référence de la v1
(13 s, 5 pistes : vidéo + image + texte + 2 audio, repères à 880/1500/1200 Hz) et
vérifie les fichiers avec ffmpeg :

| Contrôle | Résultat |
|---|---|
| Images (13 s à 30 i/s) | **390/390** |
| Durée vidéo / audio | **13,000 s / 13,000 s** |
| Synchro MP4 (début et fin de chaque repère) | **0 ms** |
| Synchro WebM − MP4 | **0 ms** |
| Synchro MP3 − MP4 | **0 ms** |
| Images noires aux coupes | **aucune** (luminance min 67/255) |
| Texte blanc à 7,5 s | **255/255** |
| Fidélité image par image vs source | **0 image différente** sur 177 |
| Total | **45/45** |

Reproduire :

```powershell
cd rust
# une fois : les médias du banc (ignorés par git, générés par ffmpeg)
powershell -ExecutionPolicy Bypass -File ..\v1\tools\regression\make-media.ps1
node scripts/verify-export.mjs --bin .\target\release\cuttheflow.exe
```

Contrôles complémentaires (faits à la main, projet `fx-test.json`) : sépia
appliqué (`44,39,30` au centre), ellipse exacte (`240,239,242` = `#F0F0F2`),
fondu enchaîné avec fenêtre et source décalées de 0,5 s dans le graphe généré.

## Démarrage

```bash
cuttheflow                      # = serve → http://127.0.0.1:7317/
cuttheflow serve --port 7317 --no-open
cuttheflow doctor               # ffmpeg, encodeurs, police
cuttheflow probe film.mp4
cuttheflow export projet.json --out montage.mp4 --format mp4 --crf 18
```

ffmpeg est cherché dans `CTF_FFMPEG` / `CTF_FFPROBE`, puis à côté de
l'exécutable, puis dans le `PATH`. La police des clips texte suit le même ordre
(`CTF_FONT`, dossier de l'exécutable, polices système).

## API locale

Toutes les routes sont sur `127.0.0.1` et le serveur refuse les origines
distantes (sauf `localhost`/`127.0.0.1`, pour le développement Astro).

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/health` | version ffmpeg, police, nombre de médias |
| `POST` | `/api/import?name=…` | corps = fichier ; sonde et enregistre |
| `GET` | `/api/media` | registre des médias |
| `GET` | `/api/media/{id}` | flux avec support **Range** (lecture vidéo) |
| `GET` | `/api/media/{id}/thumbnail` | vignette JPEG (cache) |
| `GET` | `/api/media/{id}/waveform` | pics normalisés (JSON) |
| `DELETE` | `/api/media/{id}` | supprime le fichier et l'entrée |
| `POST` | `/api/export` | `{project, format, crf, preset}` → `{job_id}` |
| `GET` | `/api/jobs/{id}` | état, avancement, résultat |
| `POST` | `/api/jobs/{id}/cancel` | annule (tue ffmpeg) |
| `GET` | `/api/jobs/{id}/file` | téléchargement du fichier |

Le projet envoyé ne contient **jamais** de chemin de fichier : le serveur résout
chaque `media.id` dans son registre. Un projet forgé ne peut donc pas lire un
fichier arbitraire de la machine.

## Modèle de projet

Temps en **microsecondes** (`i64`), cadence rationnelle (`30000/1001`).
Voir `crates/ctf-core/src/model.rs`.

```jsonc
{
  "id": "c…", "type": "video|image|audio|text|shape",
  "start_us": 0, "duration_us": 6000000, "source_start_us": 0,
  "volume": 1, "fade_in_us": 0, "fade_out_us": 0,
  "scale": 1, "x": 0.5, "y": 0.5, "opacity": 1, "rotation": 0,
  "audio_muted": false,
  "effects": [{ "name": "sepia", "amount": 1 }],
  "transition": { "kind": "dissolve", "duration_us": 500000 },
  "text":  { "content": "…", "size": 96, "color": "#FFFFFF" },
  "shape": { "kind": "ellipse", "color": "#FF4D6D",
             "width": 0.3, "height": 0.3, "radius": 0.5 }
}
```

`Project::validate` vérifie tout avant le rendu (identifiants uniques, durées,
fondus, effets, transitions, couleurs, types de médias, résolution paire).

## Construction

### Windows (sans Visual Studio)

La machine de référence n'a pas les Build Tools MSVC ; le projet se construit
avec **LLVM-MinGW** (toolchain `stable-x86_64-pc-windows-gnullvm`) :

```powershell
cargo +stable-x86_64-pc-windows-gnullvm build --release -p ctf-app
# → target\release\cuttheflow.exe
```

Avec Visual Studio installé, `cargo build --release` suffit.

### Linux (cross-compilation depuis Windows)

Le binaire est **statique** (musl), donc il tourne sur n'importe quelle
distribution x86-64 ou ARM64 :

```powershell
rustup target add x86_64-unknown-linux-musl --toolchain stable-x86_64-pc-windows-gnullvm
rustup target add aarch64-unknown-linux-musl --toolchain stable-x86_64-pc-windows-gnullvm
$env:CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER = (Get-Command ld.lld).Source
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER = (Get-Command ld.lld).Source
cargo +stable-x86_64-pc-windows-gnullvm build --release --target x86_64-unknown-linux-musl -p ctf-app
cargo +stable-x86_64-pc-windows-gnullvm build --release --target aarch64-unknown-linux-musl -p ctf-app
```

### macOS (cross-compilation depuis Windows)

Le linkage Mach-O passe par **Zig**, qui fournit les stubs de la `libSystem` :
aucun Mac n'est nécessaire. Une seule fois :

```powershell
cargo +stable-x86_64-pc-windows-gnullvm install cargo-zigbuild --locked
rustup +stable-x86_64-pc-windows-gnullvm target add aarch64-apple-darwin x86_64-apple-darwin
# Zig dans le PATH (https://ziglang.org/download/) — testé avec 0.14.1
cargo +stable-x86_64-pc-windows-gnullvm zigbuild --release --target aarch64-apple-darwin -p ctf-app
cargo +stable-x86_64-pc-windows-gnullvm zigbuild --release --target x86_64-apple-darwin -p ctf-app
```

`scripts/build.ps1` enchaîne ces deux cibles dès que `zig` et `cargo-zigbuild`
sont présents ; sinon l'étape est ignorée avec un avertissement. Le workflow
`.github/workflows/cuttheflow.yml` reste la voie officielle (runners macOS) et
ajoute la signature.

Signature, en deux niveaux :

1. **toujours** une signature ad-hoc (`codesign --force --sign -`). Ce n'est pas
   cosmétique : sur Apple Silicon, un binaire non signé est tué par le noyau ;
2. **si les secrets sont fournis**, signature Developer ID avec `--options
   runtime` et `rust/scripts/macos-entitlements.plist`, puis
   `notarytool submit --wait` et `stapler staple`.

Secrets attendus (Settings → Secrets and variables → Actions) :
`MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`,
`MACOS_NOTARY_APPLE_ID`, `MACOS_NOTARY_PASSWORD`, `MACOS_NOTARY_TEAM_ID`
(ou la variante clé API : `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER_ID`,
`MACOS_NOTARY_KEY_P8`).

Sans ces secrets, le workflow **réussit quand même** : les binaires sont
exécutables, simplement non notariés. Les deux étapes sont indépendantes, donc
une signature en échec n'empêche pas la publication du fichier ad-hoc signé.

### Tout-en-un

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
# interface Astro + Windows + Linux x64/ARM64 + macOS arm64/x86_64
# + dist/ + SHA256SUMS.txt
```

Les binaires macOS produits ici ne sont **pas signés** (Zig ne signe pas) : sur
Apple Silicon, il faut appliquer la signature ad-hoc sur le Mac (`codesign
--force --sign - cuttheflow-macos-arm64`) avant exécution. Le workflow CI le
fait automatiquement.

## Tests

```bash
cargo test --workspace                 # 31 tests unitaires (temps, modèle, plan, graphes, WAV)
node scripts/verify-export.mjs         # 45 vérifications ffmpeg (médias requis)
```

## Limites connues (v2.1)

- L'interface n'expose pas encore les sous-titres, les proxys 4K ni l'undo.
- Le serveur n'a pas d'authentification : il est prévu pour écouter sur
  `127.0.0.1`. Ne le lancez pas sur `0.0.0.0` sans proxy authentifié.
- ffmpeg n'est pas embarqué dans le binaire (licence et taille) : `doctor`
  vérifie sa présence et explique comment l'installer.
- macOS : binaires ad-hoc signés par CI ; notarisation seulement si les secrets
  sont configurés.
