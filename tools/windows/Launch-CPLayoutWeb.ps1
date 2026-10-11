param(
  [ValidateRange(0,65535)][int]$Port = 0,
  [switch]$ReuseExport,
  [switch]$NoOpen,
  [string]$Distro = 'Ubuntu-24.04',
  [string]$RepoPath = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CPLayoutPaths.ps1')
if (-not $RepoPath) { $RepoPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
$RepoPath = ConvertTo-CPLayoutWslPath $RepoPath $Distro
$LogDir = Join-Path $env:USERPROFILE 'CPLayoutLogs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogPath = Join-Path $LogDir ('cplayout-web-test-{0:yyyyMMdd-HHmmss}-{1}.log' -f (Get-Date), [Guid]::NewGuid().ToString('N'))
$launchArgs = @()
if ($Port -gt 0) { $launchArgs += @('--port', [string]$Port) }
if ($ReuseExport) { $launchArgs += '--reuse-export' }
Write-Host "Starting CPLayout through WSL distribution $Distro..."
Write-Host "Log: $LogPath"
# The shell program is fixed. Checkout paths and options are separate arguments.
$output = 'exec npm run ui:test:start -- --no-open "$@" # CRLF-safe' | & wsl.exe -d $Distro --cd $RepoPath -- bash -l -s -- @launchArgs 2>&1 | Tee-Object -FilePath $LogPath
if ($LASTEXITCODE -ne 0) { throw "CPLayout launch failed. See $LogPath" }
$url = ($output | Select-String -Pattern 'http://127\.0\.0\.1:\d+' -AllMatches |
  ForEach-Object { $_.Matches.Value } | Select-Object -Last 1)
if (-not $url) { throw "CPLayout did not report a URL. See $LogPath" }
Write-Host "CPLayout Web Test URL: $url"
Write-Host "Stop this selected server with Stop-CPLayoutWeb.ps1 -Port $(([Uri]$url).Port) -Distro $Distro"
if (-not $NoOpen) { Start-Process $url }
