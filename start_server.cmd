@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ----------------------------------------------------------------------------
rem start_server.cmd
rem - Installe/Met à jour les dépendances du serveur, compile et lance sur PORT
rem - Peut aussi générer/réparer les fichiers Windows du projet Flutter
rem ----------------------------------------------------------------------------

set "PROJECT_DIR=%~dp0"

rem ---------- Sous-commandes ----------
if /I "%~1"=="windows" goto :WINDOWS
if /I "%~1"=="--windows" goto :WINDOWS
if /I "%~1"=="-w" goto :WINDOWS
if /I "%~1"=="help" goto :HELP
if /I "%~1"=="--help" goto :HELP
if /I "%~1"=="-h" goto :HELP

rem ---------- Port (par défaut 3000) ----------
set "PORT_IN=%PORT%"
if /I "%~1"=="--port" (
  if not "%~2"=="" set "PORT_IN=%~2"
) else (
  if not "%~1"=="" set "PORT_IN=%~1"
)
if "%PORT_IN%"=="" set "PORT_IN=3000"

echo [INFO] Démarrage du serveur sur le port %PORT_IN%...
where node >nul 2>&1 || (echo [ERREUR] Node.js introuvable. Installez Node 20+ puis réessayez.& exit /b 1)
where npm  >nul 2>&1 || (echo [ERREUR] npm introuvable.& exit /b 1)

pushd "%PROJECT_DIR%server" || (echo [ERREUR] Dossier "server" introuvable.& exit /b 1)

echo [INFO] Installation/MAJ des dépendances...
call npm install
if errorlevel 1 goto :ERR

echo [INFO] Compilation TypeScript...
call npm run build
if errorlevel 1 goto :ERR

echo [INFO] Lancement du serveur...
set "PORT=%PORT_IN%"
call npm start
set "EXIT_CODE=%ERRORLEVEL%"

popd
exit /b %EXIT_CODE%

:WINDOWS
echo [INFO] Génération/réparation du runner Windows Flutter...
where flutter >nul 2>&1 || (echo [ERREUR] Flutter introuvable. Installez Flutter et réessayez.& exit /b 1)

pushd "%PROJECT_DIR%"
call flutter config --enable-windows-desktop
if errorlevel 1 goto :ERR

rem Utilise le chemin du projet (gère les espaces) comme demandé
call flutter create --platforms=windows "%PROJECT_DIR%"
if errorlevel 1 goto :ERR

echo [INFO] Fichiers Windows générés dans "%PROJECT_DIR%windows".
popd
exit /b 0

:HELP
echo Usage:
echo   start_server.cmd ^[--port N^]
echo   start_server.cmd windows
echo.
echo Sans argument: installe, compile et lance le serveur sur le port 3000.
echo Sous-commande "windows":
echo   flutter config --enable-windows-desktop ^& flutter create --platforms=windows "^<racine_projet^>"
exit /b 0

:ERR
echo [ERREUR] Une commande a échoué. Code %ERRORLEVEL%.
popd >nul 2>&1
exit /b 1
