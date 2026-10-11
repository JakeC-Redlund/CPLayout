# Pure identity checks shared by capture and cleanup; no process mutation.
function Get-CPLayoutGoogleEarthIdentity($Process) {
  if (-not $Process -or $Process.ProcessName -ne 'googleearth') { throw 'Expected Google Earth process.' }
  $identity = [pscustomobject]@{
    id = $Process.Id
    path = $Process.Path
    startTime = $Process.StartTime.ToUniversalTime().ToString('o')
  }
  if (-not $identity.path -or -not $identity.startTime) { throw 'Google Earth process identity is unavailable.' }
  return $identity
}

function Assert-CPLayoutGoogleEarthIdentity($Identity, [int]$ProcessId, [string]$StartTime, [string]$ExpectedPath) {
  if ($ProcessId -le 0 -or -not $StartTime -or -not $ExpectedPath -or -not $Identity -or
      $Identity.id -ne $ProcessId -or $Identity.startTime -cne $StartTime -or
      -not [string]::Equals($Identity.path, $ExpectedPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Google Earth process identity mismatch; no process may be closed.'
  }
}

function Select-CPLayoutGoogleEarthProcess([object[]]$Processes, [string]$ExpectedPath) {
  $matching = @($Processes | Where-Object {
    try { $_.ProcessName -eq 'googleearth' -and [string]::Equals($_.Path, $ExpectedPath, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
  })
  if ($matching.Count -gt 1) { throw 'Ambiguous Google Earth session; explicit ownership is required.' }
  if ($matching.Count -eq 1) { return $matching[0] }
  if ($Processes.Count -gt 0) { throw 'Existing Google Earth processes do not match the expected executable.' }
  return $null
}
