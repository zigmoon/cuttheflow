#!/usr/bin/env bash
# Installe CUT THE FLOW pour l'utilisateur courant, sans root.
#
#   bash installer.sh
#
# Copie l'exécutable dans ~/.local/bin, les icônes dans le thème d'icônes et
# l'entrée de menu dans ~/.local/share/applications : l'application apparaît
# alors dans le lanceur, avec sa vraie icône, et se lance d'un clic.
#
# Rien n'est fait hors du dossier personnel ; pour désinstaller, voir la fin.

set -u
cd "$(dirname "$0")" || exit 1

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA_DIR/applications"
ICON_ROOT="$DATA_DIR/icons/hicolor"
BINARY="cuttheflow"

say() { printf '  %s\n' "$1"; }

if [ ! -f "$BINARY" ]; then
  echo "  L'exécutable « $BINARY » est absent de ce dossier."
  echo "  Extrayez TOUTE l'archive avant de lancer l'installation."
  exit 1
fi

mkdir -p "$BIN_DIR" "$APP_DIR" || exit 1

# 1. L'exécutable.
install -m 0755 "$BINARY" "$BIN_DIR/$BINARY" || exit 1
say "exécutable   : $BIN_DIR/$BINARY"

# 2. Les icônes, à chaque taille : sans cela le tableau de bord en invente une.
for size in 32 48 64 128 256 512; do
  source="icons/cuttheflow-$size.png"
  [ -f "$source" ] || continue
  target="$ICON_ROOT/${size}x${size}/apps"
  mkdir -p "$target"
  cp -f "$source" "$target/cuttheflow.png"
done
say "icônes       : $ICON_ROOT/*/apps/cuttheflow.png"

# 3. L'entrée de menu. Exec=cuttheflow suppose ~/.local/bin dans le PATH, ce qui
#    est le cas par défaut sur Ubuntu, Fedora et Debian récents. Sinon on écrit
#    le chemin absolu, qui marche toujours.
#
#    Le fichier est écrit directement (pas de `sed` sur un modèle) : un chemin
#    contenant « & », « | » ou une espace casserait une substitution, alors
#    qu'une heredoc n'interprète rien.
desktop_exec="$BINARY"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) desktop_exec="$BIN_DIR/$BINARY" ;;
esac
cat > "$APP_DIR/cuttheflow.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=CUT THE FLOW
GenericName=Video editor
GenericName[fr]=Monteur vidéo
Comment=Multitrack video editing with a deterministic ffmpeg export
Comment[fr]=Montage multitrack, export déterministe par ffmpeg
Exec="$desktop_exec" %U
TryExec=$desktop_exec
Icon=cuttheflow
Terminal=false
Categories=AudioVideo;Video;AudioVideoEditing;
Keywords=video;editor;montage;ffmpeg;
StartupNotify=true
StartupWMClass=cuttheflow
Actions=web;

[Desktop Action web]
Name=Open in the browser
Name[fr]=Ouvrir dans le navigateur
Exec="$desktop_exec" --web
DESKTOP
chmod 0644 "$APP_DIR/cuttheflow.desktop"
say "menu         : $APP_DIR/cuttheflow.desktop"

# 4. Rafraîchir les caches, si les outils sont là. Leur absence n'est pas grave.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" 2>/dev/null
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f "$ICON_ROOT" 2>/dev/null

echo
echo "  CUT THE FLOW est installé : cherchez-le dans vos applications."
if [ "$desktop_exec" = "$BINARY" ]; then
  echo "  En terminal :  cuttheflow"
else
  echo "  En terminal :  $BIN_DIR/$BINARY"
  echo "  (~/.local/bin n'est pas dans votre PATH : ajoutez-le pour taper « cuttheflow ».)"
fi
echo
echo "  Désinstaller :"
echo "    rm -f $BIN_DIR/$BINARY $APP_DIR/cuttheflow.desktop"
echo "    rm -f $ICON_ROOT/*/apps/cuttheflow.png"
echo
