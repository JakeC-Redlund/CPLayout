param(
  [string]$Distro = 'Ubuntu-24.04',
  [string]$GoogleEarthPath = "C:\Program Files\Google\Google Earth Pro\client\googleearth.exe",
  [string]$OutputDir = "apps\mobile\src\assets\google-earth-wizard",
  [int]$StartupSeconds = 10,
  [switch]$LeaveGoogleEarthOpen,
  [int]$CleanupTimeoutSeconds = 10,
  [switch]$DisableForceCleanup
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'windows/CPLayoutPaths.ps1')
. (Join-Path $PSScriptRoot 'windows/GoogleEarthIdentity.ps1')

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class WindowApi {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out Rect lpRect);

  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
"@
Add-Type -TypeDefinition $signature

function Convert-ToWindowsPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
  if ($resolved) { $Path = $resolved.Path }
  if ($Path.StartsWith('/') -or $Path -match '^[A-Za-z]:' -or $Path.StartsWith('\\')) { return ConvertTo-CPLayoutWindowsPath $Path $Distro }
  return $Path
}

function Get-GoogleEarthProcess([string]$Path) {
  $script:GoogleEarthAcquisitionAttempted = $true
  $processes = @(Get-Process -Name 'googleearth' -ErrorAction SilentlyContinue)
  $process = Select-CPLayoutGoogleEarthProcess $processes $Path
  if ($script:GoogleEarthTargetIdentity) {
    if (-not $process) { throw 'The selected Google Earth process exited during capture.' }
    $actual = Get-CPLayoutGoogleEarthIdentity $process
    Assert-CPLayoutGoogleEarthIdentity $actual $script:GoogleEarthTargetIdentity.id $script:GoogleEarthTargetIdentity.startTime $script:GoogleEarthTargetIdentity.path
    return $process
  }
  $ownership = 'reused_matching_executable'
  if (-not $process) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Google Earth Pro was not found at $Path" }
    $process = Start-Process -FilePath $Path -PassThru
    $ownership = 'created_by_capture'
    Start-Sleep -Seconds $StartupSeconds
  }
  $script:GoogleEarthTargetIdentity = Get-CPLayoutGoogleEarthIdentity $process
  $script:GoogleEarthTargetOwnership = $ownership
  return $process
}

function Wait-ForMainWindow($Process) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
      return $Process.MainWindowHandle
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Google Earth Pro did not expose a main window handle."
}

function Capture-Window([IntPtr]$Handle, [string]$Path, [System.Drawing.Rectangle]$Crop) {
  [WindowApi]::ShowWindow($Handle, 3) | Out-Null
  [WindowApi]::SetForegroundWindow($Handle) | Out-Null
  Start-Sleep -Milliseconds 750

  $rect = New-Object WindowApi+Rect
  if (-not [WindowApi]::GetWindowRect($Handle, [ref]$rect)) {
    throw "Could not read Google Earth Pro window bounds."
  }
  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $captureRect = New-Object System.Drawing.Rectangle 0, 0, $width, $height
  if ($Crop.Width -gt 0 -and $Crop.Height -gt 0) {
    $captureRect = [System.Drawing.Rectangle]::Intersect($captureRect, $Crop)
    if ($captureRect.Width -le 0 -or $captureRect.Height -le 0) {
      throw "Requested crop falls outside the Google Earth Pro window bounds."
    }
  }

  $bitmap = New-Object System.Drawing.Bitmap $captureRect.Width, $captureRect.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left + $captureRect.X, $rect.Top + $captureRect.Y, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Invoke-GoogleEarthCleanup([string]$RepoRoot, [string]$OutputPath, [int]$TargetProcessId) {
  if ($LeaveGoogleEarthOpen) {
    return [pscustomobject]@{
      requested = $true
      leaveOpen = $true
      targetProcessId = $TargetProcessId
      preflightProcessPresent = [bool]$TargetProcessId
      postflightProcessRemaining = $false
      cleanupRequired = $false
      contaminated = $false
      failureReason = $null
      closeMethod = "none"
      modalHandled = $false
      forceUsed = $false
      status = "skipped_leave_open"
      error = $null
      recordPath = $null
    }
  }

  $recordPath = Join-Path $OutputPath "google-earth-cleanup.json"
  $cleanupScript = Join-Path (Join-Path $RepoRoot "tools") "cleanup_google_earth.ps1"
  try {
    $cleanupArgs = @{
      TargetProcessId = $TargetProcessId
      TargetProcessStartTime = $script:GoogleEarthTargetIdentity.startTime
      Distro = $Distro
      GoogleEarthPath = $GoogleEarthPath
      OutputRecordPath = $recordPath
      CleanupTimeoutSeconds = $CleanupTimeoutSeconds
      Strict = $true
    }
    if ($DisableForceCleanup) {
      $cleanupArgs.DisableForceCleanup = $true
    }
    $cleanupJson = & $cleanupScript @cleanupArgs
    $cleanup = $cleanupJson | ConvertFrom-Json
    return [pscustomobject]@{
      requested = $true
      leaveOpen = $false
      targetProcessId = $cleanup.targetProcessId
      preflightProcessPresent = [bool]$cleanup.preflightProcessPresent
      postflightProcessRemaining = [bool]$cleanup.postflightProcessRemaining
      cleanupRequired = [bool]$cleanup.cleanupRequired
      contaminated = [bool]$cleanup.contaminated
      failureReason = $cleanup.failureReason
      closeMethod = $cleanup.closeMethod
      modalHandled = [bool]$cleanup.modalHandled
      forceUsed = [bool]$cleanup.forceUsed
      status = $cleanup.status
      error = $cleanup.error
      recordPath = $recordPath
    }
  } catch {
    return [pscustomobject]@{
      requested = $true
      leaveOpen = $false
      targetProcessId = $TargetProcessId
      preflightProcessPresent = [bool]$TargetProcessId
      postflightProcessRemaining = $true
      cleanupRequired = [bool]$TargetProcessId
      contaminated = $true
      failureReason = $_.Exception.Message
      closeMethod = "none"
      modalHandled = $false
      forceUsed = $false
      status = "blocked"
      error = $_.Exception.Message
      recordPath = $null
    }
  }
}

$script:GoogleEarthTargetIdentity = $null
$script:GoogleEarthAcquisitionAttempted = $false
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Convert-ToWindowsPath (Join-Path $repoRoot $OutputDir)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$process = $null
$captureManifest = @()
$captureFailure = $null
try {
$process = Get-GoogleEarthProcess -Path $GoogleEarthPath
$handle = Wait-ForMainWindow -Process $process

$captures = @(
  @{
    filename = "google-earth-pro-main-window.png"
    label = "Google Earth Pro main window for CPLayout import tutorial"
    crop = New-Object System.Drawing.Rectangle 0, 0, 0, 0
    keys = $null
  },
  @{
    filename = "google-earth-pro-add-menu.png"
    label = "Google Earth Pro Add menu for path, polygon, and placemark drawing"
    crop = New-Object System.Drawing.Rectangle 0, 0, 760, 220
    keys = "%a"
  }
)

$captureManifest = foreach ($capture in $captures) {
  if ($capture.keys) {
    [WindowApi]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait($capture.keys)
    Start-Sleep -Milliseconds 750
  }
  $path = Join-Path $outputPath $capture.filename
  Capture-Window -Handle $handle -Path $path -Crop $capture.crop
  $image = [System.Drawing.Image]::FromFile($path)
  try {
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $path
    [pscustomobject]@{
      filename = $capture.filename
      label = $capture.label
      width = $image.Width
      height = $image.Height
      sha256 = $hash.Hash.ToLowerInvariant()
      capturedAt = (Get-Date).ToUniversalTime().ToString("o")
      source = $GoogleEarthPath
    }
  } finally {
    $image.Dispose()
  }
}

} catch {
  $captureFailure = $_
} finally {
  $cleanup = Invoke-GoogleEarthCleanup -RepoRoot $repoRoot -OutputPath $outputPath -TargetProcessId $process.Id
}
$processPath = $null
$processResponding = $null
$processStartTime = $null
try {
  $processPath = $process.Path
} catch {
}
try {
  $processResponding = $process.Responding
} catch {
}
try {
  $processStartTime = $process.StartTime.ToUniversalTime().ToString("o")
} catch {
}

$manifest = [pscustomobject]@{
  schemaVersion = "cplayout-google-earth-import-wizard-capture-v2"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  captures = $captureManifest
  googleEarth = [pscustomobject]@{
    requestedPath = $GoogleEarthPath
    process = [pscustomobject]@{
      id = $process.Id
      processName = $process.ProcessName
      mainWindowTitle = $process.MainWindowTitle
      path = $processPath
      responding = $processResponding
      startTime = $processStartTime
    }
    cleanup = $cleanup
  }
}

$manifestPath = Join-Path $outputPath "manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "Wrote Google Earth wizard screenshot manifest: $manifestPath"

if ($cleanup.contaminated -or $cleanup.status -eq "blocked" -or $cleanup.postflightProcessRemaining) {
  throw "Google Earth cleanup failed or left a targeted process running. Cleanup status: $($cleanup.status)"
}

if ($captureFailure) { throw $captureFailure }
