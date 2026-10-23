/**
 * CUT THE FLOW — traduction de l'interface.
 *
 * L'ANGLAIS EST LA LANGUE DE RÉFÉRENCE : le balisage et le code contiennent les
 * clés, la table ci-dessous porte les deux langues. Une clé manquante en
 * français retombe sur l'anglais, jamais sur une chaîne vide — c'est ce qui
 * permet d'ajouter un texte sans risquer une interface muette.
 *
 * Les valeurs acceptent deux formes séparées par `|` pour le pluriel :
 *   'clips.n': '{n} clip|{n} clips'
 * `t('clips.n', { n })` choisit la première forme si n vaut 1.
 */

export type Lang = 'en' | 'fr';

type Entry = { en: string; fr: string };

const STRINGS: Record<string, Entry> = {
  // ── Fichier ──────────────────────────────────────────────────────────
  'file.new': { en: 'New', fr: 'Nouveau' },
  'file.newTitle': { en: 'New project (Ctrl+N)', fr: 'Nouveau projet (Ctrl+N)' },
  'file.open': { en: 'Open', fr: 'Ouvrir' },
  'file.openTitle': { en: 'Open a project (Ctrl+O)', fr: 'Ouvrir un projet (Ctrl+O)' },
  'file.save': { en: 'Save', fr: 'Enregistrer' },
  'file.saveTitle': { en: 'Save the project (Ctrl+S)', fr: 'Enregistrer le projet (Ctrl+S)' },
  'file.menu': { en: 'File', fr: 'Fichier' },

  // ── Historique ───────────────────────────────────────────────────────
  'edit.undo': { en: 'Undo', fr: 'Annuler' },
  'edit.undoTitle': { en: 'Undo (Ctrl+Z)', fr: 'Annuler (Ctrl+Z)' },
  'edit.redo': { en: 'Redo', fr: 'Rétablir' },
  'edit.redoTitle': { en: 'Redo (Ctrl+Shift+Z)', fr: 'Rétablir (Ctrl+Maj+Z)' },
  'history.undone': { en: 'Undone.', fr: 'Annulé.' },
  'history.redone': { en: 'Redone.', fr: 'Rétabli.' },
  'history.nothing': { en: 'Nothing to undo or redo.', fr: 'Rien à annuler ni à rétablir.' },

  // ── Actions ──────────────────────────────────────────────────────────
  'act.import': { en: 'Import', fr: 'Importer' },
  'act.importTitle': { en: 'Import media (Ctrl+I)', fr: 'Importer des médias (Ctrl+I)' },
  'act.split': { en: 'Split', fr: 'Couper' },
  'act.splitTitle': { en: 'Split at playhead (S)', fr: 'Couper au playhead (S)' },
  'act.duplicate': { en: 'Duplicate', fr: 'Dupliquer' },
  'act.duplicateTitle': { en: 'Duplicate clip (Ctrl+D)', fr: 'Dupliquer le clip (Ctrl+D)' },
  'act.delete': { en: 'Delete', fr: 'Supprimer' },
  'act.deleteTitle': { en: 'Delete clip (Del)', fr: 'Supprimer le clip (Suppr)' },
  'act.export': { en: 'Export', fr: 'Exporter' },
  'act.exportTitle': { en: 'Export the edit (Ctrl+E)', fr: 'Exporter le montage (Ctrl+E)' },
  'act.help': { en: 'Help', fr: 'Aide' },
  'act.helpTitle': { en: 'Keyboard shortcuts (?)', fr: 'Raccourcis clavier (?)' },
  'act.prefs': { en: 'Preferences', fr: 'Préférences' },
  'act.prefsTitle': { en: 'Preferences (Ctrl+,)', fr: 'Préférences (Ctrl+,)' },
  'act.panelMedia': { en: 'Media panel', fr: 'Panneau des médias' },
  'act.panelTools': { en: 'Tools panel', fr: 'Panneau des outils' },
  'act.toggleMedia': { en: 'Show / hide media', fr: 'Afficher / masquer les médias' },
  'act.toggleTools': { en: 'Show / hide tools', fr: 'Afficher / masquer les outils' },
  'act.brandTitle': { en: 'CUT THE FLOW', fr: 'CUT THE FLOW' },

  // ── Projet ───────────────────────────────────────────────────────────
  'doc.untitled': { en: 'Untitled', fr: 'Sans titre' },
  'doc.name': { en: 'Project name', fr: 'Nom du projet' },
  'doc.identity': { en: 'Project', fr: 'Projet' },

  // ── Médias ───────────────────────────────────────────────────────────
  'media.eyebrow': { en: 'Project', fr: 'Projet' },
  'media.title': { en: 'Media', fr: 'Médias' },
  'media.add': { en: 'Import media', fr: 'Importer des médias' },
  'media.drop': { en: 'Drop your media', fr: 'Déposez vos médias' },
  'media.dropTitle': { en: 'Click or drop files', fr: 'Cliquez ou déposez des fichiers' },
  'media.formats': { en: 'MP4 · MOV · WebM · MP3 · WAV · PNG', fr: 'MP4 · MOV · WebM · MP3 · WAV · PNG' },
  'media.empty': {
    en: 'No media yet. Drop files anywhere or use the zone above.',
    fr: 'Aucun média. Déposez des fichiers ou utilisez la zone ci-dessus.',
  },
  'media.insert': { en: 'Insert', fr: 'Insérer' },
  'media.text': { en: 'Text', fr: 'Texte' },
  'media.textTitle': { en: 'Add text (T)', fr: 'Ajouter un texte (T)' },
  'media.rect': { en: 'Rectangle', fr: 'Rectangle' },
  'media.rectTitle': { en: 'Add a rectangle (R)', fr: 'Ajouter un rectangle (R)' },
  'media.ellipse': { en: 'Ellipse', fr: 'Ellipse' },
  'media.ellipseTitle': { en: 'Add an ellipse (C)', fr: 'Ajouter une ellipse (C)' },
  'media.cardTitle': { en: '{name} — drag onto the timeline', fr: '{name} — glissez sur la timeline' },
  'media.remove': { en: 'Remove from library', fr: 'Supprimer de la médiathèque' },

  // ── Scène ────────────────────────────────────────────────────────────
  'stage.label': { en: 'Preview', fr: 'Prévisualisation' },
  'stage.zoomIn': { en: 'Zoom in', fr: 'Agrandir l’aperçu' },
  'stage.zoomOut': { en: 'Zoom out', fr: 'Réduire l’aperçu' },
  'stage.fit': { en: 'Fit to window', fr: 'Ajuster à la fenêtre' },
  'stage.fitTitle': { en: 'Fit (Ctrl+0)', fr: 'Ajuster (Ctrl+0)' },
  'stage.actualSize': { en: 'Actual size (100 %)', fr: 'Taille réelle (100 %)' },

  // ── Transport ────────────────────────────────────────────────────────
  'transport.start': { en: 'Start', fr: 'Début' },
  'transport.startTitle': { en: 'Start (Home)', fr: 'Début (Début)' },
  'transport.play': { en: 'Play / pause', fr: 'Lecture / pause' },
  'transport.playTitle': { en: 'Play / pause (Space)', fr: 'Lecture / pause (Espace)' },
  'transport.end': { en: 'End', fr: 'Fin' },
  'transport.endTitle': { en: 'End (End)', fr: 'Fin (Fin)' },
  'transport.snap': { en: 'Snap', fr: 'Accrochage' },
  'transport.snapTitle': { en: 'Snapping (N)', fr: 'Accrochage (N)' },

  // ── Panneau d'outils ─────────────────────────────────────────────────
  'tabs.label': { en: 'Tools panel', fr: 'Panneau d’outils' },
  'tabs.props': { en: 'Properties', fr: 'Propriétés' },
  'tabs.fx': { en: 'Effects', fr: 'Effets' },
  'tabs.transitions': { en: 'Transitions', fr: 'Transitions' },
  'eyebrow.selection': { en: 'Selection', fr: 'Sélection' },
  'eyebrow.render': { en: 'Render', fr: 'Rendu' },
  'eyebrow.edit': { en: 'Edit', fr: 'Montage' },

  'props.empty': {
    en: 'Select a clip on the timeline to set its position, duration, fades and opacity.',
    fr: 'Sélectionnez un clip sur la timeline pour régler sa position, sa durée, ses fondus et son opacité.',
  },
  'props.section.clip': { en: 'Clip', fr: 'Clip' },
  'props.section.composition': { en: 'Composition', fr: 'Composition' },
  'props.section.text': { en: 'Text', fr: 'Texte' },
  'props.section.shape': { en: 'Shape', fr: 'Forme' },
  'props.section.source': { en: 'Source', fr: 'Source' },
  'props.deleteClip': { en: 'Delete clip', fr: 'Supprimer le clip' },
  'props.audioMuted': { en: 'Mute this clip', fr: 'Couper le son du clip' },
  'props.section.speed': { en: 'Speed', fr: 'Vitesse' },
  'props.section.keyframes': { en: 'Keyframes', fr: 'Keyframes' },
  'props.section.mask': { en: 'Mask', fr: 'Masque' },

  'speed.hint': {
    en: 'The clip keeps the same portion of the source: 2× halves its length on the timeline, audio included.',
    fr: 'Le clip garde la même portion de la source : 2× divise sa longueur par deux sur la timeline, audio compris.',
  },
  'speed.reset': { en: '1× (reset)', fr: '1× (reset)' },

  'kf.hint': {
    en: 'A keyframe records the value at the playhead. Two keys animate the property; outside the range the value holds.',
    fr: 'Une clé enregistre la valeur à la tête de lecture. Deux clés animent la propriété ; hors plage la valeur est tenue.',
  },
  'kf.add': { en: 'Add a keyframe at the playhead', fr: 'Ajouter une clé à la tête de lecture' },
  'kf.remove': { en: 'Remove all keyframes for this property', fr: 'Supprimer toutes les clés de cette propriété' },
  'kf.count': { en: '{n} key(s)', fr: '{n} clé(s)' },
  'kf.easing': { en: 'Easing', fr: 'Interpolation' },
  'kf.clear': { en: 'Clear all keyframes', fr: 'Effacer toutes les clés' },
  'easing.linear': { en: 'Linear', fr: 'Linéaire' },
  'easing.ease-in': { en: 'Ease in', fr: 'Entrée' },
  'easing.ease-out': { en: 'Ease out', fr: 'Sortie' },
  'easing.ease-in-out': { en: 'Ease in-out', fr: 'Entrée-sortie' },

  'mask.enable': { en: 'Mask this clip', fr: 'Masquer ce clip' },
  'mask.kind': { en: 'Shape', fr: 'Forme' },
  'mask.rect': { en: 'Rectangle', fr: 'Rectangle' },
  'mask.ellipse': { en: 'Ellipse', fr: 'Ellipse' },
  'mask.x': { en: 'Centre X', fr: 'Centre X' },
  'mask.y': { en: 'Centre Y', fr: 'Centre Y' },
  'mask.width': { en: 'Mask width', fr: 'Largeur du masque' },
  'mask.height': { en: 'Mask height', fr: 'Hauteur du masque' },
  'mask.feather': { en: 'Feather', fr: 'Adoucissement' },
  'mask.invert': { en: 'Invert (cut a hole)', fr: 'Inverser (creuser un trou)' },
  'mask.hint': {
    en: 'The mask cuts the clip itself, not the layers below it.',
    fr: 'Le masque découpe le clip lui-même, pas les calques en dessous.',
  },

  'badge.speed': { en: 'Speed {speed}×', fr: 'Vitesse {speed}×' },
  'badge.mask': { en: 'Masked clip', fr: 'Clip masqué' },
  'badge.keyframes': { en: '{n} keyframe(s)', fr: '{n} keyframe(s)' },

  'field.name': { en: 'Name', fr: 'Nom' },
  'field.start': { en: 'Start (s)', fr: 'Début (s)' },
  'field.duration': { en: 'Duration (s)', fr: 'Durée (s)' },
  'field.sourceStart': { en: 'Source in (s)', fr: 'Départ source (s)' },
  'field.volume': { en: 'Volume', fr: 'Volume' },
  'field.fadeIn': { en: 'Fade in (s)', fr: 'Fondu entrée (s)' },
  'field.fadeOut': { en: 'Fade out (s)', fr: 'Fondu sortie (s)' },
  'field.scale': { en: 'Scale', fr: 'Échelle' },
  'field.x': { en: 'Position X', fr: 'Position X' },
  'field.y': { en: 'Position Y', fr: 'Position Y' },
  'field.rotation': { en: 'Rotation', fr: 'Rotation' },
  'field.opacity': { en: 'Opacity', fr: 'Opacité' },
  'field.size': { en: 'Size', fr: 'Taille' },
  'field.color': { en: 'Colour', fr: 'Couleur' },
  'field.type': { en: 'Type', fr: 'Type' },
  'field.width': { en: 'Width', fr: 'Largeur' },
  'field.height': { en: 'Height', fr: 'Hauteur' },
  'field.radius': { en: 'Corner', fr: 'Arrondi' },
  'field.intensity': { en: 'Amount', fr: 'Intensité' },
  'field.durationShort': { en: 'Duration', fr: 'Durée' },

  'shape.rect': { en: 'Rectangle', fr: 'Rectangle' },
  'shape.ellipse': { en: 'Ellipse', fr: 'Ellipse' },

  'fx.empty': {
    en: 'Select a clip to add effects. An effect stays inside its clip: it never spills onto the neighbour.',
    fr: 'Sélectionnez un clip pour lui appliquer des effets. Un effet reste dans le clip : il ne déborde jamais sur le voisin.',
  },
  'fx.audioOnly': {
    en: 'Visual effects do not apply to an audio clip.',
    fr: 'Les effets visuels ne s’appliquent pas à un clip audio.',
  },
  'fx.intro': {
    en: 'Every effect is rendered by ffmpeg on export; the preview gives a faithful preview of framing and colour.',
    fr: 'Chaque effet est rendu par ffmpeg à l’export ; la preview en donne un aperçu fidèle en cadrage et en couleur.',
  },
  'fx.blur.label': { en: 'Blur', fr: 'Flou' },
  'fx.blur.hint': { en: 'Softens the image', fr: 'Adoucit l’image' },
  'fx.sharpen.label': { en: 'Sharpen', fr: 'Netteté' },
  'fx.sharpen.hint': { en: 'Boosts edges', fr: 'Accentue les contours' },
  'fx.vignette.label': { en: 'Vignette', fr: 'Vignette' },
  'fx.vignette.hint': { en: 'Darkens the corners', fr: 'Assombrit les bords' },
  'fx.grain.label': { en: 'Grain', fr: 'Grain' },
  'fx.grain.hint': { en: 'Film texture', fr: 'Texture argentique' },
  'fx.brightness.label': { en: 'Brightness', fr: 'Luminosité' },
  'fx.brightness.hint': { en: 'Lighter or darker', fr: 'Éclaircit ou assombrit' },
  'fx.grayscale.label': { en: 'Black and white', fr: 'Noir et blanc' },
  'fx.grayscale.hint': { en: 'Removes colour', fr: 'Retire la couleur' },
  'fx.sepia.label': { en: 'Sepia', fr: 'Sépia' },
  'fx.sepia.hint': { en: 'Warm antique tones', fr: 'Tons chauds anciens' },
  'fx.warm.label': { en: 'Warm', fr: 'Chaud' },
  'fx.warm.hint': { en: 'Shifts towards orange', fr: 'Balance vers l’orange' },
  'fx.cool.label': { en: 'Cool', fr: 'Froid' },
  'fx.cool.hint': { en: 'Shifts towards blue', fr: 'Balance vers le bleu' },
  'fx.invert.label': { en: 'Invert', fr: 'Inverser' },
  'fx.invert.hint': { en: 'Negative', fr: 'Négatif' },
  'fx.mirror.label': { en: 'Mirror', fr: 'Miroir' },
  'fx.mirror.hint': { en: 'Flips horizontally', fr: 'Retourne horizontalement' },
  'fx.flip.label': { en: 'Flip', fr: 'Retourner' },
  'fx.flip.hint': { en: 'Flips vertically', fr: 'Retourne verticalement' },
  'fx.pixelate.label': { en: 'Pixelate', fr: 'Pixeliser' },
  'fx.pixelate.hint': { en: 'Big pixels', fr: 'Gros pixels' },

  'tr.empty': {
    en: 'Select the INCOMING clip: the transition describes how it joins the previous clip on the same track.',
    fr: 'Sélectionnez le clip ENTRANT : la transition décrit comment il rejoint le clip précédent, sur la même piste.',
  },
  'tr.visualOnly': {
    en: 'Transitions apply to visual clips.',
    fr: 'Les transitions concernent les clips visuels.',
  },
  'tr.intro': {
    en: 'The clip must touch the previous one. A cross dissolve uses handles on both sides — picture and sound move together.',
    fr: 'Le clip doit toucher le précédent. Un fondu enchaîné consomme de la marge des deux côtés — image et son sont décalés ensemble.',
  },
  'tr.clear': { en: 'Remove transition', fr: 'Retirer la transition' },
  'tr.margins': { en: 'Handles', fr: 'Marges' },
  'tr.gap': { en: 'Gap to previous clip:', fr: 'Écart avec le clip précédent :' },
  'tr.gapNone': { en: 'none', fr: 'aucun' },
  'tr.before': { en: 'Handle in (incoming):', fr: 'Marge avant (entrant) :' },
  'tr.after': { en: 'Handle out (outgoing):', fr: 'Marge après (sortant) :' },
  'tr.noPrevious': {
    en: 'No clip before this one on this track.',
    fr: 'Aucun clip avant celui-ci sur cette piste.',
  },
  'tr.warnGap': {
    en: 'The clip does not touch the previous one: the export will ignore the transition.',
    fr: 'Le clip ne touche pas le précédent : l’export ignorera la transition.',
  },
  'tr.warnMargin': {
    en: 'Not enough handle: the export will fade from the background instead, with no offset.',
    fr: 'Marge insuffisante : l’export fera un fondu depuis le fond, sans décalage.',
  },
  'tr.warnReduced': {
    en: 'Duration reduced to {time} by the available handles.',
    fr: 'Durée ramenée à {time} par les marges disponibles.',
  },
  'tr.fade.label': { en: 'Fade from background', fr: 'Fondu depuis le fond' },
  'tr.fade.hint': {
    en: 'No offset: synchronisation is guaranteed.',
    fr: 'Aucun déplacement : la synchronisation est garantie.',
  },
  'tr.dissolve.label': { en: 'Cross dissolve', fr: 'Fondu enchaîné' },
  'tr.dissolve.hint': {
    en: 'Picture and sound offset together; needs handles on both sides.',
    fr: 'Image et son décalés ensemble ; demande de la marge des deux côtés.',
  },

  // ── Timeline ─────────────────────────────────────────────────────────
  'tl.addVideo': { en: 'Video track', fr: 'Piste vidéo' },
  'tl.addVideoTitle': { en: 'New video track', fr: 'Nouvelle piste vidéo' },
  'tl.addAudio': { en: 'Audio track', fr: 'Piste audio' },
  'tl.addAudioTitle': { en: 'New audio track', fr: 'Nouvelle piste audio' },
  'tl.hint': { en: 'Drag media onto a track', fr: 'Glissez un média sur une piste' },
  'tl.zoomIn': { en: 'Zoom timeline in (+)', fr: 'Zoomer la timeline (+)' },
  'tl.zoomOut': { en: 'Zoom timeline out (−)', fr: 'Dézoomer la timeline (−)' },
  'tl.scrubTitle': {
    en: 'Drag to move through the edit (the timeline is collapsed)',
    fr: 'Glisser pour parcourir le montage (timeline repliée)',
  },
  'tl.fit': { en: 'Fit the whole edit in the window', fr: 'Afficher tout le montage' },

  // ── Mise à jour de l'application (service worker) ────────────────────
  'sw.ready': {
    en: 'A new version of the studio is ready.',
    fr: 'Une nouvelle version du studio est prête.',
  },
  'sw.activated': {
    en: 'The studio was updated.',
    fr: 'Le studio a été mis à jour.',
  },
  'sw.reload': { en: 'Update', fr: 'Mettre à jour' },
  'sw.reloadNow': { en: 'Reload', fr: 'Recharger' },
  'sw.updating': { en: 'Updating…', fr: 'Mise à jour…' },
  'sw.later': { en: 'Later', fr: 'Plus tard' },

  // ── Version affichée dans les Préférences ────────────────────────────
  'prefs.version': { en: 'Studio', fr: 'Studio' },
  'prefs.engineVersion': { en: 'engine', fr: 'moteur' },
  'tl.focus': {
    en: 'Focus the preview — hide the timeline (F)',
    fr: 'Focus sur l’aperçu — masquer la timeline (F)',
  },
  'tl.restore': {
    en: 'Show the timeline again (F)',
    fr: 'Réafficher la timeline (F)',
  },
  'tl.collapsed': { en: 'Timeline hidden', fr: 'Timeline masquée' },
  'tl.resize': { en: 'Resize the timeline', fr: 'Redimensionner la timeline' },
  'tl.mute': { en: 'Mute track', fr: 'Couper le son' },
  'tl.unmute': { en: 'Unmute track', fr: 'Rétablir le son' },
  'tl.trackVolume': { en: 'Track volume ({n} %)', fr: 'Volume de la piste ({n} %)' },
  'tl.trackVolumeLabel': { en: 'Track volume', fr: 'Volume de la piste' },
  'tl.metaText': { en: 'text', fr: 'texte' },
  'tl.metaEllipse': { en: 'ellipse', fr: 'ellipse' },
  'tl.metaShape': { en: 'shape', fr: 'forme' },
  'tl.badgeEffects': { en: '{n} effect|{n} effects', fr: '{n} effet|{n} effets' },
  'tl.badgeTransitionDissolve': { en: 'Cross dissolve', fr: 'Fondu enchaîné' },
  'tl.badgeTransitionFade': { en: 'Fade', fr: 'Fondu' },
  'tl.badgeMuted': { en: 'Clip sound muted', fr: 'Son du clip coupé' },
  'tl.textFallback': { en: 'Text', fr: 'Texte' },

  // ── Barre d'état ─────────────────────────────────────────────────────
  'status.ready': { en: 'Ready', fr: 'Prêt' },
  'status.auto': { en: 'Auto', fr: 'Auto' },
  'status.saving': { en: '…', fr: '…' },
  'status.error': { en: 'Error', fr: 'Erreur' },
  'status.fps': { en: '{n} fps', fr: '{n} i/s' },
  'status.clips': { en: '{n} clip|{n} clips', fr: '{n} clip|{n} clips' },
  'status.savedLabel': { en: 'Local autosave', fr: 'Sauvegarde locale' },

  // ── Export ───────────────────────────────────────────────────────────
  'export.title': { en: 'Export the edit', fr: 'Exporter le montage' },
  'export.format': { en: 'Format', fr: 'Format' },
  'export.quality': { en: 'Quality', fr: 'Qualité' },
  'export.resolution': { en: 'Resolution', fr: 'Résolution' },
  'export.fps': { en: 'Frame rate', fr: 'Cadence' },
  'export.qualityHigh': { en: 'High (CRF 18 / 30)', fr: 'Haute (CRF 18 / 30)' },
  'export.qualityMedium': { en: 'Balanced (CRF 22 / 34)', fr: 'Équilibrée (CRF 22 / 34)' },
  'export.qualityFast': { en: 'Fast (CRF 26 / 38)', fr: 'Rapide (CRF 26 / 38)' },
  'export.formatMp3': { en: 'MP3 — audio only', fr: 'MP3 — audio seul' },
  'export.audioOnly': { en: '<strong>MP3</strong> · 48 kHz stereo', fr: '<strong>MP3</strong> · 48 kHz stéréo' },
  'export.summaryVideo': {
    en: '<strong>{format}</strong> · {width}×{height} · {fps} fps',
    fr: '<strong>{format}</strong> · {width}×{height} · {fps} i/s',
  },
  'export.summaryAudioLine': {
    en: '{time} · {clips}',
    fr: '{time} · {clips}',
  },
  'export.summaryVideoLine': {
    en: '{time} · <strong>{frames}</strong> frames · {clips}{effects}{transitions}',
    fr: '{time} · <strong>{frames}</strong> images · {clips}{effects}{transitions}',
  },
  'export.effects': { en: ' · {n} effect|· {n} effects', fr: ' · {n} effet| · {n} effets' },
  'export.transitions': {
    en: ' · {n} transition|· {n} transitions',
    fr: ' · {n} transition|· {n} transitions',
  },
  'export.hintVideo': {
    en: 'ffmpeg encoding H.264 / VP9, 48 kHz audio. The result is identical on every machine.',
    fr: 'Encodage ffmpeg H.264 / VP9, audio 48 kHz. Le résultat est identique sur toutes les machines.',
  },
  'export.hintAudio': {
    en: 'ffmpeg mixdown to float PCM, LAME encoding. The result is identical on every machine.',
    fr: 'Mixage ffmpeg en PCM flottant, encodage LAME. Le résultat est identique sur toutes les machines.',
  },
  'export.hintVideoBrowser': {
    en: 'Encoded in this browser (WebCodecs), frame by frame: 48 kHz audio, same result on every machine running this browser.',
    fr: 'Encodé dans ce navigateur (WebCodecs), image par image : audio 48 kHz, même résultat sur toute machine équipée de ce navigateur.',
  },
  'export.hintAudioBrowser': {
    en: 'Mixed and encoded in this browser (LAME), 48 kHz stereo.',
    fr: 'Mixé et encodé dans ce navigateur (LAME), stéréo 48 kHz.',
  },
  'export.hintEngineFallback': {
    en: 'This project uses keyframes, masks or speed changes: it will be rendered in the browser (WebCodecs), because the native engine does not handle them yet.',
    fr: 'Ce projet utilise des keyframes, des masques ou une vitesse modifiée : il sera rendu dans le navigateur (WebCodecs), le moteur natif ne les gère pas encore.',
  },
  'export.audioSkipped': {
    en: '⚠︎ {n} audio track(s) could not be decoded by this browser: the video is exported without them. Chrome/Edge handle AAC natively; a Chromium build without proprietary codecs cannot.',
    fr: '⚠︎ {n} piste(s) audio non décodée(s) par ce navigateur : la vidéo est exportée sans elles. Chrome/Edge décodent l’AAC nativement ; une compilation Chromium sans codecs propriétaires en est incapable.',
  },
  'export.sending': { en: 'Sending the timeline…', fr: 'Envoi de la timeline…' },
  'export.preparing': { en: 'Preparing…', fr: 'Préparation…' },
  'stage.queued': { en: 'Queued…', fr: 'En attente…' },
  'stage.audio': { en: 'Mixing audio…', fr: 'Mixage audio…' },
  'stage.mux': { en: 'Encoding audio…', fr: 'Encodage audio…' },
  'stage.video': { en: 'Compositing and encoding…', fr: 'Composition et encodage…' },
  'stage.done': { en: 'Export complete', fr: 'Export terminé' },
  'stage.cancelled': { en: 'Export cancelled', fr: 'Export annulé' },
  'stage.error': { en: 'Export failed', fr: 'Échec de l’export' },
  'export.cancel': { en: 'Cancel', fr: 'Annuler' },
  'export.close': { en: 'Close', fr: 'Fermer' },
  'export.start': { en: 'Export', fr: 'Exporter' },
  'export.done': { en: 'Export complete', fr: 'Export terminé' },
  'export.download': { en: 'Download the file', fr: 'Télécharger le fichier' },
  'export.failed': { en: 'Export failed', fr: 'Échec de l’export' },
  'export.canceling': { en: 'Cancelling…', fr: 'Annulation…' },
  'export.cancelFailed': { en: 'Could not cancel: {error}', fr: 'Annulation impossible : {error}' },
  'export.noAudio': { en: 'no audio', fr: 'sans audio' },
  'export.encoderUnsupported': {
    en: 'This browser cannot encode {format} at {width}×{height}. Choose a lower resolution, or WebM (VP9) which often handles 4K where H.264 does not.',
    fr: 'Ce navigateur ne sait pas encoder le {format} en {width}×{height}. Choisissez une résolution inférieure, ou WebM (VP9), qui gère souvent la 4K là où le H.264 échoue.',
  },
  'export.size': { en: '{n} MB', fr: '{n} Mo' },
  'export.detailsAudio': { en: '{size} · {time} · 48 kHz stereo', fr: '{size} · {time} · 48 kHz stéréo' },
  'export.detailsVideo': {
    en: '{size} · {frames} frames · {seconds} s<br />{codecs} · {width}×{height}',
    fr: '{size} · {frames} images · {seconds} s<br />{codecs} · {width}×{height}',
  },

  // ── Préférences ──────────────────────────────────────────────────────
  'prefs.title': { en: 'Preferences', fr: 'Préférences' },
  'prefs.appearance': { en: 'Appearance', fr: 'Apparence' },
  'prefs.theme': { en: 'Theme', fr: 'Thème' },
  'prefs.themeHint': { en: 'The studio is dark by default.', fr: 'Le studio est sombre par défaut.' },
  'prefs.dark': { en: 'Dark', fr: 'Sombre' },
  'prefs.light': { en: 'Light', fr: 'Clair' },
  'prefs.language': { en: 'Language', fr: 'Langue' },
  'prefs.languageHint': {
    en: 'The interface switches immediately; the project is untouched.',
    fr: 'L’interface change immédiatement ; le projet n’est pas modifié.',
  },
  'prefs.format': { en: 'Default export format', fr: 'Format d’export par défaut' },
  'prefs.formatHint': {
    en: 'Applies to this project and to new ones.',
    fr: 'S’applique à ce projet et aux nouveaux.',
  },
  'prefs.shortcuts': { en: 'Shortcuts', fr: 'Raccourcis' },
  'prefs.showShortcuts': { en: 'View the shortcut sheet', fr: 'Voir la liste des raccourcis' },
  'prefs.done': { en: 'Done', fr: 'Terminé' },
  'prefs.engine': { en: 'Engine: {info}', fr: 'Moteur : {info}' },
  'engine.on': { en: 'engine', fr: 'moteur' },
  'engine.off': { en: 'offline', fr: 'hors ligne' },
  'engine.local': { en: 'in browser', fr: 'dans le navigateur' },
  'engine.localTitle': {
    en: 'Normal for the online studio: import and export run in this browser (WebCodecs). Nothing to install — keep the tab open while exporting.',
    fr: 'Normal pour le studio en ligne : l’import et l’export se font dans ce navigateur (WebCodecs). Rien à installer — gardez l’onglet ouvert pendant l’export.',
  },
  'engine.lostTitle': {
    en: 'The Rust engine stopped responding. Restart it (`cuttheflow serve`) then reload this page.',
    fr: 'Le moteur Rust ne répond plus. Relancez-le (`cuttheflow serve`) puis rechargez cette page.',
  },
  'export.browserHint': {
    en: 'Encoding happens in your browser — keep this tab open until it finishes.',
    fr: 'L’encodage se fait dans votre navigateur — gardez cet onglet ouvert jusqu’à la fin.',
  },
  'export.browserStart': { en: 'Encoding in the browser…', fr: 'Encodage dans le navigateur…' },
  'export.browserUnsupported': {
    en: 'This browser cannot encode {format}. Use a recent Chrome, Edge or Firefox.',
    fr: 'Ce navigateur ne sait pas encoder en {format}. Utilisez un Chrome, Edge ou Firefox récent.',
  },
  'engine.fontOk': { en: 'font OK', fr: 'police OK' },
  'prefs.engineOff': {
    en: 'Rust engine unreachable — run `cuttheflow serve`.',
    fr: 'Moteur Rust injoignable — lancez `cuttheflow serve`.',
  },

  // ── Aide ─────────────────────────────────────────────────────────────
  'help.title': { en: 'Keyboard shortcuts', fr: 'Raccourcis clavier' },
  'help.note': {
    en: 'The studio is built for mouse and keyboard, like a desktop application.',
    fr: 'Le studio est pensé pour la souris et le clavier, comme une application de bureau.',
  },
  'help.close': { en: 'Close', fr: 'Fermer' },

  // ── Messages ─────────────────────────────────────────────────────────
  'toast.placed': { en: '{name} placed on {track}', fr: '{name} posé sur {track}' },
  'toast.placedNewTrack': {
    en: '{name} placed on {track} (new track)',
    fr: '{name} posé sur {track} (nouvelle piste)',
  },
  'toast.mediaMissing': {
    en: '{n} project media are missing from the engine: import them again.|{n} project media are missing from the engine: import them again.',
    fr: '{n} média(s) du projet sont absents du moteur : réimportez-les.|{n} média(s) du projet sont absents du moteur : réimportez-les.',
  },
  'toast.engineOfflineImport': {
    en: 'Rust engine offline: cannot import.',
    fr: 'Moteur Rust hors ligne : impossible d’importer.',
  },
  'toast.engineOfflineExport': {
    en: 'Rust engine offline: cannot export.',
    fr: 'Moteur Rust hors ligne : impossible d’exporter.',
  },
  'toast.importing': { en: 'Importing {name}…', fr: 'Import de {name}…' },
  'toast.importingPercent': {
    en: 'Importing {name} — {percent} %',
    fr: 'Import de {name} — {percent} %',
  },
  'toast.imported': { en: '{name} imported.', fr: '{name} importé.' },
  'toast.importFailed': { en: 'Import failed: {error}', fr: 'Import impossible : {error}' },
  'toast.removeUsed': {
    en: '“{name}” is used on the timeline. Delete the media AND its clips?',
    fr: '« {name} » est utilisé sur la timeline. Supprimer le média ET ses clips ?',
  },
  'toast.removeConfirm': {
    en: 'Remove “{name}” from the library?',
    fr: 'Supprimer « {name} » de la médiathèque ?',
  },
  'toast.newProjectConfirm': {
    en: 'Start a new project? The current edit will be lost.',
    fr: 'Créer un nouveau projet ? Le montage actuel sera perdu.',
  },
  'toast.projectSaved': { en: 'Project saved.', fr: 'Projet enregistré.' },
  'toast.projectLoaded': { en: 'Project loaded.', fr: 'Projet chargé.' },
  'toast.projectUnreadable': { en: 'Unreadable project: {error}', fr: 'Projet illisible : {error}' },
  'toast.noClip': { en: 'No clip selected.', fr: 'Aucun clip sélectionné.' },
  'toast.playheadInside': {
    en: 'Place the playhead inside a clip to split it.',
    fr: 'Placez le playhead à l’intérieur d’un clip pour le couper.',
  },
  'toast.timelineEmpty': {
    en: 'The timeline is empty: add at least one clip.',
    fr: 'La timeline est vide : ajoutez au moins un clip.',
  },
  'toast.exportDone': { en: 'Export complete.', fr: 'Export terminé.' },
  'toast.exportFailed': { en: 'Export failed.', fr: 'Échec de l’export.' },
  'toast.engineDown': {
    en: 'Rust engine unreachable. Run `cuttheflow serve` and reload.',
    fr: 'Moteur Rust injoignable. Lancez `cuttheflow serve` et rechargez.',
  },

  'status.newProject': { en: 'New project', fr: 'Nouveau projet' },
  'status.projectSaved': { en: 'Project saved', fr: 'Projet enregistré' },
  'status.projectLoaded': { en: 'Project “{name}” loaded', fr: 'Projet « {name} » chargé' },
  'status.textAdded': {
    en: 'Text added — edit its content in Properties',
    fr: 'Texte ajouté — modifiez son contenu dans les propriétés',
  },
  'status.ellipseAdded': { en: 'Ellipse added', fr: 'Ellipse ajoutée' },
  'status.rectAdded': { en: 'Rectangle added', fr: 'Rectangle ajouté' },
  'status.clipDeleted': { en: 'Clip deleted', fr: 'Clip supprimé' },
  'status.clipDuplicated': { en: 'Clip duplicated', fr: 'Clip dupliqué' },
  'status.clipSplit': { en: 'Clip split at playhead', fr: 'Clip coupé au playhead' },
  'status.snapOn': { en: 'Snapping on', fr: 'Accrochage actif' },
  'status.snapOff': { en: 'Snapping off', fr: 'Accrochage désactivé' },
  'status.playing': { en: 'Playing', fr: 'Lecture' },
  'status.paused': { en: 'Paused', fr: 'Pause' },
  'status.engineDown': { en: 'Rust engine unreachable', fr: 'Moteur Rust injoignable' },
  'status.exportDone': { en: 'Export complete — {size}', fr: 'Export terminé — {size}' },
  'status.exportFailed': { en: 'Export failed', fr: 'Échec de l’export' },

  // ── Raccourcis ───────────────────────────────────────────────────────
  'sc.play': { en: 'Play / pause', fr: 'Lecture / pause' },
  'sc.frame': { en: 'Previous / next frame', fr: 'Image précédente / suivante' },
  'sc.second': { en: 'Back / forward one second', fr: 'Reculer / avancer d’une seconde' },
  'sc.homeEnd': { en: 'Go to start / end', fr: 'Aller au début / à la fin' },
  'sc.split': { en: 'Split the clip at the playhead', fr: 'Couper le clip au playhead' },
  'sc.delete': { en: 'Delete the selected clip', fr: 'Supprimer le clip sélectionné' },
  'sc.duplicate': { en: 'Duplicate the clip', fr: 'Dupliquer le clip' },
  'sc.text': { en: 'Add text', fr: 'Ajouter un texte' },
  'sc.rect': { en: 'Add a rectangle', fr: 'Ajouter un rectangle' },
  'sc.ellipse': { en: 'Add an ellipse', fr: 'Ajouter une ellipse' },
  'sc.snap': { en: 'Toggle snapping', fr: 'Activer / désactiver l’accrochage' },
  'sc.focus': {
    en: 'Focus the preview / bring the timeline back',
    fr: 'Focus sur l’aperçu / réafficher la timeline',
  },
  'sc.zoom': { en: 'Zoom the timeline in / out', fr: 'Zoomer / dézoomer la timeline' },
  'sc.fitTimeline': { en: 'Fit the whole edit in the window', fr: 'Afficher tout le montage' },
  'sc.fit': { en: 'Fit the preview to the window', fr: 'Ajuster l’aperçu à la fenêtre' },
  'sc.undo': { en: 'Undo the last edit', fr: 'Annuler la dernière action' },
  'sc.redo': { en: 'Redo the last undone edit', fr: 'Rétablir la dernière action annulée' },
  'sc.import': { en: 'Import media', fr: 'Importer des médias' },
  'sc.open': { en: 'Open a project', fr: 'Ouvrir un projet' },
  'sc.save': { en: 'Save the project', fr: 'Enregistrer le projet' },
  'sc.export': { en: 'Export', fr: 'Exporter' },
  'sc.new': { en: 'New project', fr: 'Nouveau projet' },
  'sc.prefs': { en: 'Preferences', fr: 'Préférences' },
  'sc.help': { en: 'Show the shortcuts', fr: 'Afficher les raccourcis' },
};

const LANG_KEY = 'ctf2.lang';
let current: Lang = 'en';

export function getLang(): Lang {
  return current;
}

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'fr';
}

/** Lit la langue mémorisée (défaut : anglais). */
export function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // stockage bloqué : l'anglais reste le défaut
  }
  return 'en';
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  let out = text;
  if (out.includes('|')) {
    const forms = out.split('|');
    out = Number(vars.n) === 1 ? forms[0] : (forms[1] ?? forms[0]);
  }
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

/**
 * Traduit une clé. Une clé inconnue est renvoyée telle quelle : en développement
 * on voit immédiatement le manque, en production rien ne casse.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  return interpolate(entry[current] || entry.en, vars);
}

/** Applique les traductions au balisage statique. */
export function applyStatic(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((element) => {
    const key = element.dataset.i18nHtml;
    if (key) element.innerHTML = t(key);
  });
  for (const [attribute, target] of [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder'],
  ] as const) {
    root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((element) => {
      const key = element.getAttribute(attribute);
      if (key) element.setAttribute(target, t(key));
    });
  }
}

/** Change la langue et met à jour le document. */
export function setLang(lang: Lang): void {
  current = lang;
  const root = document.documentElement;
  root.lang = lang;
  root.dataset.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // stockage bloqué : la langue vaut pour la session
  }
}

export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'en', label: 'EN' },
  { id: 'fr', label: 'FR' },
];
