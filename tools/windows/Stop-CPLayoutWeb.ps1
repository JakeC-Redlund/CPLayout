param(
  [Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port,
  [string]$Distro = 'Ubuntu-24.04',
  [string]$RepoPath = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CPLayoutPaths.ps1')
if (-not $RepoPath) { $RepoPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
$RepoPath = ConvertTo-CPLayoutWslPath $RepoPath $Distro
Write-Host "Stopping the selected launcher-owned CPLayout UI server on port $Port..."
# The manager independently checks PID, start identity, cwd and command before
# signalling, then requires process exit and listener release.
'exec npm run ui:test:stop -- --mode ui-test --port "$1" # CRLF-safe' | & wsl.exe -d $Distro --cd $RepoPath -- bash -l -s -- ([string]$Port)
if ($LASTEXITCODE -ne 0) { throw 'CPLayout stop failed; ownership metadata was retained.' }
