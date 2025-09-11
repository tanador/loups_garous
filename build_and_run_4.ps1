<#
  build_and_run_4.ps1 — Multi‑run helper (server + 4 clients)

  Ce script:
  - Démarre le serveur dans une nouvelle fenêtre via start_server.cmd (logs visibles)
  - Lance la compilation Windows du client Flutter en parallèle
  - Ouvre 4 instances du client, côte à côte, sur l’écran choisi
  - Force la taille de chaque fenêtre à 300x600 px et la positionne sans chevauchement
  - Avant de lancer, ferme toute instance serveur (port choisi) et toute instance
    Windows du client déjà en cours d’exécution

  Paramètres:
    -Port <int>         Port HTTP du serveur (défaut 3000)
    -ScreenIndex <int>  Écran cible (0 = principal, 1 = second, ... ; défaut 1)
    -NoAuto             Si présent, n’envoie pas _paramNick ni _autoCreate aux clients
    -FirstX <int>       Décalage X relatif (en px) de la 1ère fenêtre dans la zone utile de l’écran
    -FirstY <int>       Décalage Y relatif (en px) de la 1ère fenêtre dans la zone utile de l’écran

  Comportement par défaut (sans -NoAuto):
    - 1ère instance:  _paramNick=fabrice_serveur, _autoCreate=true (crée une partie 4 joueurs)
    - 2ème instance:  _paramNick=fabrice_2,      _autoCreate=false (se connecte et rejoint auto)
    - 3ème instance:  _paramNick=fabrice_3,      _autoCreate=false
    - 4ème instance:  _paramNick=fabrice_4,      _autoCreate=false

  Exemples:
    .\build_and_run_4.ps1                          # Écran 2 (index 1), auto on
    .\build_and_run_4.ps1 -ScreenIndex 0           # Écran principal
    .\build_and_run_4.ps1 -Port 3001               # Serveur sur 3001
    .\build_and_run_4.ps1 -NoAuto                  # Sans _paramNick/_autoCreate
    .\build_and_run_4.ps1 -ScreenIndex 1 -FirstX 50 -FirstY 80  # Décale la 1ère fenêtre

  Notes:
    - Le build Windows se fait en parallèle du démarrage du serveur pour gagner du temps.
    - Les tailles/positions sont imposées via Win32 et côté app (plugin window_manager)
      afin d’être stables sur les écrans à DPI élevé.
#>

param(
  [int]$Port = 3000,
  [int]$ScreenIndex = 0,
  [switch]$NoAuto,
  [int]$FirstX = 0,
  [int]$FirstY = 0
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "[INFO] Repo path: $repoRoot"

# --- Ctrl+C handler: on interruption, close server console and clients ---
try { Unregister-Event -SourceIdentifier 'LG_CtrlC' -ErrorAction SilentlyContinue } catch { }
$serverTitle = "LG_SERVER_$Port"
$env:LG_SERVER_TITLE = $serverTitle
$env:LG_SERVER_PORT = "$Port"
try {
  Register-ObjectEvent -InputObject ([console]) -EventName CancelKeyPress -SourceIdentifier 'LG_CtrlC' -Action {
    param($sender, $eventArgs)
    # Annule l'arrêt par défaut pour nous laisser nettoyer proprement
    try { if ($eventArgs) { $eventArgs.Cancel = $true } } catch { }
    try {
      $title = $env:LG_SERVER_TITLE
      if ($title) {
        Get-Process -Name cmd -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowTitle -eq $title } |
          ForEach-Object { & taskkill /PID $_.Id /T /F 2>$null | Out-Null }
      }
    } catch { }
    try {
      # Éteindre le serveur par PID(s) écoutant sur le port
      $p = $env:LG_SERVER_PORT
      if ($p) {
        try {
          $list = Get-NetTCPConnection -LocalPort ([int]$p) -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
          foreach ($procId in $list) { & taskkill /PID $procId /T /F 2>$null | Out-Null }
        } catch { }
        try {
          netstat -ano -p tcp | Select-String -SimpleMatch (":" + $p) |
            ForEach-Object { ($_ -split '\s+')[-1] } |
            Where-Object { $_ -match '^\d+$' } | Sort-Object -Unique |
            ForEach-Object { & taskkill /PID $_ /T /F 2>$null | Out-Null }
        } catch { }
      }
    } catch { }
    try {
      # Fermer aussi les consoles cmd associées à start_server.cmd
      Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'start_server\.cmd' } |
        ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }
    } catch { }
    try {
      # Fermer les clients
      Get-Process -Name 'loup_garou_client' -ErrorAction SilentlyContinue |
        ForEach-Object { & taskkill /PID $_.Id /T /F 2>$null | Out-Null }
    } catch { }
  } | Out-Null
  Write-Host "[INFO] Ctrl+C handler registered (will close server/clients)."
} catch { }

# --- 0) Nettoyage: fermer les serveurs/app clients déjà en cours ---
function Stop-ProcessTree {
  param([int]$Pid)
  if (-not $Pid) { return }
  try {
    # Tuer le processus et ses enfants (Windows)
    $null = & taskkill /PID $Pid /T /F 2>$null
  } catch { }
}

Write-Host "[INFO] Cleaning up previous instances (server + clients)..."

# 0.a) Fermer le serveur écoutant sur le port demandé
try {
  $pids = @()
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conns) { $pids = $conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique }
  } catch { }
  if (-not $pids -or $pids.Count -eq 0) {
    # Fallback via netstat
    try {
      $lines = netstat -ano -p tcp | Select-String -SimpleMatch (":$Port")
      if ($lines) {
        $pids = $lines | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ -match '^\d+$' } | Sort-Object -Unique
      }
    } catch { }
  }
  foreach ($procId in $pids) {
    Write-Host "[INFO] Stopping server process PID=$procId (port $Port)"
    Stop-ProcessTree -Pid [int]$procId
  }
} catch {
  try {
    $em = $_
    $msg = "[WARN] Failed to probe/stop server on port {0}: {1}" -f $Port, ($em.Exception.Message)
    Write-Host $msg
  } catch {
    Write-Host "[WARN] Failed to probe/stop server on port (message unavailable)"
  }
}

# 0.b) Fermer les fenêtres cmd lancées via start_server.cmd (si restées ouvertes)
try {
  # Détection par ligne de commande
  $srvCmds = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'start_server\.cmd' }
  foreach ($c in $srvCmds) {
    Write-Host "[INFO] Closing server console (cmd.exe) PID=$($c.ProcessId) [commandline match]"
    Stop-ProcessTree -Pid $c.ProcessId
  }
  # Détection par titre de fenêtre (assigné lors du lancement)
  $srvByTitle = Get-Process -Name cmd -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like 'LG_SERVER_*' }
  foreach ($p in $srvByTitle) {
    Write-Host "[INFO] Closing server console (cmd.exe) PID=$($p.Id) [title=$($p.MainWindowTitle)]"
    Stop-ProcessTree -Pid $p.Id
  }
} catch { }

# 0.c) Fermer toutes les instances Windows de l'appli Flutter
try {
  $clientExeName = 'loup_garou_client'
  $clients = @(Get-Process -Name $clientExeName -ErrorAction SilentlyContinue)
  foreach ($p in $clients) {
    Write-Host "[INFO] Stopping client PID=$($p.Id)"
    Stop-ProcessTree -Pid $p.Id
  }
} catch { }

# Petit délai pour libérer les verrous de fichiers/ports
Start-Sleep -Milliseconds 400

# --- 1) Démarrer le serveur dans une nouvelle fenêtre de console ---
$serverCmd = Join-Path $repoRoot 'start_server.cmd'
if (-not (Test-Path $serverCmd)) {
  throw "start_server.cmd not found at $serverCmd"
}

Write-Host "[INFO] Launching server (port $Port) in a new window..."
# Utilise cmd.exe /k pour garder la fenêtre ouverte et afficher les logs, avec un titre distinctif
$serverTitle = "LG_SERVER_$Port"
$cmdInner = "title $serverTitle & `"$serverCmd`" $Port"
$script:serverProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $cmdInner) -WorkingDirectory $repoRoot -WindowStyle Normal -PassThru

# --- 2) Start Flutter Windows build concurrently ---
Write-Host "[INFO] Checking Flutter..."
if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  throw 'Flutter not found in PATH. Install Flutter and retry.'
}

try {
  Write-Host "[INFO] Enabling Windows desktop target (idempotent)..."
  & flutter config --enable-windows-desktop | Out-Null
} catch { }

Write-Host "[INFO] Ensuring pub packages are fetched..."
$logDir = Join-Path $repoRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory | Out-Null }
$pubLog = Join-Path $logDir 'flutter_pub_get.log'
$pubErrLog = Join-Path $logDir 'flutter_pub_get.err.log'
$pubArgs = @('pub','get')
$pubProc = Start-Process -FilePath 'flutter' -ArgumentList $pubArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $pubLog -RedirectStandardError $pubErrLog -PassThru
while (-not $pubProc.HasExited) { Start-Sleep -Milliseconds 250 }
$pubExit = $pubProc.ExitCode
if ($null -eq $pubExit) {
  # Some shells/wrappers might not propagate exit code; infer from log.
  try {
    $ok = Select-String -Path $pubLog -SimpleMatch 'Got dependencies!' -Quiet
    if ($ok) { $pubExit = 0 } else { $pubExit = 1 }
  } catch { $pubExit = 1 }
}
if ($pubExit -ne 0) {
  Write-Host "[ERROR] flutter pub get failed (exit $pubExit). See $pubLog (stdout) and $pubErrLog (stderr)" -ForegroundColor Red
  try { Get-Content -Path $pubLog -Tail 60 | ForEach-Object { Write-Host $_ } } catch { }
  try { Get-Content -Path $pubErrLog -Tail 60 | ForEach-Object { Write-Host $_ } } catch { }
  throw "Flutter pub get failed with exit code $pubExit"
}

Write-Host "[INFO] Starting Windows build in background... (logs: logs/flutter_build_windows.log, logs/flutter_build_windows.err.log)"
$buildArgs = @('build','windows','--release','-v')
$buildLog = Join-Path $logDir 'flutter_build_windows.log'
$buildErrLog = Join-Path $logDir 'flutter_build_windows.err.log'
$buildProc = Start-Process -FilePath 'flutter' -ArgumentList $buildArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $buildLog -RedirectStandardError $buildErrLog -PassThru

# In parallel: wait for server port to open
Write-Host "[INFO] Waiting for server on port $Port while build runs..."
$serverReady = $false
try {
  for ($i = 0; $i -lt 120; $i++) { # up to ~60s
    try {
      $ok = (Test-NetConnection -ComputerName 'localhost' -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded
    } catch { $ok = $false }
    if ($ok) { $serverReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
} catch { }

# Wait for build to finish
Write-Host "[INFO] Waiting for Windows build to finish (pid $($buildProc.Id))..."
while (-not $buildProc.HasExited) { Start-Sleep -Milliseconds 500 }
$buildExit = $buildProc.ExitCode
if ($null -eq $buildExit) {
  # Fallback: infer success by probing output binary presence
  try {
    $candidate = Join-Path $repoRoot 'build\windows\x64\runner\Release\loup_garou_client.exe'
    if (Test-Path $candidate) { $buildExit = 0 } else { $buildExit = 1 }
  } catch { $buildExit = 1 }
}
if ($buildExit -ne 0) {
  Write-Host "[ERROR] Flutter build failed (exit $($buildProc.ExitCode)). Showing last lines:" -ForegroundColor Red
  try { Get-Content -Path $buildLog -Tail 80 | ForEach-Object { Write-Host $_ } } catch { }
  try { Get-Content -Path $buildErrLog -Tail 80 | ForEach-Object { Write-Host $_ } } catch { }
  throw "Flutter build failed with exit code $buildExit (see $buildLog and $buildErrLog)"
}

# --- 3) Resolve Windows executable path ---
$candidate = Join-Path $repoRoot 'build\windows\x64\runner\Release\loup_garou_client.exe'
if (-not (Test-Path $candidate)) {
  $exe = Get-ChildItem -Path (Join-Path $repoRoot 'build\windows') -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\runner\\(Release|Debug)\\' } |
    Select-Object -First 1
  if (-not $exe) { throw 'Windows executable not found after build.' }
  $exePath = $exe.FullName
} else {
  $exePath = $candidate
}
Write-Host "[INFO] Client executable: $exePath"

# --- 4) Window tiling and launching 4 clients ---

# Win32 API to move/resize windows (guard against duplicate type definition)
if (-not ([System.Management.Automation.PSTypeName] 'Native.Win32').Type) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Native {
  public static class Win32 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  }
}
'@
}

# Provide a second type with SetWindowPos to avoid duplicate-type issues across sessions
if (-not ([System.Management.Automation.PSTypeName] 'Native2.Win32Ex').Type) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Native2 {
  public static class Win32Ex {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  }
}
'@
}

# Utility type for RECT and GetWindowRect (guarded)
if (-not ([System.Management.Automation.PSTypeName] 'NativeUtil.Win32Helpers').Type) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace NativeUtil {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static class Win32Helpers {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  }
}
'@
}

# Window placement API for robust sizing
if (-not ([System.Management.Automation.PSTypeName] 'NativePlacements.Win32Place').Type) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace NativePlacements {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct WINDOWPLACEMENT {
    public int length;
    public int flags;
    public int showCmd;
    public POINT ptMinPosition;
    public POINT ptMaxPosition;
    public RECT rcNormalPosition;
  }
  public static class Win32Place {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  }
}
'@
}

# Working area of the target screen (second monitor by default)
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$screenCount = $screens.Length
if ($screenCount -eq 0) { throw 'No screens detected.' }

$targetScreen = $null
if ($ScreenIndex -ge 0 -and $ScreenIndex -lt $screenCount) {
  $targetScreen = $screens[$ScreenIndex]
}
if (-not $targetScreen) {
  # Fallback: first non-primary, else primary
  $targetScreen = ($screens | Where-Object { -not $_.Primary } | Select-Object -First 1)
  if (-not $targetScreen) { $targetScreen = [System.Windows.Forms.Screen]::PrimaryScreen }
}

$wa = $targetScreen.WorkingArea
Write-Host "[INFO] Using screen index $([array]::IndexOf($screens, $targetScreen)) ($($targetScreen.DeviceName)) area: X=$($wa.X) Y=$($wa.Y) W=$($wa.Width) H=$($wa.Height)"

# Force each window to 300x600 pixels, positioned side by side
$tileW = 300
$tileH = 600

# Base (first window) position relative to the target screen working area
$maxRelX = [int]([math]::Max(0, $wa.Width - ($tileW * 4)))
$maxRelY = [int]([math]::Max(0, $wa.Height - $tileH))
$baseRelX = [int]([math]::Max(0, [math]::Min($maxRelX, $FirstX)))
$baseRelY = [int]([math]::Max(0, [math]::Min($maxRelY, $FirstY)))
$baseX = $wa.X + $baseRelX
$baseY = $wa.Y + $baseRelY
Write-Host "[INFO] First window position (relative): X=$baseRelX Y=$baseRelY (absolute: X=$baseX Y=$baseY)"

$positions = @(
  @{ X = $baseX + ($tileW * 0);   Y = $baseY },
  @{ X = $baseX + ($tileW * 1);   Y = $baseY },
  @{ X = $baseX + ($tileW * 2);   Y = $baseY },
  @{ X = $baseX + ($tileW * 3);   Y = $baseY }
)

function Set-WindowBounds {
  param(
    [System.Diagnostics.Process]$Process,
    [int]$X, [int]$Y, [int]$W, [int]$H
  )
  if (-not $Process) { return }
  try { $null = $Process.WaitForInputIdle(1500) } catch { }
  for ($i = 0; $i -lt 60; $i++) {
    $Process.Refresh()
    $h = $Process.MainWindowHandle
    if ($h -ne [IntPtr]::Zero) {
      # Ensure window is restored (not maximized), then position/resize
      [Native.Win32]::ShowWindow($h, 9) | Out-Null    # SW_RESTORE
      # Pre-apply normal placement rectangle
      try {
        $wp = New-Object 'NativePlacements.WINDOWPLACEMENT'
        $wp.length = [System.Runtime.InteropServices.Marshal]::SizeOf([type]'NativePlacements.WINDOWPLACEMENT')
        $wp.showCmd = 1  # SW_SHOWNORMAL
        $rect = New-Object 'NativePlacements.RECT'
        $rect.Left = $X; $rect.Top = $Y; $rect.Right = $X + $W; $rect.Bottom = $Y + $H
        $wp.rcNormalPosition = $rect
        [NativePlacements.Win32Place]::SetWindowPlacement($h, [ref]$wp) | Out-Null
      } catch {}
      $SWP_NOZORDER = 0x0004
      $SWP_NOOWNERZORDER = 0x0200
      $SWP_NOACTIVATE = 0x0010
      $SWP_FRAMECHANGED = 0x0020
      # Try multiple times to beat any initial auto-resize by the app
      for ($j = 0; $j -lt 12; $j++) {
        if ($j -gt 0) { Start-Sleep -Milliseconds 150 }
        $ok = $false
        if (([System.Management.Automation.PSTypeName] 'Native2.Win32Ex').Type) {
          $ok = [Native2.Win32Ex]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $W, $H, ($SWP_NOZORDER -bor $SWP_NOOWNERZORDER -bor $SWP_FRAMECHANGED))
        } elseif (([System.Management.Automation.PSTypeName] 'Native.Win32').Type -and ([System.Management.Automation.PSTypeName] 'Native.Win32').Type.GetMethod('SetWindowPos')) {
          $ok = [Native.Win32]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $W, $H, ($SWP_NOZORDER -bor $SWP_NOOWNERZORDER -bor $SWP_FRAMECHANGED))
        }
        if (-not $ok) {
          [Native.Win32]::MoveWindow($h, $X, $Y, $W, $H, $true) | Out-Null
        }
      }
      # Verify and enforce final size a few more times in case the app resizes itself
      $finalW = $null; $finalH = $null
      for ($k = 0; $k -lt 60; $k++) {
        Start-Sleep -Milliseconds 200
        try {
          $rect = New-Object 'NativeUtil.RECT'
          if ([NativeUtil.Win32Helpers]::GetWindowRect($h, [ref]$rect)) {
            $curH = [int]($rect.Bottom - $rect.Top)
            $curW = [int]($rect.Right - $rect.Left)
            $finalW = $curW; $finalH = $curH
            if (([math]::Abs($curH - $H) -le 2) -and ([math]::Abs($curW - $W) -le 2)) { break }
          }
        } catch {}
        if (([System.Management.Automation.PSTypeName] 'Native2.Win32Ex').Type) {
          [Native2.Win32Ex]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $W, $H, ($SWP_NOZORDER -bor $SWP_NOOWNERZORDER -bor $SWP_FRAMECHANGED)) | Out-Null
        } else {
          [Native.Win32]::MoveWindow($h, $X, $Y, $W, $H, $true) | Out-Null
        }
      }
      if ($finalW -and $finalH) { Write-Host "[INFO] Final window size: ${finalW}x${finalH}" }
      return
    }
    Start-Sleep -Milliseconds 100
  }
  Write-Host "[WARN] Window not found for PID $($Process.Id) - cannot position."
}

function Start-Client {
  param(
    [string]$Nick,
    [bool]$AutoCreate,
    [int]$X,
    [int]$Y,
    [int]$W,
    [int]$H,
    [switch]$NoAuto
  )
  if ($NoAuto) {
    Remove-Item Env:_paramNick -ErrorAction SilentlyContinue
    Remove-Item Env:_autoCreate -ErrorAction SilentlyContinue
  } else {
    $env:_paramNick = $Nick
    if ($AutoCreate) { $env:_autoCreate = 'true' } else { $env:_autoCreate = 'false' }
  }
  # Pass desired window size/position to the Flutter app
  $env:WINDOW_W = "$W"
  $env:WINDOW_H = "$H"
  $env:WINDOW_X = "$X"
  $env:WINDOW_Y = "$Y"
  Write-Host "[INFO] Launching client: _paramNick=$Nick, _autoCreate=$($env:_autoCreate)"
  $proc = Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Parent $exePath) -WindowStyle Normal -PassThru
  Set-WindowBounds -Process $proc -X $X -Y $Y -W $W -H $H
  return $proc
}

# Spawn client quickly (no positioning/wait), return process
function Spawn-Client {
  param(
    [string]$Nick,
    [bool]$AutoCreate,
    [int]$X,
    [int]$Y,
    [int]$W,
    [int]$H,
    [switch]$NoAuto
  )
  if ($NoAuto) {
    Remove-Item Env:_paramNick -ErrorAction SilentlyContinue
    Remove-Item Env:_autoCreate -ErrorAction SilentlyContinue
  } else {
    $env:_paramNick = $Nick
    if ($AutoCreate) { $env:_autoCreate = 'true' } else { $env:_autoCreate = 'false' }
  }
  $env:WINDOW_W = "$W"; $env:WINDOW_H = "$H"; $env:WINDOW_X = "$X"; $env:WINDOW_Y = "$Y"
  return (Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Parent $exePath) -WindowStyle Normal -PassThru)
}

# Launch 4 windows side by side quickly, then position/resize
$procs = @()
$p = 0
$procs += Spawn-Client -Nick 'fabrice_serveur' -AutoCreate $true  -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH -NoAuto:$NoAuto; $p++
$procs += Spawn-Client -Nick 'fabrice_2'      -AutoCreate $false -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH -NoAuto:$NoAuto; $p++
$procs += Spawn-Client -Nick 'fabrice_3'      -AutoCreate $false -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH -NoAuto:$NoAuto; $p++
$procs += Spawn-Client -Nick 'fabrice_4'      -AutoCreate $false -X $positions[$p].X -Y $positions[$p].Y -W $tileW -H $tileH -NoAuto:$NoAuto

# After spawning, position/resize each
for ($i = 0; $i -lt $procs.Count; $i++) {
  Set-WindowBounds -Process $procs[$i] -X $positions[$i].X -Y $positions[$i].Y -W $tileW -H $tileH
}

Write-Host "[OK] Server and 4 clients launched."
Write-Host "[INFO] Press Ctrl+C in this console to stop server and clients (or close the server window)."
if ($script:serverProc) {
  try { Wait-Process -Id $script:serverProc.Id } catch { }
} else {
  try { Wait-Event -SourceIdentifier 'LG_CtrlC' } catch { while ($true) { Start-Sleep -Seconds 60 } }
}
