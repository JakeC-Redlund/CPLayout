param([switch]$WithStopShortcut, [string]$Distro = 'Ubuntu-24.04')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CPLayoutPaths.ps1')
$RepoWindowsPath = ConvertTo-CPLayoutWindowsPath (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) $Distro
if (-not (Test-Path -LiteralPath (Join-Path $RepoWindowsPath 'package.json'))) { throw 'Current CPLayout checkout is unavailable.' }
$Desktop = [Environment]::GetFolderPath('Desktop')
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$WshShell = New-Object -ComObject WScript.Shell
$LaunchScript = Join-Path $RepoWindowsPath 'tools\windows\Launch-CPLayoutWeb.ps1'
$LaunchShortcut = $WshShell.CreateShortcut((Join-Path $Desktop 'CPLayout Web Test.lnk'))
$LaunchShortcut.TargetPath = $PowerShell
$LaunchShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LaunchScript`" -Distro `"$Distro`""
$LaunchShortcut.WorkingDirectory = Split-Path $LaunchScript
$LaunchShortcut.Description = 'Start this CPLayout checkout through the selected WSL distribution.'
$LaunchShortcut.Save()
Write-Host "Created $($LaunchShortcut.FullName)"
if ($WithStopShortcut) {
  $StopScript = Join-Path $RepoWindowsPath 'tools\windows\Stop-CPLayoutWeb.ps1'
  $StopShortcut = $WshShell.CreateShortcut((Join-Path $Desktop 'Stop CPLayout Web Test.lnk'))
  $StopShortcut.TargetPath = $PowerShell
  # Mandatory -Port prompts the operator to select the printed server URL's port.
  $StopShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StopScript`" -Distro `"$Distro`""
  $StopShortcut.WorkingDirectory = Split-Path $StopScript
  $StopShortcut.Description = 'Stop one CPLayout UI server; enter its printed URL port when prompted.'
  $StopShortcut.Save()
  Write-Host "Created $($StopShortcut.FullName)"
}
