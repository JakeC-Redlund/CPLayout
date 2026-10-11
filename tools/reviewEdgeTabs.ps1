param([string]$Distro = 'Ubuntu-24.04', [string]$CloseTitle = '', [string]$SelectTitle = '', [string]$ExpectedUrl = '', [string]$ProfileName = 'edge-review-capture-emQ55h', [string]$ArchivePath = '', [string]$OpenQuestionnaireUrl = '', [string]$CompletedReceiptPath = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows/CPLayoutPaths.ps1')
$reviewRepoRoot = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$owned = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'msedge.exe' -and $_.CommandLine -like "*$ProfileName*"
} | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 })
if ($owned.Count -ne 1) { throw 'Expected exactly one CPLayout review window' }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($owned[0].MainWindowHandle)
if ($OpenQuestionnaireUrl) {
  if ($OpenQuestionnaireUrl -notmatch '^http://127\.0\.0\.1:\d+/?$') { throw 'Expected local review hub' }
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
  $addressValues = @($edits | Where-Object { $_.Current.Name -eq 'Address and search bar' } | ForEach-Object { $_.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value })
  if ($addressValues.Count -ne 1 -or ($addressValues[0].TrimEnd('/') -ne $OpenQuestionnaireUrl.TrimEnd('/') -and $addressValues[0].TrimEnd('/') -ne $OpenQuestionnaireUrl.Substring(7).TrimEnd('/'))) { throw 'Review hub is not selected; refused to invoke controls' }
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Open questionnaire')))
  if ($buttons.Count -ne 1) { throw 'Expected one Open questionnaire command' }
  $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 500
}
$tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem)))
if ($CloseTitle -or $SelectTitle) {
  $isCompletedHub = $ExpectedUrl -match '^http://127\.0\.0\.1:\d+/?$'
  if ($isCompletedHub) {
    if (-not $CompletedReceiptPath -or -not (Test-Path -LiteralPath $CompletedReceiptPath)) { throw 'Completed receipt required for HTTP hub cleanup' }
    $receipt = Get-Content -LiteralPath $CompletedReceiptPath -Raw | ConvertFrom-Json
    $live = Invoke-RestMethod -Uri ($ExpectedUrl.TrimEnd('/') + '/api/state') -TimeoutSec 5
    if (-not $receipt.completedAt -or $receipt.completedAt -ne $live.completedAt -or $receipt.revision -ne $live.revision -or $receipt.packet.id -ne $live.packet.id -or
      ($receipt.answers | ConvertTo-Json -Depth 20 -Compress) -ne ($live.answers | ConvertTo-Json -Depth 20 -Compress)) { throw 'Live completed answers do not match retained receipt' }
  } elseif (-not (Test-CPLayoutArchiveUrl $ExpectedUrl $reviewRepoRoot $Distro)) { throw 'Only archived CPLayout file reviews or completed local hubs may be closed' }
  $targetTitle = if ($CloseTitle) { $CloseTitle } else { $SelectTitle }
  $matched = @($tabs | Where-Object { $_.Current.Name -eq $targetTitle })
  if ($matched.Count -ne 1) { throw 'Expected one exact named review tab' }
  if ($isCompletedHub -and $targetTitle -notlike 'Review hub | CPLayout*') { throw 'Expected completed review hub title' }
  $selection = $matched[0].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $selection.Select()
  Start-Sleep -Milliseconds 300
  $address = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
  $urls = @($address | Where-Object { $_.Current.Name -eq 'Address and search bar' } | ForEach-Object { $_.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value })
  $alternateUrl = if ($isCompletedHub) { $ExpectedUrl.Substring(7) } else { ([Uri]$ExpectedUrl).LocalPath }
  if ($urls.Count -ne 1 -or ($urls[0].TrimEnd('/') -ne $ExpectedUrl.TrimEnd('/') -and $urls[0].TrimEnd('/') -ne $alternateUrl.TrimEnd('/'))) { throw "Address mismatch; refused close: $urls" }
  if ($SelectTitle) {
    $nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $data = @($nodes | Where-Object { $_.Current.ControlType.ProgrammaticName -in @('ControlType.Button','ControlType.Edit','ControlType.RadioButton') } | ForEach-Object {
      $value = $null; $pattern = $null; $selected = $null
      if ($_.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { $value = $pattern.Current.Value }
      $pattern = $null
      if ($_.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $selected = $pattern.Current.IsSelected }
      [pscustomobject]@{Type=$_.Current.ControlType.ProgrammaticName;Name=$_.Current.Name;Value=$value;Selected=$selected}
    })
    $serialized = [pscustomobject]@{At=(Get-Date).ToUniversalTime().ToString('o');Url=$ExpectedUrl;Title=$targetTitle;Controls=$data} | ConvertTo-Json -Depth 5
    if ($ArchivePath) {
      if (Test-Path -LiteralPath $ArchivePath) { throw 'Archive exists; refusing replacement' }
      $serialized | Set-Content -LiteralPath $ArchivePath -Encoding UTF8
      Write-Output "Archived $($data.Count) controls to $ArchivePath"
    } else { Write-Output $serialized }
    exit
  }
  if (-not $ArchivePath -or -not (Test-Path -LiteralPath $ArchivePath)) { throw 'Archive required before tab closure' }
  $archived = Get-Content -LiteralPath $ArchivePath -Raw | ConvertFrom-Json
  if ($archived.Url -ne $ExpectedUrl) { throw 'Archive URL mismatch' }
  $currentNodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $currentAnswers = @($currentNodes | Where-Object {
    $_.Current.ControlType.ProgrammaticName -in @('ControlType.Edit','ControlType.RadioButton') -and $_.Current.Name -ne 'Address and search bar'
  } | ForEach-Object {
    $value = $null; $selected = $null; $pattern = $null
    if ($_.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { $value = $pattern.Current.Value }
    $pattern = $null
    if ($_.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $selected = $pattern.Current.IsSelected }
    [pscustomobject]@{Type=$_.Current.ControlType.ProgrammaticName;Name=$_.Current.Name;Value=$value;Selected=$selected}
  })
  $archivedAnswers = @($archived.Controls | Where-Object { $_.Type -in @('ControlType.Edit','ControlType.RadioButton') -and $_.Name -ne 'Address and search bar' })
  if (($currentAnswers | ConvertTo-Json -Depth 4 -Compress) -ne ($archivedAnswers | ConvertTo-Json -Depth 4 -Compress)) { throw 'Answers changed since archive; capture a fresh archive before closure' }
  $close = $matched[0].FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)))
  $buttons = @($close | Where-Object { $_.Current.Name -like 'Close tab*' })
  if ($buttons.Count -ne 1) { throw 'Missing unique tab-close control' }
  $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 300
}
$items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem)))
@($items | ForEach-Object { [pscustomobject]@{Title=$_.Current.Name;AutomationId=$_.Current.AutomationId} }) | ConvertTo-Json
