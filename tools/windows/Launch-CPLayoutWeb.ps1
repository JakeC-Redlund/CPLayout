param(
  [int]$Port = 0,
  [switch]$ReuseExport,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$RepoPath = "/mnt/h/cplayout"
$LogDir = Join-Path $env:USERPROFILE "CPLayoutLogs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogPath = Join-Path $LogDir ("cplayout-web-test-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))

$args = @("npm run ui:test:start -- --no-open")
if ($Port -gt 0) {
  $args += "--port $Port"
}
if ($ReuseExport) {
  $args += "--reuse-export"
}

$bashCommand = "cd $RepoPath && CPLAYOUT_NO_OPEN=1 " + ($args -join " ")
Write-Host "Starting CPLayout Web Test through WSL..."
Write-Host "Log: $LogPath"

$output = & wsl.exe --cd $RepoPath bash -lc $bashCommand 2>&1 | Tee-Object -FilePath $LogPath
if ($LASTEXITCODE -ne 0) {
  throw "CPLayout Web Test launch failed. See $LogPath"
}

$url = ($output | Select-String -Pattern "http://127\.0\.0\.1:\d+" -AllMatches |
  ForEach-Object { $_.Matches.Value } |
  Select-Object -Last 1)

if (-not $url) {
  throw "CPLayout Web Test did not report a URL. See $LogPath"
}

Write-Host "CPLayout Web Test URL: $url"
if (-not $NoOpen) {
  Start-Process $url
}
