# Pure Windows/WSL conversion helpers. Dot-sourcing starts no process.
function Assert-CPLayoutDistro([string]$Distro) {
  if ($Distro -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'An explicit valid WSL distribution is required.' }
}

function Assert-CPLayoutPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\x00-\x1f]' -or
      ($Path -split '[\\/]' | Where-Object { $_ -eq '..' -or $_ -eq '.' })) {
    throw 'Expected a normalized path without traversal or control characters.'
  }
}

function ConvertTo-CPLayoutWslPath([string]$Path, [string]$Distro) {
  Assert-CPLayoutDistro $Distro
  Assert-CPLayoutPath $Path
  if ($Path -match '^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$') {
    if ($Matches[1] -cne $Distro) { throw 'WSL path distribution does not match the selected distribution.' }
    if (-not $Matches[2]) { return '/' }
    return ($Matches[2] -replace '\\', '/')
  }
  if ($Path -match '^([A-Za-z]):[\\/](.*)$') {
    return '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + ($Matches[2] -replace '\\', '/')
  }
  if ($Path.StartsWith('/') -and -not $Path.StartsWith('//') -and -not $Path.Contains('\')) { return $Path }
  throw 'Expected an absolute drive, Linux, or matching WSL UNC path.'
}

function ConvertTo-CPLayoutWindowsPath([string]$Path, [string]$Distro) {
  $linux = ConvertTo-CPLayoutWslPath $Path $Distro
  if ($linux -match '^/mnt/([A-Za-z])(?:/(.*))?$') {
    return $Matches[1].ToUpperInvariant() + ':\' + ($Matches[2] -replace '/', '\')
  }
  return '\\wsl.localhost\' + $Distro + ($linux -replace '/', '\')
}

function Test-CPLayoutArchiveUrl([string]$Url, [string]$RepoRoot, [string]$Distro) {
  try {
    $uri = [Uri]$Url
    if (-not $uri.IsAbsoluteUri -or -not $uri.IsFile -or $uri.Query -or $uri.Fragment) { return $false }
    $candidate = ConvertTo-CPLayoutWindowsPath $uri.LocalPath $Distro
    $root = (ConvertTo-CPLayoutWindowsPath $RepoRoot $Distro).TrimEnd('\') + '\reports\visual-layout-review\'
    # Linux paths remain case-sensitive even when exposed through WSL UNC.
    $comparison = if ($root.StartsWith('\\')) { [StringComparison]::Ordinal } else { [StringComparison]::OrdinalIgnoreCase }
    if (-not $candidate.StartsWith($root, $comparison)) { return $false }
    # Do not allow a junction/symlink below the approved archive root.
    $cursor = Get-Item -LiteralPath $candidate -Force -ErrorAction Stop
    while ($cursor -and $cursor.FullName.Length -ge $root.TrimEnd('\').Length) {
      if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
      $cursor = if ($cursor.PSIsContainer) { $cursor.Parent } else { $cursor.Directory }
      if (-not $cursor) { break }
    }
    return $true
  } catch { return $false }
}
