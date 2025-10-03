<#
  build_and_run.ps1 - Multi-run helper (server + N clients)

  Ce script parametreable :
  - Demarre le serveur dans une nouvelle fenetre via start_server.cmd (logs visibles)
  - Lance la compilation Windows du client Flutter en parallele
  - Ouvre N instances du client et les dispose en grille sur l'ecran choisi
  - Force chaque fenetre a 300x600 px et ajuste la position selon les offsets
  - Avant de lancer, ferme les instances serveurs/clients deja en cours d'execution

  Parametres :
    -NbJoueurs <int>    Nombre d'instances client a lancer (defaut 5)
    -Port <int>         Port HTTP du serveur (defaut 3000)
    -ScreenIndex <int>  Ecran cible (0 = principal, 1 = second, ... ; defaut 0)
    -AutoCreate         Active le flux automatique (rejoindre ou creer la partie)
    -NoServer           Ignore le lancement du serveur
    -FirstX <int>       Decalage X (px) du coin haut-gauche de la grille
    -FirstY <int>       Decalage Y (px) du coin haut-gauche de la grille

  Comportement par defaut :
    - 1ere instance : pseudo "Fabrice 1", autoCreate & autoJoin actifs, autoMaxPlayers=NbJoueurs
    - 2..N           : pseudo "Fabrice {i}", autoJoin actif

  Remarques :
    - Le serveur n'acceptera que les tailles prevues cote back; avec la version
      actuelle du depot, les valeurs autorisees sont 3-6 et 8-20. 7 sera refuse.
    - Ce script n'edite pas timer.config.json.
#>


param(
  [int]$NbJoueurs = 5,
  [int]$Port = 3000,
  [int]$ScreenIndex = 0,
  [switch]$AutoCreate,
  [switch]$NoServer,
  [int]$FirstX = 0,
  [int]$FirstY = 0
)

$ErrorActionPreference = 'Stop'
if ($NbJoueurs -lt 1) { throw "-NbJoueurs doit être >= 1" }

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "[INFO] Repo path: $repoRoot"

# --- Logging setup -----------------------------------------------------------
$logsRoot = Join-Path $repoRoot 'logs'
if (-not (Test-Path $logsRoot)) { New-Item -ItemType Directory -Path $logsRoot | Out-Null }
$clientLogsRoot = Join-Path $logsRoot 'clients'
if (-not (Test-Path $clientLogsRoot)) { New-Item -ItemType Directory -Path $clientLogsRoot | Out-Null }
$launchStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$centralLog = Join-Path $clientLogsRoot "flutter-clients-$launchStamp.log"
New-Item -ItemType File -Path $centralLog -Force | Out-Null
Write-Host "[INFO] Central client log: $centralLog"
$script:LogJobs = @()

# --- Ctrl+C handler ---------------------------------------------------------
try { Unregister-Event -SourceIdentifier 'LG_CtrlC' -ErrorAction SilentlyContinue } catch { }
$serverTitle = "LG_SERVER_$Port"
$env:LG_SERVER_TITLE = $serverTitle
$env:LG_SERVER_PORT = "$Port"
if ($NoServer) { $env:LG_SKIP_SERVER = '1' } else { Remove-Item Env:LG_SKIP_SERVER -ErrorAction SilentlyContinue }
try {
  Register-ObjectEvent -InputObject ([console]) -EventName CancelKeyPress -SourceIdentifier 'LG_CtrlC' -Action {
    param($sender, $eventArgs)
    $skipServer = $env:LG_SKIP_SERVER -eq '1'
    try { if ($eventArgs) { $eventArgs.Cancel = $true } } catch { }
    try {
      $title = $env:LG_SERVER_TITLE
      if (-not $skipServer -and $title) {
        Get-Process -Name cmd -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowTitle -eq $title } |
          ForEach-Object { & taskkill /PID $_.Id /T /F 2>$null | Out-Null }
      }
    } catch { }
    try {
      $p = $env:LG_SERVER_PORT
      if (-not $skipServer -and $p) {
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
      if (-not $skipServer) {
        Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
          Where-Object { $_.CommandLine -match 'start_server\.cmd' } |
          ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }
      }
    } catch { }
    try {
      Get-Process -Name 'loup_garou_client' -ErrorAction SilentlyContinue |
        ForEach-Object { & taskkill /PID $_.Id /T /F 2>$null | Out-Null }
    } catch { }
    try {
      Get-Job -Name 'LG_LOG_*' -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Job -Job $_ -Force -ErrorAction SilentlyContinue
        Remove-Job -Job $_ -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  } | Out-Null
  Write-Host "[INFO] Ctrl+C handler registered (will close server/clients)."
} catch { }

# --- Cleanup ---------------------------------------------------------------
function Stop-ProcessTree { param([int]$Pid) if ($Pid) { try { & taskkill /PID $Pid /T /F 2>$null | Out-Null } catch { } } }

if ($NoServer) {
  Write-Host "[INFO] Cleaning up previous client instances..."
} else {
  Write-Host "[INFO] Cleaning up previous instances (server + clients)..."
  try {
    $srvCmds = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match 'start_server\.cmd' }
    foreach ($c in $srvCmds) { Stop-ProcessTree -Pid $c.ProcessId }
    $srvByTitle = Get-Process -Name cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'LG_SERVER_*' }
    foreach ($p in $srvByTitle) { Stop-ProcessTree -Pid $p.Id }
  } catch { }
}
try { Get-Process -Name 'loup_garou_client' -ErrorAction SilentlyContinue | ForEach-Object { Stop-ProcessTree -Pid $_.Id } } catch { }
Start-Sleep -Milliseconds 400

# --- Start server (optional) -----------------------------------------------
if ($NoServer) {
  Write-Host "[INFO] -NoServer flag detected: skipping server launch."
  $script:serverProc = $null
} else {
  $serverCmd = Join-Path $repoRoot 'start_server.cmd'
  if (-not (Test-Path $serverCmd)) { throw "start_server.cmd not found at $serverCmd" }
  Write-Host "[INFO] Launching server (port $Port) in a new window..."
  $serverTitle = "LG_SERVER_$Port"
  $cmdInner = 'title {0} & "{1}" {2}' -f $serverTitle, $serverCmd, $Port
  $script:serverProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $cmdInner) -WorkingDirectory $repoRoot -WindowStyle Normal -PassThru
}

# --- Flutter build (Windows) -----------------------------------------------
if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) { throw 'Flutter not found in PATH. Install Flutter and retry.' }
try { & flutter config --enable-windows-desktop | Out-Null } catch { }
$logDir = Join-Path $repoRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory | Out-Null }
$pubLog = Join-Path $logDir 'flutter_pub_get.log'
$pubErrLog = Join-Path $logDir 'flutter_pub_get.err.log'
$pubProc = Start-Process -FilePath 'flutter' -ArgumentList @('pub','get') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $pubLog -RedirectStandardError $pubErrLog -PassThru
while (-not $pubProc.HasExited) { Start-Sleep -Milliseconds 250 }
$pubExit = $pubProc.ExitCode
if ($null -eq $pubExit) {
  try { $ok = Select-String -Path $pubLog -SimpleMatch 'Got dependencies!' -Quiet; if ($ok) { $pubExit = 0 } else { $pubExit = 1 } } catch { $pubExit = 1 }
}
if ($pubExit -ne 0) {
  Write-Host "[ERROR] flutter pub get failed. Showing last lines:" -ForegroundColor Red
  try { Get-Content -Path $pubLog -Tail 80 | ForEach-Object { Write-Host $_ } } catch { }
  try { Get-Content -Path $pubErrLog -Tail 80 | ForEach-Object { Write-Host $_ } } catch { }
  throw "flutter pub get failed (see $pubLog / $pubErrLog)"
}

$buildArgs = @('build','windows','--release','-v')
$buildLog = Join-Path $logDir 'flutter_build_windows.log'
$buildErrLog = Join-Path $logDir 'flutter_build_windows.err.log'
$buildProc = Start-Process -FilePath 'flutter' -ArgumentList $buildArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $buildLog -RedirectStandardError $buildErrLog -PassThru

Write-Host "[INFO] Waiting for Windows build to finish (pid $($buildProc.Id))..."
while (-not $buildProc.HasExited) { Start-Sleep -Milliseconds 500 }
$buildExit = $buildProc.ExitCode
if ($null -eq $buildExit) {
  try {
    $candidate = Join-Path $repoRoot 'build\windows\x64\runner\Release\loup_garou_client.exe'
    if (Test-Path $candidate) { $buildExit = 0 } else { $buildExit = 1 }
  } catch { $buildExit = 1 }
}
if ($buildExit -ne 0) {
  Write-Host "[ERROR] Flutter build failed. Showing last lines:" -ForegroundColor Red
  try { Get-Content -Path $buildLog -Tail 80 | ForEach-Object { Write-Host $_ } } catch { }
  try { Get-Content -Path $buildErrLog -Tail 80 | ForEach-Object { Write-Host $_ } } catch { }
  throw "Flutter build failed (see $buildLog / $buildErrLog)"
}

# --- Resolve exe path -------------------------------------------------------
$candidate = Join-Path $repoRoot 'build\windows\x64\runner\Release\loup_garou_client.exe'
if (-not (Test-Path $candidate)) {
  $exe = Get-ChildItem -Path (Join-Path $repoRoot 'build\windows') -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\runner\\(Release|Debug)\\' } |
    Select-Object -First 1
  if (-not $exe) { throw 'Windows executable not found after build.' }
  $exePath = $exe.FullName
} else { $exePath = $candidate }
Write-Host "[INFO] Client executable: $exePath"

# --- Window tiling helpers --------------------------------------------------
if (-not ([System.Management.Automation.PSTypeName] 'Native.Win32').Type) {
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; namespace Native { public static class Win32 { [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); } }
'@
}
if (-not ([System.Management.Automation.PSTypeName] 'Native2.Win32Ex').Type) {
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; namespace Native2 { public static class Win32Ex { [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags); } }
'@
}
if (-not ([System.Management.Automation.PSTypeName] 'NativePlacements.Win32Place').Type) {
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; namespace NativePlacements { [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; } [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT { public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition; } public static class Win32Place { [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl); } }
'@
}

Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
if ($screens.Length -eq 0) { throw 'No screens detected.' }
$target = if ($ScreenIndex -ge 0 -and $ScreenIndex -lt $screens.Length) { $screens[$ScreenIndex] } else { [System.Windows.Forms.Screen]::PrimaryScreen }
$wa = $target.WorkingArea
Write-Host "[INFO] Using screen index $([array]::IndexOf($screens, $target)) ($($target.DeviceName)) area: X=$($wa.X) Y=$($wa.Y) W=$($wa.Width) H=$($wa.Height)"

# Conserve une taille fixe (300x600) pour aligner le comportement sur build_and_run_5.ps1.
$tileW = 300
$tileH = 600
$cols = [math]::Max(1, [math]::Floor($wa.Width / $tileW))
if ($cols -gt $NbJoueurs) { $cols = $NbJoueurs }
if ($cols -lt 1) { $cols = 1 }
$rows = [math]::Ceiling($NbJoueurs / $cols)

$maxRelX = [int]([math]::Max(0, $wa.Width - ($tileW * $cols)))
$maxRelY = [int]([math]::Max(0, $wa.Height - ($tileH * $rows)))
$baseRelX = [int]([math]::Max(0, [math]::Min($maxRelX, $FirstX)))
$baseRelY = [int]([math]::Max(0, [math]::Min($maxRelY, $FirstY)))
$baseX = $wa.X + $baseRelX; $baseY = $wa.Y + $baseRelY

function Set-WindowBounds { param([System.Diagnostics.Process]$Process,[int]$X,[int]$Y,[int]$W,[int]$H)
  if (-not $Process) { return } try { $null = $Process.WaitForInputIdle(1500) } catch { }
  for ($i=0; $i -lt 60; $i++) { $Process.Refresh(); $h=$Process.MainWindowHandle; if ($h -ne [IntPtr]::Zero) {
      [Native.Win32]::ShowWindow($h, 9) | Out-Null
      try { $wp = New-Object 'NativePlacements.WINDOWPLACEMENT'; $wp.length=[System.Runtime.InteropServices.Marshal]::SizeOf([type]'NativePlacements.WINDOWPLACEMENT'); $wp.showCmd=1; $rect=New-Object 'NativePlacements.RECT'; $rect.Left=$X; $rect.Top=$Y; $rect.Right=$X+$W; $rect.Bottom=$Y+$H; $wp.rcNormalPosition=$rect; [NativePlacements.Win32Place]::SetWindowPlacement($h, [ref]$wp) | Out-Null } catch {}
      $SWP_NOZORDER=0x0004; $SWP_NOOWNERZORDER=0x0200; $SWP_FRAMECHANGED=0x0020
      for ($j=0; $j -lt 12; $j++) { if ($j -gt 0) { Start-Sleep -Milliseconds 150 }
        if (([System.Management.Automation.PSTypeName] 'Native2.Win32Ex').Type) { [Native2.Win32Ex]::SetWindowPos($h,[IntPtr]::Zero,$X,$Y,$W,$H,($SWP_NOZORDER -bor $SWP_NOOWNERZORDER -bor $SWP_FRAMECHANGED)) | Out-Null } else { [Native.Win32]::MoveWindow($h,$X,$Y,$W,$H,$true) | Out-Null }
      }
      return; }
    Start-Sleep -Milliseconds 100 }
}

function Start-ClientLogCollector {
  param([string]$LogPath,[string]$Nick)
  $safeNick = ($Nick -replace '[^a-zA-Z0-9_]', '_')
  if ([string]::IsNullOrWhiteSpace($safeNick)) { $safeNick = 'client' }
  $jobName = "LG_LOG_${safeNick}_$([guid]::NewGuid().ToString('N'))"
  $job = Start-Job -Name $jobName -ArgumentList $LogPath, $Nick, $centralLog -ScriptBlock {
    param($src, $nick, $dest)
    try {
      while (-not (Test-Path $src)) { Start-Sleep -Milliseconds 200 }
      Get-Content -Path $src -Wait | ForEach-Object {
        $line = $_
        $ts = [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')
        $formatted = "{0} [{1}] {2}" -f $ts, $nick, $line
        Add-Content -Path $dest -Value $formatted -Encoding UTF8
      }
    } catch {
      $ts = [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')
      $errMsg = $_.Exception.Message
      Add-Content -Path $dest -Value "$ts [LOGGER] collector failed for $($nick): $errMsg" -Encoding UTF8
    }
  }
  if ($script:LogJobs -eq $null) { $script:LogJobs = @() }
  $script:LogJobs += $job
}

function Spawn-Client {
  param([string]$Nick,[bool]$AutoCreate,[int]$AutoMaxPlayers,[bool]$AutoJoin,[int]$X,[int]$Y,[int]$W,[int]$H)

  $safeNick = ($Nick -replace '[^a-zA-Z0-9_-]', '_')
  if ([string]::IsNullOrWhiteSpace($safeNick)) { $safeNick = 'client' }

  $clientLogPath = Join-Path $clientLogsRoot ("flutter-client-{0}-{1}.log" -f $launchStamp, $safeNick)
  try { Remove-Item $clientLogPath -ErrorAction SilentlyContinue } catch { }
  New-Item -ItemType File -Path $clientLogPath -Force | Out-Null
  $env:LG_CLIENT_LOG_FILE = $clientLogPath

  $env:WINDOW_W = "$W"; $env:WINDOW_H = "$H"; $env:WINDOW_X = "$X"; $env:WINDOW_Y = "$Y"
  $env:_paramNick = $Nick

  # Pass arguments as separate tokens to avoid quoting issues with spaces
  [string[]]$arguments = @('--paramNick', $Nick)
  if ($AutoCreate) {
    $arguments += @('--autoCreate', '--autoJoin')
    if ($AutoMaxPlayers -gt 0) {
      $arguments += @('--autoMaxPlayers', "$AutoMaxPlayers")
    }
  } elseif ($AutoJoin) {
    $arguments += '--autoJoin'
  }

  $process = $null
  try {
    $process = Start-Process -FilePath $exePath -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $exePath) -WindowStyle Normal -PassThru
  } finally {
    Remove-Item Env:_paramNick -ErrorAction SilentlyContinue
    Remove-Item Env:LG_CLIENT_LOG_FILE -ErrorAction SilentlyContinue
  }
  Start-ClientLogCollector -LogPath $clientLogPath -Nick $Nick
  return $process
}

# Warn si nb joueurs 7 (non supporté par le serveur avec les setups actuels)
if ($NbJoueurs -eq 7 -and $AutoCreate) {
  Write-Warning "7 joueurs ne sont pas supportes par la configuration serveur actuelle (setups manquants). La creation auto echouera."
}

$positions = @()
for ($i = 0; $i -lt $NbJoueurs; $i++) {
  $r = [math]::Floor($i / $cols)
  $c = $i % $cols
  $positions += @{ X = $baseX + ($tileW * $c); Y = $baseY + ($tileH * $r) }
}

$procs = @()
# 1er client
$procs += Spawn-Client -Nick 'Fabrice 1' -AutoCreate $AutoCreate -AutoMaxPlayers $NbJoueurs -AutoJoin $AutoCreate -X $positions[0].X -Y $positions[0].Y -W $tileW -H $tileH

# Autres clients
for ($i = 1; $i -lt $NbJoueurs; $i++) {
  $nick = ('Fabrice {0}' -f ($i + 1))
  $procs += Spawn-Client -Nick $nick -AutoCreate $false -AutoMaxPlayers 0 -AutoJoin $AutoCreate -X $positions[$i].X -Y $positions[$i].Y -W $tileW -H $tileH
}

for ($i=0; $i -lt $procs.Count; $i++) { Set-WindowBounds -Process $procs[$i] -X $positions[$i].X -Y $positions[$i].Y -W $tileW -H $tileH }

if ($NoServer) {
  Write-Host ("[OK] {0} clients launched (server skipped)." -f $NbJoueurs)
  Write-Host "[INFO] Press Ctrl+C in this console to stop clients."
} else {
  Write-Host ("[OK] Server and {0} clients launched." -f $NbJoueurs)
  Write-Host "[INFO] Press Ctrl+C in this console to stop server and clients (or close the server window)."
}
if ($script:serverProc) { try { Wait-Process -Id $script:serverProc.Id } catch { } } else { try { Wait-Event -SourceIdentifier 'LG_CtrlC' } catch { while ($true) { Start-Sleep -Seconds 60 } } }
try {
  Get-Job -Name 'LG_LOG_*' -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Job -Job $_ -Force -ErrorAction SilentlyContinue
    Remove-Job -Job $_ -Force -ErrorAction SilentlyContinue
  }
} catch { }
