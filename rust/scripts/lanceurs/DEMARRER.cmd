@echo off
rem CUT THE FLOW - lanceur Windows.
rem Double-cliquez sur ce fichier : le studio s'ouvre dans sa propre fenetre.
rem Rien n'est installe, rien n'est envoye sur Internet.

setlocal
cd /d "%~dp0"

if not exist "cuttheflow.exe" (
  echo.
  echo   cuttheflow.exe est absent de ce dossier.
  echo   Extrayez TOUTE l'archive avant de lancer, pas seulement ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "libunwind.dll" (
  echo   [info] libunwind.dll absent : liee en dur dans cette compilation,
  echo          le studio demarre quand meme.
)

echo.
echo   CUT THE FLOW - demarrage du studio...
echo   Une fenetre d'application va s'ouvrir (sans onglets ni barre d'adresse).
echo   Laissez cette fenetre noire ouverte pendant le montage.
echo   Fermez-la pour arreter le studio.
echo.

rem Sans argument : fenetre native si elle est compilee, navigateur sinon.
cuttheflow.exe
set CODE=%ERRORLEVEL%

if not "%CODE%"=="0" (
  echo.
  echo   Le studio s'est arrete avec le code %CODE%.
  echo   Pour un diagnostic : cuttheflow.exe doctor
  echo.
  pause
)
endlocal
