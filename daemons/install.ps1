$ErrorActionPreference = "Stop"
$BaseUrl = if ($env:PYLON_PAGES_ORIGIN) { $env:PYLON_PAGES_ORIGIN.TrimEnd("/") } else { "https://ai-pylon.github.io" }
$InstallDir = if ($env:PYLON_INSTALL_DIR) { $env:PYLON_INSTALL_DIR } else { Join-Path $HOME "ai-pylon-daemon" }

Write-Host "[pylon-daemon] Fetching release metadata from $BaseUrl/daemons/latest.json ..."
$Meta = Invoke-RestMethod -Uri "$BaseUrl/daemons/latest.json"
$ZipUrl = if ($Meta.url -match "^https?://") { $Meta.url } else { "$BaseUrl$($Meta.url)" }
$TmpZip = Join-Path $env:TEMP "pylon-daemon-$($Meta.version).zip"

Write-Host "[pylon-daemon] Downloading $ZipUrl ..."
Invoke-WebRequest -Uri $ZipUrl -OutFile $TmpZip

$Hash = (Get-FileHash -Path $TmpZip -Algorithm SHA256).Hash.ToLower()
if ($Hash -ne $Meta.sha256.ToLower()) {
    Remove-Item -Force $TmpZip -ErrorAction SilentlyContinue
    throw "SHA-256 mismatch! Expected $($Meta.sha256), got $Hash"
}
Write-Host "[pylon-daemon] SHA-256 verified ($Hash)"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Expand-Archive -Path $TmpZip -DestinationPath $InstallDir -Force
Remove-Item -Force $TmpZip -ErrorAction SilentlyContinue

Write-Host "[pylon-daemon] Installed to $InstallDir"
Write-Host "Run client mode:"
Write-Host "  `$env:PYLON2_DAEMON_MODE='client'; python `"$InstallDir\daemons\windows\agent.py`""
