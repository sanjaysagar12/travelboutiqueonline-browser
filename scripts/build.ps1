<#
.SYNOPSIS
    Packages the extension into a distributable .zip under build/.

.DESCRIPTION
    Zips only the files Chrome actually needs to load the extension:
    manifest.json, assets/, and src/. Everything else in the repo
    (README.md, ARCHITECTURE.md, response_data/, mock_response_data/,
    .claude/, .git/, ...) is development-only and is deliberately left
    out, so the archive is exactly what you'd upload to the Chrome Web
    Store or hand to someone to load unpacked.

.EXAMPLE
    powershell -File scripts\build.ps1
#>

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ManifestPath = Join-Path $RepoRoot 'manifest.json'
$BuildDir = Join-Path $RepoRoot 'build'

if (-not (Test-Path $ManifestPath)) {
    throw "manifest.json not found at $ManifestPath"
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if (-not $Manifest.version) {
    throw "manifest.json has no 'version' field"
}

# The complete, exact set of runtime files the extension needs. Anything
# in the repo that is NOT reachable from here (docs, sample API captures,
# editor/tooling config) is intentionally excluded from the archive.
$IncludeNames = @('manifest.json', 'assets', 'src')
$Include = $IncludeNames | ForEach-Object { Join-Path $RepoRoot $_ }

$Missing = $Include | Where-Object { -not (Test-Path $_) }
if ($Missing) {
    throw "Missing required extension file(s): $($Missing -join ', ')"
}

if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

$ZipName = "tbo-flight-interceptor-v$($Manifest.version).zip"
$ZipPath = Join-Path $BuildDir $ZipName

if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}

Compress-Archive -Path $Include -DestinationPath $ZipPath -CompressionLevel Optimal

# Print exactly what shipped, so it's obvious at a glance that nothing
# extra (docs, sample data, .git) snuck into the archive.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $Entries = $Zip.Entries | Sort-Object FullName
    Write-Host "Packaged $($Entries.Count) file(s) into $ZipName`:"
    foreach ($Entry in $Entries) {
        Write-Host "  $($Entry.FullName)"
    }
} finally {
    $Zip.Dispose()
}

$SizeKb = [Math]::Round((Get-Item $ZipPath).Length / 1KB, 1)
Write-Host ""
Write-Host "Build complete: $ZipPath ($SizeKb KB)"
