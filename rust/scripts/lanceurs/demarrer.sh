#!/usr/bin/env bash
# CUT THE FLOW - lanceur Linux.
#
#   bash demarrer.sh        (ou ./demarrer.sh si le fichier est exécutable)
#
# Le studio s'ouvre dans sa propre fenêtre (WebKitGTK) ; si WebKitGTK est
# absent, il bascule sur votre navigateur. Rien n'est installé ni envoyé sur
# Internet : tout reste sur cette machine.

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

# Un ZIP ne conserve pas le bit exécutable : on le remet sans rien demander.
chmod +x ./cuttheflow 2>/dev/null || true

echo
echo "  CUT THE FLOW - démarrage du studio..."
echo "  Une fenêtre d'application va s'ouvrir (sans onglets ni barre d'adresse)."
echo "  Laissez ce terminal ouvert pendant le montage ; Ctrl+C pour arrêter."
echo

# Sans argument : fenêtre native si elle est compilée, navigateur sinon.
./cuttheflow
code=$?

if [ "$code" -ne 0 ]; then
  echo
  echo "  Le studio s'est arrêté avec le code $code."
  echo "  Pour un diagnostic : ./cuttheflow doctor"
  echo
  read -r -p "  Appuyez sur Entrée pour fermer." _
fi
