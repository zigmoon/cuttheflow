#!/usr/bin/env bash
# CUT THE FLOW - lanceur macOS.
#
#   Double-clic sur ce fichier dans le Finder, ou dans le Terminal :
#   bash demarrer.command
#
# Au premier lancement, macOS peut refuser l'application téléchargée
# (« développeur non identifié ») : ce script lève lui-même la quarantaine
# pour le binaire, sans toucher au reste du système.

set -u
cd "$(dirname "$0")" || exit 1

if [ ! -f "cuttheflow" ]; then
  echo
  echo "  L'exécutable « cuttheflow » est absent de ce dossier."
  echo "  Extrayez TOUTE l'archive avant de lancer."
  echo
  read -r -p "  Appuyez sur Entrée pour fermer." _
  exit 1
fi

# 1. Bit exécutable (perdu par l'archive ZIP).
chmod +x ./cuttheflow 2>/dev/null || true

# 2. Quarantaine Gatekeeper : posée par le navigateur, elle bloque un binaire
#    non notarié. On la retire uniquement pour ce fichier.
if command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine ./cuttheflow 2>/dev/null || true
fi

echo
echo "  CUT THE FLOW - démarrage du studio..."
echo "  Une fenêtre dédiée va s'ouvrir (mode application, sans onglets)."
echo "  Laissez cette fenêtre ouverte pendant le montage ; Ctrl+C pour arrêter."
echo

./cuttheflow serve --open
code=$?

if [ "$code" -ne 0 ]; then
  echo
  echo "  Le studio s'est arrêté avec le code $code."
  echo "  Pour un diagnostic : ./cuttheflow doctor"
  echo
  read -r -p "  Appuyez sur Entrée pour fermer." _
fi
