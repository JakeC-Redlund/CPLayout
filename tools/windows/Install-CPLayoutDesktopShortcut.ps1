param(
  [switch]$WithStopShortcut
)

$ErrorActionPreference = "Stop"

$RepoWindowsPath = "\\wsl.localhost\Ubuntu\mnt\h\cplayout"
if (-not (Test-Path $RepoWindowsPath)) {
  $RepoWindowsPath = "\\wsl$\Ubuntu\mnt\h\cplayout"
}
if (-not (Test-Path $RepoWindowsPath)) {
  throw "Could not find the CPLayout checkout through the default WSL UNC paths."
}

$Desktop = [Environment]::GetFolderPath("Desktop")
$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$WshShell = New-Object -ComObject WScript.Shell

$LaunchScript = Join-Path $RepoWindowsPath "tools\windows\Launch-CPLayoutWeb.ps1"
$LaunchShortcut = $WshShell.CreateShortcut((Join-Path $Desktop "CPLayout Web Test.lnk"))
$LaunchShortcut.TargetPath = $PowerShell
$LaunchShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LaunchScript`""
$LaunchShortcut.WorkingDirectory = Split-Path $LaunchScript
$LaunchShortcut.Description = "Start the CPLayout static web test server through WSL."
$LaunchShortcut.Save()
Write-Host "Created $($LaunchShortcut.FullName)"

if ($WithStopShortcut) {
  $StopScript = Join-Path $RepoWindowsPath "tools\windows\Stop-CPLayoutWeb.ps1"
  $StopShortcut = $WshShell.CreateShortcut((Join-Path $Desktop "Stop CPLayout Web Test.lnk"))
  $StopShortcut.TargetPath = $PowerShell
  $StopShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StopScript`""
  $StopShortcut.WorkingDirectory = Split-Path $StopScript
  $StopShortcut.Description = "Stop launcher-owned CPLayout static web test servers."
  $StopShortcut.Save()
  Write-Host "Created $($StopShortcut.FullName)"
}
