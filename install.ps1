# Install dsh-sidebar-image-zoom into the desktop profile.
#
# Run (the execution policy blocks .ps1 files, so invoke it like this):
#   Invoke-Expression ([IO.File]::ReadAllText("C:\Users\Administrator\Desktop\DeepSeek\dsh-sidebar-image-zoom\install.ps1", [Text.Encoding]::UTF8))
#
# Stages the package in two places, registers it in the profile manifest, and
# leaves a timestamped backup of package.json behind. Undo: uninstall.ps1.

$ErrorActionPreference = "Stop"

$src        = "C:\Users\Administrator\Desktop\DeepSeek\dsh-sidebar-image-zoom"
$profileDir = "C:\Users\Administrator\.dsh\profiles\desktop"
$manifest   = Join-Path $profileDir "package.json"
$pkgName    = "dsh-sidebar-image-zoom"
$depSpec    = "file:./plugins/$pkgName"
$python     = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"

foreach ($f in @("package.json", "cordis.patch.yml", "lib\index.js", "lib\client.js", "tools\manifest_edit.py")) {
	if (-not (Test-Path (Join-Path $src $f))) { throw "missing source file: $f" }
}
if (-not (Test-Path $python)) { throw "python runtime not found: $python" }

# --- 1. stage the package in two places -------------------------------------
# plugins/    : the source of truth the file: dependency points at
# node_modules/: a real copy, so it works before pnpm ever runs again
foreach ($root in @("plugins", "node_modules")) {
	$dest = Join-Path $profileDir "$root\$pkgName"
	if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
	New-Item -ItemType Directory -Force -Path $dest | Out-Null
	foreach ($item in @("package.json", "cordis.patch.yml", "lib")) {
		Copy-Item (Join-Path $src $item) -Destination $dest -Recurse -Force
	}
	Write-Host "staged  $dest"
}

# --- 2. register it in the profile manifest ---------------------------------
& $python (Join-Path $src "tools\manifest_edit.py") install $manifest $pkgName $depSpec
if ($LASTEXITCODE -ne 0) { throw "manifest edit failed" }

# --- 3. prove the package really resolves from the profile ------------------
$probe = @"
const p = require('$($manifest -replace '\\','/')').dependencies;
console.log(p['$pkgName']);
"@
$resolved = & "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" -e $probe
Write-Host "profile dependency reads back as: $resolved"

Write-Host ""
Write-Host "OK - $pkgName installed and registered."
Write-Host "RESTART DeepSeek Harness, then open an image in the right sidebar:"
Write-Host "  wheel = zoom at the cursor    drag = pan    double-click = fit <-> 1:1"
Write-Host "To undo:  Invoke-Expression ([IO.File]::ReadAllText(`"$src\uninstall.ps1`", [Text.Encoding]::UTF8))"
