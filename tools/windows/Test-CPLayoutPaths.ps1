param([string]$HelpersPath = (Join-Path $PSScriptRoot 'CPLayoutPaths.ps1'))
$ErrorActionPreference = 'Stop'
. $HelpersPath
function Equal($actual, $expected) { if ($actual -cne $expected) { throw "Expected [$expected], observed [$actual]" } }
function Rejected([scriptblock]$Action) {
  $threw = $false
  try { & $Action | Out-Null } catch { $threw = $true }
  if (-not $threw) { throw 'Expected rejection' }
}
$distro = 'Ubuntu-24.04'
Equal (ConvertTo-CPLayoutWslPath 'H:\work space\cplayout' $distro) '/mnt/h/work space/cplayout'
Equal (ConvertTo-CPLayoutWindowsPath '/mnt/h/work space/cplayout' $distro) 'H:\work space\cplayout'
Equal (ConvertTo-CPLayoutWindowsPath '/home/cyber/work spaces/cplayout' $distro) '\\wsl.localhost\Ubuntu-24.04\home\cyber\work spaces\cplayout'
Equal (ConvertTo-CPLayoutWslPath '\\wsl.localhost\Ubuntu-24.04\home\cyber\work spaces\cplayout' $distro) '/home/cyber/work spaces/cplayout'
Equal (ConvertTo-CPLayoutWslPath '\\wsl$\Ubuntu-24.04\home\cyber\Case' $distro) '/home/cyber/Case'
Rejected { ConvertTo-CPLayoutWslPath '\\wsl.localhost\Ubuntu\home\cyber' $distro }
Rejected { ConvertTo-CPLayoutWslPath '\\server\share\file' $distro }
Rejected { ConvertTo-CPLayoutWslPath '../repo' $distro }
Rejected { ConvertTo-CPLayoutWindowsPath '/home/cyber/../private' $distro }
Rejected { ConvertTo-CPLayoutWindowsPath '/home/cyber' 'Ubuntu/other' }
if (Test-CPLayoutArchiveUrl 'https://example.invalid/report' 'H:\cplayout' $distro) { throw 'Non-file archive accepted' }
if (Test-CPLayoutArchiveUrl 'file:///H:/cplayout/reports/visual-layout-review-other/a.html' 'H:\cplayout' $distro) { throw 'Sibling prefix accepted' }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('cplayout-path-proof-' + [Guid]::NewGuid().ToString('N'))
try {
  $archive = Join-Path $fixture 'reports\visual-layout-review'
  New-Item -ItemType Directory -Path $archive -Force | Out-Null
  $file = Join-Path $archive 'space report.html'
  '<p>Synthetic path fixture</p>' | Set-Content -LiteralPath $file
  if (-not (Test-CPLayoutArchiveUrl ([Uri]$file).AbsoluteUri $fixture $distro)) { throw 'Existing owned archive rejected' }
  $outside = Join-Path $fixture 'outside'
  New-Item -ItemType Directory -Path $outside | Out-Null
  'outside' | Set-Content -LiteralPath (Join-Path $outside 'other.html')
  $junction = Join-Path $archive 'linked'
  New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
  if (Test-CPLayoutArchiveUrl ([Uri](Join-Path $junction 'other.html')).AbsoluteUri $fixture $distro) { throw 'Archive junction escape accepted' }
  if (Test-CPLayoutArchiveUrl 'file://wsl.localhost/Ubuntu/home/cyber/reports/visual-layout-review/a.html' '\\wsl.localhost\Ubuntu-24.04\home\cyber' $distro) { throw 'Foreign distribution archive accepted' }
} finally {
  # Test-owned junction and directory only; never traverse the link during removal.
  if ($junction -and (Test-Path -LiteralPath $junction)) { [IO.Directory]::Delete($junction) }
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
. (Join-Path (Split-Path $HelpersPath -Parent) 'GoogleEarthIdentity.ps1')
$process = [pscustomobject]@{Id=123; ProcessName='googleearth'; Path='C:\Google\googleearth.exe'; StartTime=[datetime]'2026-09-27T00:00:00Z'}
$identity = Get-CPLayoutGoogleEarthIdentity $process
Assert-CPLayoutGoogleEarthIdentity $identity 123 $identity.startTime 'C:\Google\googleearth.exe'
Rejected { Assert-CPLayoutGoogleEarthIdentity $identity 123 'stale' 'C:\Google\googleearth.exe' }
Rejected { Assert-CPLayoutGoogleEarthIdentity $identity 456 $identity.startTime 'C:\Google\googleearth.exe' }
Rejected { Select-CPLayoutGoogleEarthProcess @($process,$process) 'C:\Google\googleearth.exe' }
Rejected { Select-CPLayoutGoogleEarthProcess @($process) 'C:\Other\googleearth.exe' }
Write-Output 'Windows/WSL paths, archives and process identity: 20 checks passed.'
