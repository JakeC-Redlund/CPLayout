param(
  [string]$Distro = 'Ubuntu-24.04',
  [string]$ProjectId = "public-adams-county-center-pivot-proof",
  [string]$ProjectCrs = "EPSG:32613",
  [string]$ProjectReferencePath = "",
  [string]$GoogleEarthPath = "C:\Program Files\Google\Google Earth Pro\client\googleearth.exe",
  [string]$OutputRoot = "reports\google-earth-visual-fidelity",
  [string]$RunId = "",
  [string]$InputArtifactPath = "",
  [string]$KmlPath = "",
  [string]$KmzPath = "",
  [string]$OperatorBoundaryKmlPath = "",
  [string]$OperatorBoundaryName = "USER DRAWN FIELD BOUNDARY",
  [ValidateSet("kmz", "kml")]
  [string]$OpenArtifact = "kmz",
  [int]$StartupSeconds = 10,
  [int]$RenderSeconds = 18,
  [switch]$InferFieldBoundary,
  [switch]$ConfirmOverlayVisible,
  [switch]$RequireProofPass,
  [switch]$LeaveGoogleEarthOpen,
  [int]$CleanupTimeoutSeconds = 10,
  [switch]$DisableForceCleanup
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'windows/CPLayoutPaths.ps1')
. (Join-Path $PSScriptRoot 'windows/GoogleEarthIdentity.ps1')

function Convert-ToWindowsPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
  if ($resolved) { $Path = $resolved.Path }
  if ($Path.StartsWith('/') -or $Path -match '^[A-Za-z]:' -or $Path.StartsWith('\\')) { return ConvertTo-CPLayoutWindowsPath $Path $Distro }
  return $Path
}

function Convert-ToWslPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
  if ($Path.StartsWith('/') -or $Path -match '^[A-Za-z]:' -or $Path.StartsWith('\\')) { return ConvertTo-CPLayoutWslPath $Path $Distro }
  return $Path
}

function Quote-BashPath([string]$Path) {
  return "'" + ($Path -replace "'", "'\''") + "'"
}

function Resolve-LoopPath([string]$Path, [string]$RepoRoot) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }
  $candidate = if ($IsLinux) { $Path } else { Convert-ToWindowsPath $Path }
  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    $candidate = Join-Path $RepoRoot $candidate
  }
  return (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
}

function Find-CapturePath($Manifest, [string]$OutputPath, [string]$Filename) {
  $capture = @($Manifest.captures | Where-Object { $_.filename -eq $Filename } | Select-Object -First 1)
  if (-not $capture) {
    throw "Visual-fidelity manifest does not include $Filename."
  }
  $path = Join-Path $OutputPath $capture.filename
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Expected capture is missing: $path"
  }
  return $path
}

function Invoke-PythonVisionReview([string]$RepoRoot, [string[]]$Arguments) {
  $pythonModuleRoot = Join-Path $RepoRoot "tools/local-ml-companion/src"
  $python = Get-Command python3 -ErrorAction SilentlyContinue
  if ($python) {
    Push-Location $RepoRoot
    $previousPythonPath = $env:PYTHONPATH
    try {
      $env:PYTHONPATH = if ([string]::IsNullOrWhiteSpace($previousPythonPath)) {
        $pythonModuleRoot
      } else {
        "$pythonModuleRoot$([System.IO.Path]::PathSeparator)$previousPythonPath"
      }
      & $python.Source -m cplayout_ml.cli @Arguments
      if ($LASTEXITCODE -ne 0) {
        throw "Python vision review failed with exit code $LASTEXITCODE."
      }
    } finally {
      if ($null -eq $previousPythonPath) {
        Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
      } else {
        $env:PYTHONPATH = $previousPythonPath
      }
      Pop-Location
    }
    return
  }

  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wsl) {
    throw "python3 was not found, and wsl.exe is unavailable for the local ML companion."
  }
  $wslArguments = @($Arguments | ForEach-Object { Convert-ToWslPath $_ })
  'exec env PYTHONPATH="$1" python3 -m cplayout_ml.cli "${@:2}" # CRLF-safe' |
    & wsl.exe -d $Distro --cd (Convert-ToWslPath $RepoRoot) -- bash -l -s -- (Convert-ToWslPath $pythonModuleRoot) @wslArguments
  if ($LASTEXITCODE -ne 0) {
    throw "WSL Python vision review failed with exit code $LASTEXITCODE."
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($RunId)) {
  $RunId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
}

$runOutputRelative = Join-Path $OutputRoot $RunId
$runOutputPath = Join-Path $repoRoot $runOutputRelative
if (-not $IsLinux) {
  $runOutputPath = Convert-ToWindowsPath $runOutputPath
}
New-Item -ItemType Directory -Force -Path $runOutputPath | Out-Null

$captureScript = Join-Path $PSScriptRoot "capture_google_earth_visual_fidelity.ps1"
$captureArgs = @{
  GoogleEarthPath = $GoogleEarthPath
  OutputDir = $runOutputRelative
  OpenArtifact = $OpenArtifact
  StartupSeconds = $StartupSeconds
  RenderSeconds = $RenderSeconds
}
if (-not [string]::IsNullOrWhiteSpace($InputArtifactPath)) {
  $captureArgs.InputArtifactPath = $InputArtifactPath
}
if ($ConfirmOverlayVisible) {
  $captureArgs.ConfirmOverlayVisible = $true
}
if ($RequireProofPass) {
  $captureArgs.RequireProofPass = $true
}
if ($LeaveGoogleEarthOpen) {
  $captureArgs.LeaveGoogleEarthOpen = $true
}
if ($DisableForceCleanup) {
  $captureArgs.DisableForceCleanup = $true
}
$captureArgs.CleanupTimeoutSeconds = $CleanupTimeoutSeconds
$captureArgs.Distro = $Distro

$manifestPath = Join-Path $runOutputPath "visual-fidelity-manifest.json"
$captureFailed = $false
$captureFailureMessage = $null
try {
  & $captureScript @captureArgs
  if (-not $?) {
    $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { "unknown" }
    throw "Google Earth visual-fidelity capture failed with exit code $exitCode."
  }
} catch {
  $captureFailed = $true
  $captureFailureMessage = $_.Exception.Message
}

if ($captureFailed -and -not (Test-Path -LiteralPath $manifestPath)) {
  throw $captureFailureMessage
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$contaminatedGoogleEarthWorkspace = [bool]($manifest.googleEarth.contaminatedWorkspace -or $manifest.googleEarth.cleanup.contaminated -or $manifest.googleEarth.cleanup.postflightProcessRemaining -or $manifest.googleEarth.cleanup.status -eq "blocked")
if ($captureFailed -and $contaminatedGoogleEarthWorkspace) {
  $summary = [pscustomobject]@{
    schemaVersion = "cplayout-google-earth-design-loop-v1"
    runId = $RunId
    projectId = $ProjectId
    projectCrs = $ProjectCrs
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    outputDir = $runOutputRelative
    visualFidelityManifest = $manifestPath
    designVisionReview = $null
    designVisionRecommendations = $null
    proofPassed = $manifest.proofPassed
    googleEarthCleanup = $manifest.googleEarth.cleanup
    googleEarthLeftOpen = [bool]($manifest.googleEarth.cleanup.status -eq "skipped_leave_open")
    contaminatedGoogleEarthWorkspace = $true
    canonicalGeometryMutation = $false
    reviewGate = "Blocked before CV review because Google Earth cleanup failed. Visual proof success does not override cleanup failure."
  }
  $summaryPath = Join-Path $runOutputPath "design-loop-summary.json"
  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  Write-Host "Wrote Google Earth design-loop summary: $summaryPath"
  throw $captureFailureMessage
}
if ($captureFailed) {
  throw $captureFailureMessage
}
if ($RequireProofPass -and -not $manifest.proofPassed) {
  throw "Google Earth visual-fidelity proof did not pass. Manifest status: $($manifest.status)"
}

$resolvedKmlPath = Resolve-LoopPath -Path $KmlPath -RepoRoot $repoRoot
$resolvedKmzPath = Resolve-LoopPath -Path $KmzPath -RepoRoot $repoRoot
if ([string]::IsNullOrWhiteSpace($resolvedKmlPath)) {
  if (-not $manifest.artifacts.kml) {
    throw "No KML path was supplied, and the capture manifest did not generate one."
  }
  $resolvedKmlPath = Resolve-LoopPath -Path $manifest.artifacts.kml -RepoRoot $repoRoot
}
if ([string]::IsNullOrWhiteSpace($resolvedKmzPath)) {
  if (-not $manifest.artifacts.kmz) {
    throw "No KMZ path was supplied, and the capture manifest did not generate one."
  }
  $resolvedKmzPath = Resolve-LoopPath -Path $manifest.artifacts.kmz -RepoRoot $repoRoot
}

$fullWindowPath = Find-CapturePath -Manifest $manifest -OutputPath $runOutputPath -Filename "google-earth-visual-fidelity-full-window.png"
$mapCanvasPath = Find-CapturePath -Manifest $manifest -OutputPath $runOutputPath -Filename "google-earth-visual-fidelity-map-canvas.png"
$reviewOutputPath = Join-Path $runOutputPath "design-vision-review"
New-Item -ItemType Directory -Force -Path $reviewOutputPath | Out-Null

$visionArgs = @(
  "design-vision-review",
  "--kml", $resolvedKmlPath,
  "--kmz", $resolvedKmzPath,
  "--full-window", $fullWindowPath,
  "--map-canvas", $mapCanvasPath,
  "--manifest", $manifestPath,
  "--output-dir", $reviewOutputPath,
  "--project-id", $ProjectId,
  "--project-crs", $ProjectCrs,
  "--created-at", (Get-Date).ToUniversalTime().ToString("o")
)
if ($InferFieldBoundary) {
  $visionArgs += @("--infer-field-boundary")
}
$resolvedProjectReference = Resolve-LoopPath -Path $ProjectReferencePath -RepoRoot $repoRoot
if (-not [string]::IsNullOrWhiteSpace($resolvedProjectReference)) {
  $visionArgs += @("--project-reference", $resolvedProjectReference)
}
$resolvedOperatorBoundaryKmlPath = Resolve-LoopPath -Path $OperatorBoundaryKmlPath -RepoRoot $repoRoot
if (-not [string]::IsNullOrWhiteSpace($resolvedOperatorBoundaryKmlPath)) {
  $visionArgs += @("--operator-boundary-kml", $resolvedOperatorBoundaryKmlPath, "--operator-boundary-name", $OperatorBoundaryName)
}

Invoke-PythonVisionReview -RepoRoot $repoRoot -Arguments $visionArgs

$summary = [pscustomobject]@{
  schemaVersion = "cplayout-google-earth-design-loop-v1"
  runId = $RunId
  projectId = $ProjectId
  projectCrs = $ProjectCrs
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  outputDir = $runOutputRelative
  visualFidelityManifest = $manifestPath
  designVisionReview = Join-Path $reviewOutputPath "visual-layout-review.json"
  designVisionCandidates = Join-Path $reviewOutputPath "visual-layout-review-candidates.geojson"
  proofPassed = $manifest.proofPassed
  googleEarthCleanup = $manifest.googleEarth.cleanup
  googleEarthLeftOpen = [bool]($manifest.googleEarth.cleanup.status -eq "skipped_leave_open")
  contaminatedGoogleEarthWorkspace = $contaminatedGoogleEarthWorkspace
  canonicalGeometryMutation = $false
  geometryGate = "Companion candidate reports are standalone evidence; any geometry change must use explicit CPLayout Files import or Map editing."
}
$summaryPath = Join-Path $runOutputPath "design-loop-summary.json"
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
Write-Host "Wrote Google Earth design-loop summary: $summaryPath"
