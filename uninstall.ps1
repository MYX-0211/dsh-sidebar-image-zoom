# Uninstall dsh-sidebar-image-zoom and restore the sidebar's built-in image preview.
#
# Run (the execution policy blocks .ps1 files, so invoke it like this):
#   Invoke-Expression ([IO.File]::ReadAllText("C:\Users\Administrator\Desktop\DeepSeek\dsh-sidebar-image-zoom\uninstall.ps1", [Text.Encoding]::UTF8))
#
# Removes the staged package directories and both manifest entries.
# Restart DSH afterwards.

$ErrorActionPreference = "Stop"

$src        = "C:\Users\Administrator\Desktop\DeepSeek\dsh-sidebar-image-zoom"
$profileDir = "C:\Users\Administrator\.dsh\profiles\desktop"
$manifest   = Join-Path $profileDir "package.json"
$pkgName    = "dsh-sidebar-image-zoom"
$python     = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path $manifest)) { throw "profile manifest not found: $manifest" }

& $python (Join-Path $src "tools\manifest_edit.py") uninstall $manifest $pkgName
if ($LASTEXITCODE -ne 0) { throw "manifest edit failed" }

foreach ($root in @("node_modules", "plugins")) {
	$dir = Join-Path $profileDir "$root\$pkgName"
	if (Test-Path $dir) { Remove-Item $dir -Recurse -Force; Write-Host "removed $dir" }
}

Write-Host ""
Write-Host "Done. Restart DeepSeek Harness to fall back to the built-in image viewer."
