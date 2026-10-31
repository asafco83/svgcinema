# Packs SVGcinema Thumbnails for the Microsoft Store: one MSIX per architecture (x64, ARM64) from build.cmd's
# output, bundled into SVGcinema-Thumbnails.msixbundle (unsigned: the Store signs it). The package identity
# comes from identity.json (Partner Center's values). Run from the repo root after build.cmd:
#   pwsh thumbnailers/windows/store/pack.ps1 [-Version 1.1.0.0]
param([string]$Version = '1.1.0.0')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$win = Split-Path $here
$out = Join-Path $win 'Output\store'
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $sdk) { throw 'makeappx.exe not found (Windows SDK)' }
$makeappx = $sdk.FullName
$id = Get-Content (Join-Path $here 'identity.json') -Raw | ConvertFrom-Json
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$out\packages" | Out-Null
foreach ($arch in 'x64', 'arm64') {
  $stage = Join-Path $out "stage-$arch"
  New-Item -ItemType Directory -Force -Path "$stage\Assets" | Out-Null
  Copy-Item (Join-Path $win "build\$arch\svgcinema-thumbs.dll"), (Join-Path $win "build\$arch\svgcinema-thumbs-about.exe") $stage
  Copy-Item (Join-Path $here 'Assets\*') "$stage\Assets"
  $m = (Get-Content (Join-Path $here 'AppxManifest.xml') -Raw).
    Replace('{NAME}', $id.name).Replace('{PUBLISHER}', $id.publisher).Replace('{PUBLISHER_DISPLAY_NAME}', $id.publisherDisplayName).
    Replace('{VERSION}', $Version).Replace('{ARCH}', $arch)
  Set-Content -Path "$stage\AppxManifest.xml" -Value $m -Encoding utf8
  & $makeappx pack /o /d $stage /p "$out\packages\SVGcinema-Thumbnails-$arch.msix"
  if ($LASTEXITCODE -ne 0) { throw "makeappx pack $arch failed" }
}
& $makeappx bundle /o /d "$out\packages" /p "$out\SVGcinema-Thumbnails.msixbundle" /bv $Version
if ($LASTEXITCODE -ne 0) { throw 'makeappx bundle failed' }
Write-Host "Built $out\SVGcinema-Thumbnails.msixbundle"
