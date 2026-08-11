<#
.SYNOPSIS
  Fetches the latest Nexus tray build and launches it.

.DESCRIPTION
  Downloads the executable from the rolling `tray-latest` prerelease published
  by .github/workflows/build-windows.yml, replaces the local copy only if the
  hash differs, and starts it if it is not already running.

  Deliberately independent of `bin/model-router-tray`. That path hashes the
  tray's source files under the install root and compares them to a stamp
  beside the binary, so a downloaded build always looks stale to it and it
  tries to rebuild from source - which needs Rust and cargo locally.

.PARAMETER NoLaunch
  Update the binary but do not start it.

.PARAMETER Tag
  Release tag to pull from. Defaults to the rolling `tray-latest`.
#>
[CmdletBinding()]
param(
  [switch]$NoLaunch,
  [string]$Tag = 'tray-latest'
)

$ErrorActionPreference = 'Stop'

$repo = 'rendez2k/nexus'
# The Cargo [[bin]] name, still codex-router-desktop - the router resolves the
# tray by that exact filename. See docs/RENAME.md.
$exeName = 'codex-router-desktop.exe'
$procName = 'codex-router-desktop'
$url = "https://github.com/$repo/releases/download/$Tag/$exeName"
$dir = Join-Path $env:LOCALAPPDATA 'Nexus\tray'
$exe = Join-Path $dir $exeName
$tmp = Join-Path $env:TEMP "nexus-tray-$PID.exe"

New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "Checking $url"
# Invoke-WebRequest's progress bar makes downloads crawl on PowerShell 5.1.
# Suppressing it is a large speedup, not a cosmetic choice.
$previousProgress = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
try {
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
} catch {
  Write-Host ""
  Write-Host "Could not download the tray build." -ForegroundColor Red
  Write-Host "  $url"
  Write-Host "  $($_.Exception.Message)"
  Write-Host ""
  Write-Host "If this is a 404, no build has been published yet. Run the"
  Write-Host "'Build Windows tray' workflow in the Actions tab first."
  exit 1
} finally {
  $ProgressPreference = $previousProgress
}

$incoming = (Get-FileHash $tmp -Algorithm SHA256).Hash
$installed = if (Test-Path $exe) { (Get-FileHash $exe -Algorithm SHA256).Hash } else { '' }

if ($incoming -eq $installed) {
  Write-Host "Already on the latest build ($($incoming.Substring(0, 12)))."
  Remove-Item $tmp -Force
} else {
  Write-Host "New build $($incoming.Substring(0, 12)) - installing to $exe"
  # Windows will not overwrite a running executable, so stop it first.
  Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 750
  Move-Item $tmp $exe -Force
  # Strips the mark-of-the-web so SmartScreen stops prompting on every launch.
  Unblock-File $exe
}

if ($NoLaunch) { return }

$running = Get-Process -Name $procName -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Tray already running (PID $($running.Id -join ', '))."
} else {
  Write-Host "Starting the tray."
  Start-Process $exe
}
