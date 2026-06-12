$ErrorActionPreference = "Stop"

$RepoPath = "/mnt/h/cplayout"
Write-Host "Stopping launcher-owned CPLayout Web Test servers through WSL..."
& wsl.exe --cd $RepoPath bash -lc "cd $RepoPath && npm run ui:test:stop"
if ($LASTEXITCODE -ne 0) {
  throw "CPLayout Web Test stop command failed."
}
