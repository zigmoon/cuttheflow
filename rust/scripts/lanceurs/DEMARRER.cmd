@echo off
rem CUT THE FLOW - lanceur Windows.
rem Double-cliquez sur ce fichier : le studio s'ouvre dans votre navigateur.
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
  echo.
  echo   libunwind.dll est absent : l'executable ne peut pas demarrer.
  echo   Extrayez TOUTE l'archive, y compris les fichiers .dll.
  echo.
  pause
  exit /b 1
)

echo.
echo   CUT THE FLOW - demarrage du studio...
echo   Laissez cette fenetre ouverte pendant le montage.
echo   Fermez-la pour arreter le studio.
echo.

cuttheflow.exe serve --open
set CODE=%ERRORLEVEL%

if not "%CODE%"=="0" (
  echo.
  echo   Le studio s'est arrete avec le code %CODE%.
  echo   Pour un diagnostic : cuttheflow.exe doctor
  echo.
  pause
)
endlocal
