$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectPath
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
& $nodeExecutable --experimental-strip-types (Join-Path $PSScriptRoot 'monitoring-runtime.mjs')
exit $LASTEXITCODE
