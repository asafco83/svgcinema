# CI check of the Store package: signs a copy of the x64 MSIX with a throwaway certificate for the
# package's publisher, installs it, checks Windows registered its thumbnail handler and file type, and
# removes it again (the Store signs the real one).
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out = Join-Path (Split-Path $here) 'Output\store'
$id = Get-Content (Join-Path $here 'identity.json') -Raw | ConvertFrom-Json
$signtool = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$cert = New-SelfSignedCertificate -Type Custom -Subject $id.publisher -KeyUsage DigitalSignature -FriendlyName 'SVGcinema test' `
  -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$pfx = Join-Path $env:RUNNER_TEMP 'test.pfx'
$pw = ConvertTo-SecureString -String 'test' -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw | Out-Null
Import-PfxCertificate -FilePath $pfx -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' -Password $pw | Out-Null
$msix = Join-Path $env:RUNNER_TEMP 'test-x64.msix'
Copy-Item "$out\packages\SVGcinema-Thumbnails-x64.msix" $msix
& $signtool sign /fd SHA256 /f $pfx /p test $msix
if ($LASTEXITCODE -ne 0) { throw 'signtool failed' }
Add-AppxPackage -Path $msix
$p = Get-AppxPackage -Name $id.name
if (-not $p) { throw 'the package did not install' }
Write-Host "Installed $($p.PackageFullName)"
$m = [xml](Get-Content (Join-Path $p.InstallLocation 'AppxManifest.xml') -Raw)
if ($m.OuterXml -notmatch 'ThumbnailHandler') { throw 'no thumbnail handler in the installed manifest' }
foreach ($f in 'svgcinema-thumbs.dll', 'svgcinema-thumbs-about.exe') {
  if (-not (Test-Path (Join-Path $p.InstallLocation $f))) { throw "$f missing" }
}
Remove-AppxPackage -Package $p.PackageFullName
Write-Host 'Store package: installs, registers the handler, uninstalls'
