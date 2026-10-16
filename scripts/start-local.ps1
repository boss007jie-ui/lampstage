param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$localProjectRoot = Split-Path -Parent $PSScriptRoot
$localWebRoot = Join-Path $localProjectRoot 'apps\web'
$localRuntimeRoot = Join-Path $localWebRoot '.local-runtime'
$localNode = (Get-Command node.exe -ErrorAction Stop).Source
Set-Location -LiteralPath $localWebRoot
if (-not (Test-Path -LiteralPath (Join-Path $localWebRoot 'node_modules\tsx'))) {
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
New-Item -ItemType Directory -Path $localRuntimeRoot -Force | Out-Null
$localStatePath = Join-Path $localRuntimeRoot 'state.json'
$localAlreadyRunning = $false
if (Test-Path -LiteralPath $localStatePath) {
  $localOldState = Get-Content -LiteralPath $localStatePath -Raw | ConvertFrom-Json
  try {
    $localHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:55433/health' -Headers @{ 'x-local-token' = $localOldState.controlToken } -TimeoutSec 20
    $localAlreadyRunning = $localHealth.database -and $localHealth.website -and $localHealth.worker
  } catch { }
}
if (-not $localAlreadyRunning) {
  $localProcess = Start-Process -FilePath $localNode -ArgumentList @('--import', 'tsx', 'scripts/local-app.ts') -WorkingDirectory $localWebRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localRuntimeRoot 'launcher.log') -RedirectStandardError (Join-Path $localRuntimeRoot 'launcher-error.log') -PassThru
  Write-Host 'Starting the local website, database and video worker...'
  $localDeadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $localDeadline) {
    if ($localProcess.HasExited) { throw 'Startup failed. See apps/web/.local-runtime/launcher-error.log.' }
    try {
      $localState = Get-Content -LiteralPath $localStatePath -Raw | ConvertFrom-Json
      $localHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:55433/health' -Headers @{ 'x-local-token' = $localState.controlToken } -TimeoutSec 20
      if ($localHealth.database -and $localHealth.website -and $localHealth.worker) { break }
    } catch { }
    Start-Sleep -Seconds 2
  }
  if (-not ($localHealth.database -and $localHealth.website -and $localHealth.worker)) { throw 'Startup has not completed. Check local runtime logs before trying again.' }
}
Write-Host 'Local website ready: http://127.0.0.1:3000'
Write-Host ('Image configuration ready: ' + $localHealth.image)
Write-Host ('RunningHub account 01 ready: ' + $localHealth.video)
Write-Host 'Login and provider instructions: apps/web/.local-runtime/ (the .txt file).'
if (-not $NoOpen) { Start-Process 'http://127.0.0.1:3000' -WindowStyle Hidden }
