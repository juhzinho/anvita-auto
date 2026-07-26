# Windows VPS — headless pool Anvita
#
#   npm run anvita:vps
#   .\scripts\run-anvita-vps.ps1 500 2 edge
#   .\scripts\run-anvita-vps.ps1 50 3 chrome
#
# Browsers: edge | chrome | chromium | brave | firefox

param(
  [string]$Total = $env:ANVITA_POOL_TOTAL,
  [string]$Workers = $env:ANVITA_POOL_WORKERS,
  [string]$Browser = $env:ANVITA_BROWSER
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

$argsList = @()
if ($Total) { $argsList += $Total }
if ($Workers) { $argsList += $Workers }
if ($Browser) { $argsList += $Browser }

node (Join-Path $ScriptDir "run-anvita-vps.mjs") @argsList
exit $LASTEXITCODE
