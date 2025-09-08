<#
  build_and_run_4.ps1

  - Ouvre le serveur dans une nouvelle fenêtre via start_server.cmd (logs visibles)
  - Compile l'application Flutter pour Windows (Release)
  - Lance 4 instances du client avec des paramètres différents via variables d'environnement:
      _paramNick, _autoCreate

  Usage:
    powershell -ExecutionPolicy Bypass -File .\build_and_run_4.ps1 [-Port 3000]
#>

param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "[INFO] Répertoire du dépôt: $repoRoot"

# --- 1) Démarrer le serveur dans une nouvelle fenêtre de console ---
$serverCmd = Join-Path $repoRoot 'start_server.cmd'
if (-not (Test-Path $serverCmd)) {
  throw "start_server.cmd introuvable à l'emplacement $serverCmd"
}

Write-Host "[INFO] Lancement du serveur (port $Port) dans une nouvelle fenêtre..."
# Utilise cmd.exe /k pour garder la fenêtre ouverte et afficher les logs
$cmdArgs = ('/k "{0}" {1}' -f $serverCmd, $Port)
Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WorkingDirectory $repoRoot -WindowStyle Normal | Out-Null

# Attente de l'ouverture du port pour éviter que les clients se connectent trop tôt
Write-Host "[INFO] Attente que le serveur écoute sur le port $Port..."
try {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $ok = (Test-NetConnection -ComputerName 'localhost' -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded
    } catch { $ok = $false }
    if ($ok) { break }
    Start-Sleep -Milliseconds 500
  }
} catch { }

# --- 2) Compiler l'application Flutter Windows ---
Write-Host "[INFO] Vérification de Flutter..."
if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  throw 'Flutter introuvable dans le PATH. Installez Flutter et réessayez.'
}

Push-Location $repoRoot
try {
  Write-Host "[INFO] Activation du support Windows dans Flutter..."
  flutter config --enable-windows-desktop | Out-Host

  Write-Host "[INFO] Compilation Windows (Release)..."
  flutter build windows --release | Out-Host
} finally {
  Pop-Location
}

# --- 3) Résoudre le chemin de l'exécutable Windows ---
$candidate = Join-Path $repoRoot 'build\windows\x64\runner\Release\loup_garou_client.exe'
if (-not (Test-Path $candidate)) {
  $exe = Get-ChildItem -Path (Join-Path $repoRoot 'build\windows') -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\runner\\(Release|Debug)\\' } |
    Select-Object -First 1
  if (-not $exe) {
    throw 'Exécutable Windows introuvable après compilation.'
  }
  $exePath = $exe.FullName
} else {
  $exePath = $candidate
}
Write-Host "[INFO] Exécutable client: $exePath"

# --- 4) Placement des fenêtres et lancement des 4 clients ---

# API Win32 pour déplacer/redimensionner les fenêtres
Add-Type -Namespace Native -Name Win32 -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

# Aire de travail de l'écran primaire
Add-Type -AssemblyName System.Windows.Forms
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$tileW = [int]([math]::Floor($wa.Width / 2))
$tileH = [int]([math]::Floor($wa.Height / 2))
$positions = @(
  @{ X = $wa.X;                  Y = $wa.Y },
  @{ X = $wa.X + $tileW;         Y = $wa.Y },
  @{ X = $wa.X;                  Y = $wa.Y + $tileH },
  @{ X = $wa.X + $tileW;         Y = $wa.Y + $tileH }
)

function Set-WindowBounds {
  param(
    [System.Diagnostics.Process]$Process,
    [int]$X, [int]$Y, [int]$W, [int]$H
  )
  if (-not $Process) { return }
  try { $null = $Process.WaitForInputIdle(5000) } catch { }
  for ($i = 0; $i -lt 60; $i++) {
    $Process.Refresh()
    $h = $Process.MainWindowHandle
    if ($h -ne [IntPtr]::Zero) {
      [Native.Win32]::ShowWindow($h, 5) | Out-Null    # SW_SHOW
      [Native.Win32]::MoveWindow($h, $X, $Y, $W, $H, $true) | Out-Null
      return
    }
    Start-Sleep -Milliseconds 100
  }
  Write-Host "[WARN] Fenêtre introuvable pour PID $($Process.Id) — impossible de positionner."
}

function Start-Client {
  param(
    [string]$Nick,
    [bool]$AutoCreate,
    [int]$X,
    [int]$Y,
    [int]$W,
    [int]$H
  )
  $env:_paramNick = $Nick
  if ($AutoCreate) { $env:_autoCreate = 'true' } else { $env:_autoCreate = 'false' }
  Write-Host "[INFO] Lancement client: _paramNick=$Nick, _autoCreate=$($env:_autoCreate)"
  $proc = Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Parent $exePath) -WindowStyle Normal -PassThru
  Set-WindowBounds -Process $proc -X $X -Y $Y -W $W -H $H
  return $proc
}

# Lancement des 4 fenêtres en grille 2x2 (demi-largeur et demi-hauteur)
$p = 0
Start-Client -Nick 'fabrice_serveur' -AutoCreate $true  -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH | Out-Null; $p++
Start-Sleep -Milliseconds 400
Start-Client -Nick 'fabrice_2'      -AutoCreate $false -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH | Out-Null; $p++
Start-Sleep -Milliseconds 400
Start-Client -Nick 'fabrice_3'      -AutoCreate $false -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH | Out-Null; $p++
Start-Sleep -Milliseconds 400
Start-Client -Nick 'fabrice_4'      -AutoCreate $false -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH | Out-Null

Write-Host "[OK] Serveur et 4 clients lancés."
