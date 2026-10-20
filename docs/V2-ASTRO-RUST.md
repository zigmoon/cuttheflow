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
| Binaire macOS (arm64 + Intel) | CI GitHub Actions | workflow ✅, exécution à faire |
| Signature / notarisation macOS | même workflow | ad-hoc par défaut, Developer ID si secrets |

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
| macOS Apple Silicon | `aarch64-apple-darwin` | CI uniquement |
| macOS Intel | `x86_64-apple-darwin` | CI uniquement |

macOS ne peut pas être produit depuis Windows (SDK Apple requis pour le linkage
Mach-O) : le workflow `.github/workflows/cuttheflow.yml (racine du dépôt)` s'en charge.

Signature macOS en deux niveaux :
1. signature **ad-hoc** systématique — obligatoire sur Apple Silicon, un binaire
   non signé est tué au lancement ;
2. signature **Developer ID + notarisation + agrafage** si les secrets
   `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`,
   `MACOS_NOTARY_*` sont présents.

Les deux niveaux sont indépendants : sans secrets, le workflow publie des
binaires exécutables, simplement non notariés. C'est le comportement demandé
(« signature si ça marche, sinon sans »).

## Ce qu'il reste à faire

1. Exécuter le workflow sur GitHub pour produire les deux binaires macOS.
2. Exposer les sous-titres, les proxys 4K et l'historique undo/redo (le modèle et
   le moteur sont déjà prévus).
3. Embarquer ffmpeg (ou un installeur qui le pose à côté du binaire) pour
   supprimer la dépendance externe.
4. Tests d'interface automatisés (aujourd'hui vérifiés à la main dans Chrome).
