/* ============================================================================
 * CUT THE FLOW — i18n (FR / EN)
 * ----------------------------------------------------------------------------
 * Lightweight, dependency-free translation layer.
 *  - Static UI is translated by matching the original DOM text / attribute
 *    against a dictionary keyed by the ORIGINAL string (EN or FR as authored).
 *    Only strings present in the dictionary are ever touched, so untranslated
 *    or dynamic content is left untouched.
 *  - Dynamic status messages (app.showStatus) go through I18N.dyn().
 *  - Default language: EN. Persisted in localStorage('ctf_lang').
 *
 * All strings use backtick literals to avoid quote/apostrophe escaping issues.
 * ========================================================================== */
(function () {
    'use strict';

    // ---- Static dictionary : [ originalString, EN, FR ] ---------------------
    const S = [
        // ── Splash ──
        [`VIDEO EDITOR`, `VIDEO EDITOR`, `MONTAGE VIDÉO`],
        [`Creators`, `Creators`, `Créateurs`],
        [`Features`, `Features`, `Fonctions`],
        [`Timeline • Audio Mix • Export`, `Timeline • Audio Mix • Export`, `Timeline • Mixage audio • Export`],
        [`Loading`, `Loading`, `Chargement`],

        // ── Toolbar tooltips ──
        [`Undo (Ctrl+Z)`, `Undo (Ctrl+Z)`, `Annuler (Ctrl+Z)`],
        [`Redo (Ctrl+Y)`, `Redo (Ctrl+Y)`, `Rétablir (Ctrl+Y)`],
        [`Add Text Layer (T)`, `Add Text Layer (T)`, `Ajouter un calque texte (T)`],
        [`Add Color Block`, `Add Color Block`, `Ajouter un bloc couleur`],
        [`Color Grading`, `Color Grading`, `Étalonnage couleur`],
        [`Animation (animer images, logos, vidéos)`, `Animation (animate images, logos, videos)`, `Animation (animer images, logos, vidéos)`],
        [`Effects (FX)`, `Effects (FX)`, `Effets (FX)`],
        [`Fade / Transition`, `Fade / Transition`, `Fondu / Transition`],
        [`Format / Aspect Ratio`, `Format / Aspect Ratio`, `Format / Ratio d'image`],
        [`Open Project`, `Open Project`, `Ouvrir un projet`],
        [`Save Project`, `Save Project`, `Enregistrer le projet`],
        [`AI Edit Assistant`, `AI Edit Assistant`, `Assistant IA de montage`],
        [`Preferences`, `Preferences`, `Préférences`],
        [`PREFERENCES`, `PREFERENCES`, `PRÉFÉRENCES`],
        [`Install CUT THE FLOW`, `Install CUT THE FLOW`, `Installer CUT THE FLOW`],
        [`Export Video`, `Export Video`, `Exporter la vidéo`],

        // ── Format menu ──
        [`Paysage • YouTube, TV`, `Landscape • YouTube, TV`, `Paysage • YouTube, TV`],
        [`Portrait • TikTok, Reels`, `Portrait • TikTok, Reels`, `Portrait • TikTok, Reels`],
        [`Carré • Instagram`, `Square • Instagram`, `Carré • Instagram`],
        [`Portrait • Instagram Post`, `Portrait • Instagram Post`, `Portrait • Instagram Post`],
        [`Classique`, `Classic`, `Classique`],
        [`Cinéma Ultra-large`, `Cinema Ultra-wide`, `Cinéma Ultra-large`],

        // ── Media library ──
        [`MEDIA LIBRARY`, `MEDIA LIBRARY`, `MÉDIATHÈQUE`],
        [`Import media files — select multiple files at once`, `Import media files — select multiple files at once`, `Importer des fichiers média — sélectionnez plusieurs fichiers à la fois`],
        [`IMPORT YOUR FILES`, `IMPORT YOUR FILES`, `IMPORTEZ VOS FICHIERS`],
        [`Drag & drop here`, `Drag & drop here`, `Glissez-déposez ici`],
        [`or click — sélection multiple possible`, `or click — multiple selection possible`, `ou cliquez — sélection multiple possible`],
        [`Open Media Library`, `Open Media Library`, `Ouvrir la médiathèque`],
        [`MEDIA`, `MEDIA`, `MÉDIA`],

        // ── FX panel ──
        [`CLIP EFFECTS`, `CLIP EFFECTS`, `EFFETS DU CLIP`],
        [`No effect applied`, `No effect applied`, `Aucun effet appliqué`],
        [`Cumulables — cliquez plusieurs FX. Re-cliquez un FX actif pour régler son intensité, encore une fois pour le retirer.`, `Stackable — click several FX. Click an active FX again to adjust its intensity, once more to remove it.`, `Cumulables — cliquez plusieurs FX. Re-cliquez un FX actif pour régler son intensité, encore une fois pour le retirer.`],
        [`Pixelate`, `Pixelate`, `Pixellisation`],
        [`Invert`, `Invert`, `Inverser`],
        [`Blur`, `Blur`, `Flou`],
        [`Mirror`, `Mirror`, `Miroir`],
        [`Noise`, `Noise`, `Bruit`],
        [`Intensity`, `Intensity`, `Intensité`],

        // ── Animation panel ──
        [`Select a clip first`, `Select a clip first`, `Sélectionnez d'abord un clip`],
        [`Aucune animation`, `No animation`, `Aucune animation`],
        [`Apparition en fondu`, `Fade in`, `Apparition en fondu`],
        [`Disparition en fondu`, `Fade out`, `Disparition en fondu`],
        [`Fondu entrée et sortie`, `Fade in and out`, `Fondu entrée et sortie`],
        [`Apparition avec zoom`, `Appear with zoom`, `Apparition avec zoom`],
        [`Disparition avec dézoom`, `Disappear with zoom-out`, `Disparition avec dézoom`],
        [`Apparition « pop » avec rebond`, `"Pop" appearance with bounce`, `Apparition « pop » avec rebond`],
        [`Glisse depuis la gauche`, `Slide in from the left`, `Glisse depuis la gauche`],
        [`Glisse depuis la droite`, `Slide in from the right`, `Glisse depuis la droite`],
        [`Glisse depuis le bas`, `Slide in from the bottom`, `Glisse depuis le bas`],
        [`Glisse depuis le haut`, `Slide in from the top`, `Glisse depuis le haut`],
        [`Apparition en rotation`, `Appear with rotation`, `Apparition en rotation`],
        [`Apparition avec rebond`, `Appear with bounce`, `Apparition avec rebond`],
        [`Pulsation continue (loop)`, `Continuous pulse (loop)`, `Pulsation continue (loop)`],
        [`Tremblement continu (loop)`, `Continuous shake (loop)`, `Tremblement continu (loop)`],
        [`Flottement vertical doux (loop)`, `Gentle vertical float (loop)`, `Flottement vertical doux (loop)`],
        [`Ken Burns — zoom + travelling lent`, `Ken Burns — zoom + slow pan`, `Ken Burns — zoom + travelling lent`],
        [`Rotation continue (loop)`, `Continuous rotation (loop)`, `Rotation continue (loop)`],
        [`Apparition pop + disparition zoom (logo intro)`, `Pop in + zoom out (logo intro)`, `Apparition pop + disparition zoom (logo intro)`],
        [`Fade In`, `Fade In`, `Fondu entrée`],
        [`Fade Out`, `Fade Out`, `Fondu sortie`],
        [`Fade I/O`, `Fade I/O`, `Fondu E/S`],
        [`Zoom In`, `Zoom In`, `Zoom avant`],
        [`Zoom Out`, `Zoom Out`, `Zoom arrière`],
        [`Slide L`, `Slide L`, `Gliss. G`],
        [`Slide R`, `Slide R`, `Gliss. D`],
        [`Slide Up`, `Slide Up`, `Gliss. haut`],
        [`Slide Dn`, `Slide Dn`, `Gliss. bas`],
        [`Spin In`, `Spin In`, `Rotation`],
        [`Bounce`, `Bounce`, `Rebond`],
        [`Pulse`, `Pulse`, `Pulsation`],
        [`Float`, `Float`, `Flottement`],
        [`Spin`, `Spin`, `Rotation`],
        [`In/Out`, `In/Out`, `E/S`],
        [`Intensité`, `Intensity`, `Intensité`],
        [`None`, `None`, `Aucun`],
        [`Shake`, `Shake`, `Secousse`],

        // ── Fade panel ──
        [`FADE & TRANSITION`, `FADE & TRANSITION`, `FONDU & TRANSITION`],
        [`No Fade`, `No Fade`, `Aucun fondu`],
        [`In & Out`, `In & Out`, `Entrée & Sortie`],

        // ── Color grading ──
        [`COLOR GRADING`, `COLOR GRADING`, `ÉTALONNAGE COULEUR`],
        [`Filtres Vidéo`, `Video Filters`, `Filtres Vidéo`],
        [`Aucun`, `None`, `Aucun`],
        [`Chaud`, `Warm`, `Chaud`],
        [`Froid`, `Cool`, `Froid`],
        [`Éclatant`, `Vivid`, `Éclatant`],
        [`Délavé`, `Faded`, `Délavé`],
        [`Cinéma`, `Cinema`, `Cinéma`],
        [`Noir & Blanc`, `Black & White`, `Noir & Blanc`],
        [`Sépia`, `Sepia`, `Sépia`],
        [`CONTRAST`, `CONTRAST`, `CONTRASTE`],

        // ── Timeline tooltips ──
        [`Add new track (+)`, `Add new track (+)`, `Ajouter une piste (+)`],
        [`Toggle Properties Panel (Ctrl+P)`, `Toggle Properties Panel (Ctrl+P)`, `Afficher/Masquer le panneau Propriétés (Ctrl+P)`],
        [`Cut clip at playhead (C)`, `Cut clip at playhead (C)`, `Couper le clip à la tête de lecture (C)`],
        [`Separate video and audio (U)`, `Separate video and audio (U)`, `Séparer la vidéo et l'audio (U)`],
        [`First Frame (Home)`, `First Frame (Home)`, `Première image (Début)`],
        [`Previous Frame (←)`, `Previous Frame (←)`, `Image précédente (←)`],
        [`Play/Pause (Space)`, `Play/Pause (Space)`, `Lecture/Pause (Espace)`],
        [`Next Frame (→)`, `Next Frame (→)`, `Image suivante (→)`],
        [`Last Frame (End)`, `Last Frame (End)`, `Dernière image (Fin)`],
        [`Focus on preview`, `Focus on preview`, `Focus sur l'aperçu`],
        [`Zoom Out (-)`, `Zoom Out (-)`, `Dézoomer (-)`],
        [`Zoom In (+)`, `Zoom In (+)`, `Zoomer (+)`],
        [`Fullscreen`, `Fullscreen`, `Plein écran`],
        [`Play/Pause (Space or K)`, `Play/Pause (Space or K)`, `Lecture/Pause (Espace ou K)`],
        [`Toggle Properties Panel`, `Toggle Properties Panel`, `Afficher/Masquer le panneau Propriétés`],

        // ── Properties ──
        [`PROPERTIES`, `PROPERTIES`, `PROPRIÉTÉS`],
        [`Select a clip to edit`, `Select a clip to edit`, `Sélectionnez un clip à modifier`],

        // ── Loading / status ──
        [`LOADING`, `LOADING`, `CHARGEMENT`],
        [`Loading media...`, `Loading media...`, `Chargement du média...`],
        [`Ready`, `Ready`, `Prêt`],

        // ── Keyboard shortcuts panel ──
        [`KEYBOARD SHORTCUTS`, `KEYBOARD SHORTCUTS`, `RACCOURCIS CLAVIER`],
        [`Play / Pause`, `Play / Pause`, `Lecture / Pause`],
        [`Rewind`, `Rewind`, `Retour`],
        [`Fast Forward`, `Fast Forward`, `Avance rapide`],
        [`Mark In Point`, `Mark In Point`, `Marquer le point d'entrée`],
        [`Mark Out Point`, `Mark Out Point`, `Marquer le point de sortie`],
        [`Cut at Playhead`, `Cut at Playhead`, `Couper à la tête de lecture`],
        [`Delete Selected`, `Delete Selected`, `Supprimer la sélection`],
        [`Undo`, `Undo`, `Annuler`],
        [`Redo`, `Redo`, `Rétablir`],
        [`Step Frame`, `Step Frame`, `Image par image`],
        [`Go to Start`, `Go to Start`, `Aller au début`],
        [`Go to End`, `Go to End`, `Aller à la fin`],
        [`Zoom In/Out`, `Zoom In/Out`, `Zoom avant/arrière`],
        [`Deselect`, `Deselect`, `Désélectionner`],

        // ── AI panel ──
        [`✦ AI ASSISTANT`, `✦ AI ASSISTANT`, `✦ ASSISTANT IA`],
        [`Clear chat`, `Clear chat`, `Effacer la conversation`],
        [`Model`, `Model`, `Modèle`],
        [`API Key`, `API Key`, `Clé API`],
        [`API Key (sk-... or AIza...)`, `API Key (sk-... or AIza...)`, `Clé API (sk-... ou AIza...)`],
        [`Describe your edit... (FR or EN)`, `Describe your edit... (FR or EN)`, `Décrivez votre montage... (FR ou EN)`],

        // ── Export modal ──
        [`EXPORT VIDEO`, `EXPORT VIDEO`, `EXPORTER LA VIDÉO`],
        [`AUTOMATIC`, `AUTOMATIC`, `AUTOMATIQUE`],
        [`Smart presets`, `Smart presets`, `Préréglages intelligents`],
        [`Auto settings`, `Auto settings`, `Réglages auto`],
        [`ADVANCED`, `ADVANCED`, `AVANCÉ`],
        [`Full control`, `Full control`, `Contrôle total`],
        [`Smart Export`, `Smart Export`, `Export intelligent`],
        [`Optimized settings — 720p HD Safe Mode`, `Optimized settings — 720p HD Safe Mode`, `Réglages optimisés — Mode sûr 720p HD`],
        [`✓ Guaranteed Audio Sync`, `✓ Guaranteed Audio Sync`, `✓ Synchro audio garantie`],
        [`✓ No Lags / No Stutter`, `✓ No Lags / No Stutter`, `✓ Sans ralentissement / sans saccade`],
        [`✓ Universal Compatibility`, `✓ Universal Compatibility`, `✓ Compatibilité universelle`],
        [`Choose Export Method`, `Choose Export Method`, `Choisir la méthode d'export`],
        [`Frame-perfect · H.264`, `Frame-perfect · H.264`, `Image parfaite · H.264`],
        [`⚠️ Video Only (No Audio)`, `⚠️ Video Only (No Audio)`, `⚠️ Vidéo seule (sans audio)`],
        [`Native · WebM/VP9`, `Native · WebM/VP9`, `Natif · WebM/VP9`],
        [`✓ Recommended`, `✓ Recommended`, `✓ Recommandé`],
        [`MediaRecorder · prefers H.264`, `MediaRecorder · prefers H.264`, `MediaRecorder · privilégie H.264`],
        [`🎬 MP4 if browser supports`, `🎬 MP4 if browser supports`, `🎬 MP4 si le navigateur le permet`],
        [`Export Settings`, `Export Settings`, `Réglages d'export`],
        [`Resolution`, `Resolution`, `Résolution`],
        [`Quality`, `Quality`, `Qualité`],
        [`High (8 Mbps)`, `High (8 Mbps)`, `Haute (8 Mbps)`],
        [`Frame Rate`, `Frame Rate`, `Fréquence d'images`],
        [`✓ Universal compatibility — Works on all browsers and devices`, `✓ Universal compatibility — Works on all browsers and devices`, `✓ Compatibilité universelle — Fonctionne sur tous les navigateurs et appareils`],
        [`Ready to Export`, `Ready to Export`, `Prêt à exporter`],
        [`Settings automatically optimized for your device`, `Settings automatically optimized for your device`, `Réglages optimisés automatiquement pour votre appareil`],
        [`Resolution:`, `Resolution:`, `Résolution :`],
        [`Frame Rate:`, `Frame Rate:`, `Fréquence d'images :`],
        [`Format:`, `Format:`, `Format :`],
        [`GPU Acceleration:`, `GPU Acceleration:`, `Accélération GPU :`],
        [`✅ Enabled`, `✅ Enabled`, `✅ Activée`],
        [`YOUR DEVICE`, `YOUR DEVICE`, `VOTRE APPAREIL`],
        [`CHOOSE RESOLUTION`, `CHOOSE RESOLUTION`, `CHOISIR LA RÉSOLUTION`],
        [`Higher = better quality but slower export`, `Higher = better quality but slower export`, `Plus haut = meilleure qualité mais export plus lent`],
        [`HD • Fast`, `HD • Fast`, `HD • Rapide`],
        [`Full HD • Balanced`, `Full HD • Balanced`, `Full HD • Équilibré`],
        [`QHD • High Quality`, `QHD • High Quality`, `QHD • Haute qualité`],
        [`4K • Professional`, `4K • Professional`, `4K • Professionnel`],
        [`8K • Ultra (Slow)`, `8K • Ultra (Slow)`, `8K • Ultra (lent)`],
        [`CHOOSE FRAME RATE`, `CHOOSE FRAME RATE`, `CHOISIR LA FRÉQUENCE D'IMAGES`],
        [`Higher = smoother motion`, `Higher = smoother motion`, `Plus haut = mouvement plus fluide`],
        [`Cinema Look`, `Cinema Look`, `Rendu cinéma`],
        [`Standard Web`, `Standard Web`, `Web standard`],
        [`Smooth Gaming`, `Smooth Gaming`, `Jeu fluide`],
        [`CHOOSE FORMAT`, `CHOOSE FORMAT`, `CHOISIR LE FORMAT`],
        [`MP4 works everywhere`, `MP4 works everywhere`, `Le MP4 fonctionne partout`],
        [`Universal`, `Universal`, `Universel`],
        [`Web Optimized`, `Web Optimized`, `Optimisé web`],
        [`High Quality`, `High Quality`, `Haute qualité`],
        [`GPU ACCELERATION`, `GPU ACCELERATION`, `ACCÉLÉRATION GPU`],
        [`Faster export (recommended)`, `Faster export (recommended)`, `Export plus rapide (recommandé)`],
        [`Use graphics card for faster rendering`, `Use graphics card for faster rendering`, `Utiliser la carte graphique pour un rendu plus rapide`],
        [`CANCEL`, `CANCEL`, `ANNULER`],
        [`EXPORT`, `EXPORT`, `EXPORTER`],
        [`EXPORT COMPLETE`, `EXPORT COMPLETE`, `EXPORT TERMINÉ`],
        [`Size:`, `Size:`, `Taille :`],
        [`FILE NAME`, `FILE NAME`, `NOM DU FICHIER`],
        [`My Export`, `My Export`, `Mon export`],
        [`Special characters will be replaced with underscores.`, `Special characters will be replaced with underscores.`, `Les caractères spéciaux seront remplacés par des tirets bas.`],
        [`CLOSE`, `CLOSE`, `FERMER`],
        [`DOWNLOAD VIDEO`, `DOWNLOAD VIDEO`, `TÉLÉCHARGER LA VIDÉO`],

        // ── Save reminder ──
        [`Save Your Project`, `Save Your Project`, `Enregistrez votre projet`],
        [`Don't forget to save your work! You haven't saved in a while.`, `Don't forget to save your work! You haven't saved in a while.`, `N'oubliez pas d'enregistrer votre travail ! Vous n'avez pas enregistré depuis un moment.`],
        [`Click "Save Now" to save your project.`, `Click "Save Now" to save your project.`, `Cliquez sur « Enregistrer » pour sauvegarder votre projet.`],
        [`Don't show this reminder again`, `Don't show this reminder again`, `Ne plus afficher ce rappel`],
        [`Later`, `Later`, `Plus tard`],
        [`Save Now`, `Save Now`, `Enregistrer`],

        // ── Preferences (authored in FR) ──
        [`GPU & PERFORMANCES`, `GPU & PERFORMANCE`, `GPU & PERFORMANCES`],
        [`Detecting GPU…`, `Detecting GPU…`, `Détection du GPU…`],
        [`Accélération GPU — Preview`, `GPU Acceleration — Preview`, `Accélération GPU — Preview`],
        [`Rendu canvas accéléré pendant le montage`, `Accelerated canvas rendering during editing`, `Rendu canvas accéléré pendant le montage`],
        [`Accélération GPU — Export`, `GPU Acceleration — Export`, `Accélération GPU — Export`],
        [`WebCodecs hardware encoder (meilleure vitesse)`, `WebCodecs hardware encoder (better speed)`, `WebCodecs hardware encoder (meilleure vitesse)`],
        [`LECTURE`, `PLAYBACK`, `LECTURE`],
        [`Lecture en boucle`, `Loop playback`, `Lecture en boucle`],
        [`Recommence depuis le début en fin de timeline`, `Restarts from the beginning at the end of the timeline`, `Recommence depuis le début en fin de timeline`],
        [`Snap magnétique`, `Magnetic snap`, `Snap magnétique`],
        [`Accroche automatique des clips aux points de coupe`, `Automatically snaps clips to cut points`, `Accroche automatique des clips aux points de coupe`],
        [`Distance de snap`, `Snap distance`, `Distance de snap`],
        [`Rayon d'accroche en secondes`, `Snap radius in seconds`, `Rayon d'accroche en secondes`],
        [`Mode Ripple`, `Ripple mode`, `Mode Ripple`],
        [`Décale automatiquement les clips suivants à la suppression`, `Automatically shifts following clips on deletion`, `Décale automatiquement les clips suivants à la suppression`],
        [`Formes d'onde audio`, `Audio waveforms`, `Formes d'onde audio`],
        [`Affiche la waveform sur les clips audio/video`, `Shows the waveform on audio/video clips`, `Affiche la waveform sur les clips audio/video`],
        [`SAUVEGARDE AUTO`, `AUTO-SAVE`, `SAUVEGARDE AUTO`],
        [`Intervalle`, `Interval`, `Intervalle`],
        [`Délai entre deux sauvegardes automatiques`, `Delay between two automatic saves`, `Délai entre deux sauvegardes automatiques`],

        // ── FAQ ──
        [`FAQ & SHORTCUTS`, `FAQ & SHORTCUTS`, `FAQ & RACCOURCIS`],
        [`ABOUT`, `ABOUT`, `À PROPOS`],
        [`is a browser-based video editor. No upload, no server — everything runs locally in your browser. Import media files, arrange them on the timeline, add effects and transitions, then export your final video.`, `is a browser-based video editor. No upload, no server — everything runs locally in your browser. Import media files, arrange them on the timeline, add effects and transitions, then export your final video.`, `est un éditeur vidéo dans le navigateur. Aucun téléversement, aucun serveur — tout fonctionne localement dans votre navigateur. Importez vos fichiers média, organisez-les sur la timeline, ajoutez des effets et des transitions, puis exportez votre vidéo finale.`],
        [`Playback`, `Playback`, `Lecture`],
        [`Editing`, `Editing`, `Montage`],
        [`View & Project`, `View & Project`, `Affichage & Projet`],
        [`Rewind 1s`, `Rewind 1s`, `Retour 1s`],
        [`Forward 1s`, `Forward 1s`, `Avance 1s`],
        [`Step back 1 frame`, `Step back 1 frame`, `Reculer d'une image`],
        [`Step forward 1 frame`, `Step forward 1 frame`, `Avancer d'une image`],
        [`Go to start`, `Go to start`, `Aller au début`],
        [`Go to end`, `Go to end`, `Aller à la fin`],
        [`Cut at playhead`, `Cut at playhead`, `Couper à la tête de lecture`],
        [`Copy clip`, `Copy clip`, `Copier le clip`],
        [`Paste clip`, `Paste clip`, `Coller le clip`],
        [`Unlink audio`, `Unlink audio`, `Détacher l'audio`],
        [`Delete selected clip`, `Delete selected clip`, `Supprimer le clip sélectionné`],
        [`Mark In point`, `Mark In point`, `Marquer le point d'entrée`],
        [`Mark Out point`, `Mark Out point`, `Marquer le point de sortie`],
        [`Zoom in / out`, `Zoom in / out`, `Zoom avant / arrière`],
        [`Toggle properties panel`, `Toggle properties panel`, `Afficher/Masquer le panneau Propriétés`],
        [`Save project`, `Save project`, `Enregistrer le projet`],
        [`Deselect / Close panel`, `Deselect / Close panel`, `Désélectionner / Fermer le panneau`],
        [`TIPS`, `TIPS`, `ASTUCES`],
        [`Drag & drop files directly into the media library`, `Drag & drop files directly into the media library`, `Glissez-déposez les fichiers directement dans la médiathèque`],
        [`Right-click a clip for context menu options`, `Right-click a clip for context menu options`, `Clic droit sur un clip pour les options du menu contextuel`],
        [`Use the scroll wheel on the timeline to zoom`, `Use the scroll wheel on the timeline to zoom`, `Utilisez la molette sur la timeline pour zoomer`],
        [`Projects are auto-saved to your browser storage`, `Projects are auto-saved to your browser storage`, `Les projets sont sauvegardés automatiquement dans le stockage du navigateur`],
        [`Export supports multiple engines (Canvas, WebCodecs, Transmux)`, `Export supports multiple engines (Canvas, WebCodecs, Transmux)`, `L'export prend en charge plusieurs moteurs (Canvas, WebCodecs, Transmux)`],
        [`CREDITS`, `CREDITS`, `CRÉDITS`],
        [`Created by`, `Created by`, `Créé par`],
        [`Version 3.0 — 100% client-side, no backend required.`, `Version 3.0 — 100% client-side, no backend required.`, `Version 3.0 — 100% côté client, aucun serveur requis.`],

        // ── Save dialog ──
        [`SAVE PROJECT`, `SAVE PROJECT`, `ENREGISTRER LE PROJET`],
        [`Project Name`, `Project Name`, `Nom du projet`],
        [`My Project`, `My Project`, `Mon projet`],
        [`Save Format`, `Save Format`, `Format d'enregistrement`],
        [`Project Bundle`, `Project Bundle`, `Bundle de projet`],
        [`Media + Timeline`, `Media + Timeline`, `Média + Timeline`],
        [`Project Data`, `Project Data`, `Données du projet`],
        [`Timeline only`, `Timeline only`, `Timeline seule`],
        [`IPFS Upload`, `IPFS Upload`, `Téléversement IPFS`],
        [`Decentralized`, `Decentralized`, `Décentralisé`],
        [`Pinata JWT Token`, `Pinata JWT Token`, `Jeton JWT Pinata`],
        [`Enter your Pinata JWT...`, `Enter your Pinata JWT...`, `Entrez votre JWT Pinata...`],
        [`Get your key at`, `Get your key at`, `Obtenez votre clé sur`],
        [`Preparing...`, `Preparing...`, `Préparation...`],
        [`SAVE`, `SAVE`, `ENREGISTRER`],

        // ── Auto-save toast ──
        [`Auto-saved project found`, `Auto-saved project found`, `Projet sauvegardé automatiquement trouvé`],
        [`Dismiss`, `Dismiss`, `Ignorer`],
        [`Restore`, `Restore`, `Restaurer`],

        // ── Relink modal ──
        [`Relink Media Files`, `Relink Media Files`, `Relier les fichiers média`],
        [`Some media files are missing or moved. Please locate the original files to continue editing your project.`, `Some media files are missing or moved. Please locate the original files to continue editing your project.`, `Certains fichiers média sont manquants ou déplacés. Veuillez localiser les fichiers d'origine pour continuer à éditer votre projet.`],
        [`Skip`, `Skip`, `Ignorer`],
        [`Done`, `Done`, `Terminé`],

        // ── Mobile drawer (authored in FR) ──
        [`Édition`, `Editing`, `Édition`],
        [`Annuler`, `Undo`, `Annuler`],
        [`Rétablir`, `Redo`, `Rétablir`],
        [`Texte`, `Text`, `Texte`],
        [`Bloc couleur`, `Color Block`, `Bloc couleur`],
        [`Projet`, `Project`, `Projet`],
        [`Ouvrir`, `Open`, `Ouvrir`],
        [`Sauvegarder`, `Save`, `Sauvegarder`],
        [`Assistant AI`, `AI Assistant`, `Assistant AI`],
        [`Exporter`, `Export`, `Exporter`],
        [`Installer`, `Install`, `Installer`],
        [`Préférences`, `Preferences`, `Préférences`],
        [`Média`, `Media`, `Média`],
        [`Color`, `Color`, `Couleur`],
        [`Export`, `Export`, `Exporter`],

        // ── Service-worker update toast ──
        [`Update available`, `Update available`, `Mise à jour disponible`],
        [`Reload to use the latest CUT THE FLOW build.`, `Reload to use the latest CUT THE FLOW build.`, `Rechargez pour utiliser la dernière version de CUT THE FLOW.`],
        [`Reload`, `Reload`, `Recharger`],

        // ── Donation pop-in ──
        [`✕ close`, `✕ close`, `✕ fermer`],
        [`FASTER`, `FASTER`, `PLUS RAPIDE`],
        [`on app vs browser`, `on app vs browser`, `sur l'app vs navigateur`],
        [`Install & launch in under 1 second`, `Install & launch in under 1 second`, `Installez et lancez en moins d'une seconde`],
        [`Cut The Flow · Independent & Ad-free`, `Cut The Flow · Independent & Ad-free`, `Cut The Flow · Indépendant & sans pub`],
        [`Install the App — €24 one-time`, `Install the App — €24 one-time`, `Installer l'app — 24 € en une fois`],
        // The big paragraph is split by <br>/<strong>, so each text node is its own key.
        [`The web version stays 100% free, forever.`, `The web version stays 100% free, forever.`, `La version web reste 100 % gratuite, pour toujours.`],
        [`One-time €24 purchase unlocks PWA install for the`, `One-time €24 purchase unlocks PWA install for the`, `L'achat unique de 24 € débloque l'installation PWA pour`],
        [`entire app.zigmoon.com collection`, `entire app.zigmoon.com collection`, `toute la collection app.zigmoon.com`],
        [`— no subscription, no recurring charge.`, `— no subscription, no recurring charge.`, `— sans abonnement, sans frais récurrents.`],
        [`On major version updates (~once a year) the app keeps working; you may be asked for €24 again to get the latest version.`, `On major version updates (~once a year) the app keeps working; you may be asked for €24 again to get the latest version.`, `Lors des mises à jour majeures (~une fois par an), l'app continue de fonctionner ; 24 € pourront vous être redemandés pour obtenir la dernière version.`],
        [`One-time €24 — unlock install for the whole collection`, `One-time €24 — unlock install for the whole collection`, `24 € en une fois — débloque l'installation pour toute la collection`],
        [`Install unlocks automatically once the payment is approved.`, `Install unlocks automatically once the payment is approved.`, `L'installation se débloque automatiquement dès que le paiement est approuvé.`],
        [`One-time payment — no subscription, no recurring charge.`, `One-time payment — no subscription, no recurring charge.`, `Paiement unique — sans abonnement, sans frais récurrents.`],
        [`No thanks — keep using the web version`, `No thanks — keep using the web version`, `Non merci — continuer sur la version web`],
        [`have a code?`, `have a code?`, `un code ?`],
        [`Promo code`, `Promo code`, `Code promo`]
    ];

    const DICT = Object.create(null);
    S.forEach(function (row) { DICT[row[0]] = { en: row[1], fr: row[2] }; });

    // ---- Dynamic (status messages) -----------------------------------------
    // Exact, non-interpolated messages : [ source, EN, FR ].
    const D = [
        [`Ready to create!`, `Ready to create!`, `Prêt à créer !`],
        [`✓ Files imported — add a track to place them on the timeline`, `✓ Files imported — add a track to place them on the timeline`, `✓ Fichiers importés — ajoutez une piste pour les placer sur la timeline`],
        [`Text layer added`, `Text layer added`, `Calque texte ajouté`],
        [`Block layer added`, `Block layer added`, `Bloc couleur ajouté`],
        [`No clip selected`, `No clip selected`, `Aucun clip sélectionné`],
        [`Clip copied`, `Clip copied`, `Clip copié`],
        [`No clip in clipboard`, `No clip in clipboard`, `Aucun clip dans le presse-papiers`],
        [`No track to paste onto`, `No track to paste onto`, `Aucune piste où coller`],
        [`Clip pasted at playhead`, `Clip pasted at playhead`, `Clip collé à la tête de lecture`],
        [`Clip pasted after selection`, `Clip pasted after selection`, `Clip collé après la sélection`],
        [`Playhead not on selected clip`, `Playhead not on selected clip`, `Tête de lecture hors du clip sélectionné`],
        [`Clip cut at playhead`, `Clip cut at playhead`, `Clip coupé à la tête de lecture`],
        [`Select a video clip to unlink its audio`, `Select a video clip to unlink its audio`, `Sélectionnez un clip vidéo pour détacher son audio`],
        [`Clip deleted`, `Clip deleted`, `Clip supprimé`],
        [`Clip ripple-deleted (Shift+Delete)`, `Clip ripple-deleted (Shift+Delete)`, `Clip supprimé en mode ripple (Maj+Suppr)`],
        [`End of timeline reached`, `End of timeline reached`, `Fin de la timeline atteinte`],
        [`Maximum timeline duration reached (3 hours)`, `Maximum timeline duration reached (3 hours)`, `Durée maximale de la timeline atteinte (3 heures)`],
        [`↶ Undo`, `↶ Undo`, `↶ Annuler`],
        [`Nothing to undo`, `Nothing to undo`, `Rien à annuler`],
        [`↷ Redo`, `↷ Redo`, `↷ Rétablir`],
        [`Nothing to redo`, `Nothing to redo`, `Rien à rétablir`],
        [`Save reminders disabled`, `Save reminders disabled`, `Rappels d'enregistrement désactivés`],
        [`❌ Failed to load font`, `❌ Failed to load font`, `❌ Échec du chargement de la police`],
        [`✓ Text updated`, `✓ Text updated`, `✓ Texte mis à jour`],
        [`Can only extract audio from video clips`, `Can only extract audio from video clips`, `L'audio ne peut être extrait que des clips vidéo`],
        [`Sélectionne un clip d'abord`, `Select a clip first`, `Sélectionne un clip d'abord`],
        [`Select a clip first`, `Select a clip first`, `Sélectionnez d'abord un clip`],
        [`❌ No video to download`, `❌ No video to download`, `❌ Aucune vidéo à télécharger`],
        [`Restoring auto-saved project...`, `Restoring auto-saved project...`, `Restauration du projet sauvegardé...`],
        [`❌ No auto-saved project found`, `❌ No auto-saved project found`, `❌ Aucun projet sauvegardé trouvé`],
        [`❌ Failed to restore auto-saved project`, `❌ Failed to restore auto-saved project`, `❌ Échec de la restauration du projet sauvegardé`],
        [`❌ JSZip library not loaded`, `❌ JSZip library not loaded`, `❌ Bibliothèque JSZip non chargée`],
        [`Loading .ctf project...`, `Loading .ctf project...`, `Chargement du projet .ctf...`],
        [`New project created`, `New project created`, `Nouveau projet créé`],
        [`Loading project...`, `Loading project...`, `Chargement du projet...`],
        [`Project loaded successfully`, `Project loaded successfully`, `Projet chargé avec succès`],
        [`Failed to load project`, `Failed to load project`, `Échec du chargement du projet`],
        [`All media files relinked successfully`, `All media files relinked successfully`, `Tous les fichiers média ont été reliés avec succès`],
        [`Installation cancelled — donation required`, `Installation cancelled — donation required`, `Installation annulée — don requis`],
        [`CUT THE FLOW installed`, `CUT THE FLOW installed`, `CUT THE FLOW installé`],
        [`Installation cancelled`, `Installation cancelled`, `Installation annulée`]
    ];
    const DYN = Object.create(null);
    D.forEach(function (row) { DYN[row[0]] = { en: row[1], fr: row[2] }; });

    // Interpolated patterns : match the source, rebuild in the target language.
    const PAT = [
        { re: /^In point marked at (.+)$/, en: m => `In point marked at ${m[1]}`, fr: m => `Point d'entrée marqué à ${m[1]}` },
        { re: /^Out point marked at (.+)$/, en: m => `Out point marked at ${m[1]}`, fr: m => `Point de sortie marqué à ${m[1]}` },
        { re: /^Fullscreen error: (.+)$/, en: m => `Fullscreen error: ${m[1]}`, fr: m => `Erreur plein écran : ${m[1]}` },
        { re: /^Filter "(.+)" applied$/, en: m => `Filter "${m[1]}" applied`, fr: m => `Filtre « ${m[1]} » appliqué` },
        { re: /^🔓 Audio unlinked → (.+)$/, en: m => `🔓 Audio unlinked → ${m[1]}`, fr: m => `🔓 Audio détaché → ${m[1]}` },
        { re: /^🔓 Audio extracted → (.+)$/, en: m => `🔓 Audio extracted → ${m[1]}`, fr: m => `🔓 Audio extrait → ${m[1]}` },
        { re: /^❌ Cannot import (.+) \(browser quota exceeded\)$/, en: m => `❌ Cannot import ${m[1]} (browser quota exceeded)`, fr: m => `❌ Impossible d'importer ${m[1]} (quota du navigateur dépassé)` },
        { re: /^⚠️ 4K video detected: (.+)\. Generating proxy for smooth editing\.\.\.$/, en: m => `⚠️ 4K video detected: ${m[1]}. Generating proxy for smooth editing...`, fr: m => `⚠️ Vidéo 4K détectée : ${m[1]}. Génération d'un proxy pour un montage fluide...` },
        { re: /^✅ Proxy ready for (.+)$/, en: m => `✅ Proxy ready for ${m[1]}`, fr: m => `✅ Proxy prêt pour ${m[1]}` },
        { re: /^⚠️ Proxy generation failed for (.+)\. Will use original quality\.$/, en: m => `⚠️ Proxy generation failed for ${m[1]}. Will use original quality.`, fr: m => `⚠️ Échec de génération du proxy pour ${m[1]}. Qualité d'origine utilisée.` },
        { re: /^ℹ️ 2K video: (.+)\. May impact performance on older machines\.$/, en: m => `ℹ️ 2K video: ${m[1]}. May impact performance on older machines.`, fr: m => `ℹ️ Vidéo 2K : ${m[1]}. Peut impacter les performances sur les machines anciennes.` },
        { re: /^(\d+) file\(s\) imported$/, en: m => `${m[1]} file(s) imported`, fr: m => `${m[1]} fichier(s) importé(s)` },
        { re: /^✓ (\d+) clip\(s\) added to timeline$/, en: m => `✓ ${m[1]} clip(s) added to timeline`, fr: m => `✓ ${m[1]} clip(s) ajouté(s) à la timeline` },
        { re: /^Track (.+): Muted$/, en: m => `Track ${m[1]}: Muted`, fr: m => `Piste ${m[1]} : Muette` },
        { re: /^Track (.+): Unmuted$/, en: m => `Track ${m[1]}: Unmuted`, fr: m => `Piste ${m[1]} : Son activé` },
        { re: /^Track (.+): Solo$/, en: m => `Track ${m[1]}: Solo`, fr: m => `Piste ${m[1]} : Solo` },
        { re: /^Track (.+): Solo Off$/, en: m => `Track ${m[1]}: Solo Off`, fr: m => `Piste ${m[1]} : Solo désactivé` },
        { re: /^Clip added: (.+)$/, en: m => `Clip added: ${m[1]}`, fr: m => `Clip ajouté : ${m[1]}` },
        { re: /^✓ "(.+)" removed from library$/, en: m => `✓ "${m[1]}" removed from library`, fr: m => `✓ « ${m[1]} » retiré de la médiathèque` },
        { re: /^Preloading (\d+) video\(s\)\.\.\.$/, en: m => `Preloading ${m[1]} video(s)...`, fr: m => `Préchargement de ${m[1]} vidéo(s)...` },
        { re: /^Preloaded (\d+)\/(\d+) videos$/, en: m => `Preloaded ${m[1]}/${m[2]} videos`, fr: m => `${m[1]}/${m[2]} vidéos préchargées` },
        { re: /^All (\d+) video\(s\) preloaded and ready!$/, en: m => `All ${m[1]} video(s) preloaded and ready!`, fr: m => `Les ${m[1]} vidéo(s) sont préchargées et prêtes !` },
        { re: /^✓ Font "(.+)" loaded$/, en: m => `✓ Font "${m[1]}" loaded`, fr: m => `✓ Police « ${m[1]} » chargée` },
        { re: /^✅ Settings optimized for your (.+)$/, en: m => `✅ Settings optimized for your ${m[1]}`, fr: m => `✅ Réglages optimisés pour votre ${m[1]}` },
        { re: /^Animation: (.+)$/, en: m => `Animation: ${m[1]}`, fr: m => `Animation : ${m[1]}` },
        { re: /^FX: (.+)$/, en: m => `FX: ${m[1]}`, fr: m => `FX : ${m[1]}` },
        { re: /^Export failed: (.+)$/, en: m => `Export failed: ${m[1]}`, fr: m => `Échec de l'export : ${m[1]}` },
        { re: /^✅ Download started: (.+)$/, en: m => `✅ Download started: ${m[1]}`, fr: m => `✅ Téléchargement démarré : ${m[1]}` },
        { re: /^✅ Project "(.+)" restored from auto-save$/, en: m => `✅ Project "${m[1]}" restored from auto-save`, fr: m => `✅ Projet « ${m[1]} » restauré depuis la sauvegarde auto` },
        { re: /^❌ Save failed: (.+)$/, en: m => `❌ Save failed: ${m[1]}`, fr: m => `❌ Échec de l'enregistrement : ${m[1]}` },
        { re: /^✅ Project "(.+)" saved as \.ctf$/, en: m => `✅ Project "${m[1]}" saved as .ctf`, fr: m => `✅ Projet « ${m[1]} » enregistré en .ctf` },
        { re: /^✅ Project "(.+)" saved as \.json$/, en: m => `✅ Project "${m[1]}" saved as .json`, fr: m => `✅ Projet « ${m[1]} » enregistré en .json` },
        { re: /^✅ Project "(.+)" uploaded to IPFS: (.+)$/, en: m => `✅ Project "${m[1]}" uploaded to IPFS: ${m[2]}`, fr: m => `✅ Projet « ${m[1]} » téléversé sur IPFS : ${m[2]}` },
        { re: /^✅ Project "(.+)" loaded from \.ctf$/, en: m => `✅ Project "${m[1]}" loaded from .ctf`, fr: m => `✅ Projet « ${m[1]} » chargé depuis .ctf` },
        { re: /^❌ Failed to load \.ctf: (.+)$/, en: m => `❌ Failed to load .ctf: ${m[1]}`, fr: m => `❌ Échec du chargement .ctf : ${m[1]}` },
        { re: /^✅ Relinked: (.+)$/, en: m => `✅ Relinked: ${m[1]}`, fr: m => `✅ Relié : ${m[1]}` },
        { re: /^Project loaded with (\d+) missing files$/, en: m => `Project loaded with ${m[1]} missing files`, fr: m => `Projet chargé avec ${m[1]} fichiers manquants` },
        { re: /^Project loaded \((\d+) files still missing\)$/, en: m => `Project loaded (${m[1]} files still missing)`, fr: m => `Projet chargé (${m[1]} fichiers encore manquants)` },
        // FR-authored dynamic messages → EN
        { re: /^❌ (.+) : durée invalide\. Réencodez le fichier \(ex : (.+)\) puis réimportez\.$/, en: m => `❌ ${m[1]}: invalid duration. Re-encode the file (e.g. ${m[2]}) then re-import.`, fr: m => `❌ ${m[1]} : durée invalide. Réencodez le fichier (ex : ${m[2]}) puis réimportez.` },
        { re: /^❌ (.+) : durée invalide, impossible de placer sur la timeline\.$/, en: m => `❌ ${m[1]}: invalid duration, cannot place on the timeline.`, fr: m => `❌ ${m[1]} : durée invalide, impossible de placer sur la timeline.` },
        { re: /^🚫 IMPORT REFUSÉ: (.+) est en 4K\. Votre machine ne peut pas gérer cette résolution \((.+)\)\. Utilisez max 1080p\.$/, en: m => `🚫 IMPORT REFUSED: ${m[1]} is 4K. Your machine cannot handle this resolution (${m[2]}). Use 1080p max.`, fr: m => `🚫 IMPORT REFUSÉ : ${m[1]} est en 4K. Votre machine ne peut pas gérer cette résolution (${m[2]}). Utilisez max 1080p.` },
        { re: /^⚠️ Vidéo 2K détectée: (.+)\. Attendez-vous à des ralentissements sur cette machine\.$/, en: m => `⚠️ 2K video detected: ${m[1]}. Expect slowdowns on this machine.`, fr: m => `⚠️ Vidéo 2K détectée : ${m[1]}. Attendez-vous à des ralentissements sur cette machine.` }
    ];

    // ---- Engine -------------------------------------------------------------
    const STORAGE_KEY = 'ctf_lang';
    let lang = 'en';
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved === 'fr' || saved === 'en') lang = saved; } catch (_) {}

    const textRegs = [];   // { node, lead, trail, key }
    const attrRegs = [];   // { el, attr, key }
    const WS = /^(\s*)([\s\S]*?)(\s*)$/;

    function applyText(reg) {
        const tr = DICT[reg.key];
        if (tr) reg.node.nodeValue = reg.lead + tr[lang] + reg.trail;
    }
    function applyAttr(reg) {
        const tr = DICT[reg.key];
        if (tr) reg.el.setAttribute(reg.attr, tr[lang]);
    }

    function registerText(node) {
        const raw = node.nodeValue;
        if (!raw) return;
        const trimmed = raw.trim();
        if (!trimmed || !DICT[trimmed]) return;
        const m = raw.match(WS);
        const reg = { node, lead: m[1], trail: m[3], key: trimmed };
        textRegs.push(reg);
        applyText(reg);
    }
    function registerAttr(el, attr) {
        const val = el.getAttribute(attr);
        if (!val || !DICT[val]) return;
        const reg = { el, attr, key: val };
        attrRegs.push(reg);
        applyAttr(reg);
    }

    const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };
    function processRoot(root) {
        if (!root) return;
        // Text nodes
        if (root.nodeType === Node.TEXT_NODE) { registerText(root); return; }
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (n.parentNode && SKIP[n.parentNode.nodeName]) return NodeFilter.FILTER_REJECT;
                return (n.nodeValue && n.nodeValue.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        let n;
        while ((n = walker.nextNode())) registerText(n);
        // Attributes (title / placeholder) — including the root element itself
        const attrEls = [];
        if (root.hasAttribute && (root.hasAttribute('title') || root.hasAttribute('placeholder'))) attrEls.push(root);
        root.querySelectorAll && root.querySelectorAll('[title],[placeholder]').forEach(el => attrEls.push(el));
        attrEls.forEach(el => {
            if (el.hasAttribute('title')) registerAttr(el, 'title');
            if (el.hasAttribute('placeholder')) registerAttr(el, 'placeholder');
        });
    }

    function applyAll() {
        textRegs.forEach(applyText);
        attrRegs.forEach(applyAttr);
        // Language lives in the Preferences modal (dropdown) since v3.9.2.
        const select = document.getElementById('pref-language');
        if (select && select.value !== lang) select.value = lang;
        try { document.documentElement.setAttribute('lang', lang); } catch (_) {}
    }

    function setLang(next) {
        if (next !== 'fr' && next !== 'en') return;
        lang = next;
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
        applyAll();
    }

    // Public dynamic translator (for app.showStatus etc.)
    function dyn(msg) {
        if (msg == null) return msg;
        const exact = DYN[msg];
        if (exact) return exact[lang];
        for (let i = 0; i < PAT.length; i++) {
            const m = msg.match(PAT[i].re);
            if (m) return PAT[i][lang](m);
        }
        return msg;
    }

    const I18N = {
        get lang() { return lang; },
        set: setLang,
        toggle: function () { setLang(lang === 'en' ? 'fr' : 'en'); },
        dyn: dyn,
        // Translate and register a freshly-added subtree (called by MutationObserver
        // and available for manual use after dynamic DOM insertions).
        refresh: function (root) { processRoot(root || document.body); }
    };
    window.I18N = I18N;
    // Convenience inline helper: tr(en, fr) → current-language string.
    window.tr = function (en, fr) { return lang === 'fr' ? fr : en; };

    // ---- Boot ---------------------------------------------------------------
    function boot() {
        processRoot(document.body);
        applyAll();
        // Catch dynamically-inserted UI (properties panel, context menus, toasts…).
        try {
            const mo = new MutationObserver(function (records) {
                for (let i = 0; i < records.length; i++) {
                    const added = records[i].addedNodes;
                    for (let j = 0; j < added.length; j++) processRoot(added[j]);
                }
            });
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
