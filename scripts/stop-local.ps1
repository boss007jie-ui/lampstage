$ErrorActionPreference = 'Stop'
$localWebRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'apps\web'
Set-Location -LiteralPath $localWebRoot
& node.exe --import tsx scripts/local-control.ts stop
if ($LASTEXITCODE -ne 0) { throw 'Local application could not stop. Active tasks must finish first.' }
