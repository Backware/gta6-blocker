# Create a zip of src\ ready to upload to the Chrome Web Store (Windows).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "src\manifest.json") -Raw | ConvertFrom-Json
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist ("gta6-blocker-chrome-" + $manifest.version + ".zip")
if (Test-Path $out) { Remove-Item $out }
Get-ChildItem (Join-Path $root "src") -Exclude "_metadata" | Compress-Archive -DestinationPath $out
Write-Host "Created $out"
