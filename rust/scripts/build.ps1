# Construction des binaires CUT THE FLOW 2 (hôte Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts/build.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -SkipWeb
#
# Produit dans dist/ :
#   cuttheflow-windows-x86_64.exe
#   cuttheflow-linux-x86_64        (statique, musl)
#   cuttheflow-linux-aarch64       (statique, musl)
#   cuttheflow-macos-arm64         (Apple Silicon)
#   cuttheflow-macos-x86_64        (Intel)
#   SHA256SUMS.txt
#
# macOS : le linkage Mach-O passe par Zig (`cargo zigbuild`), qui fournit les
# stubs de la libSystem. Aucun Mac n'est donc nécessaire ; il faut simplement
# `zig` dans le PATH et `cargo-zigbuild` installé :
#   cargo +stable-x86_64-pc-windows-gnullvm install cargo-zigbuild --locked
#   rustup +stable-x86_64-pc-windows-gnullvm target add aarch64-apple-darwin x86_64-apple-darwin
# Sans Zig, l'étape est ignorée avec un avertissement (comme Linux sans ld.lld).
#
# Les binaires macOS produits ici ne sont pas signés : la CI les signe en
# ad-hoc (ou Developer ID si les secrets sont présents).

param(
    [switch]$SkipWeb,
    [switch]$SkipLinux,
    [switch]$SkipMac
)

$ErrorActionPreference = 'Stop'

<#
Écrit une archive ZIP dont les chemins utilisent « / ».

`Compress-Archive` écrit « icons\cuttheflow.png » sous Windows : sur Linux,
`unzip` crée alors un fichier littéralement nommé « icons\cuttheflow.png » au
lieu d'un dossier. Comme l'archive Linux contient maintenant un sous-dossier
d'icônes, on écrit l'archive nous-mêmes.
#>
function New-ZipArchive {
    param(
        [Parameter(Mandatory)][string]$SourceDirectory,
        [Parameter(Mandatory)][string]$Destination,
        [string[]]$Exclude = @()
    )
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $Destination) { Remove-Item $Destination -Force }
    $source = (Resolve-Path $SourceDirectory).Path.TrimEnd('\', '/')
    $zip = [System.IO.Compression.ZipFile]::Open($Destination, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem $source -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($source.Length + 1).Replace('\', '/')
            if ($Exclude -contains $_.Name) { return }
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal)
        }
    } finally {
        $zip.Dispose()
    }
}
$root = Split-Path -Parent $PSScriptRoot
$astro = Join-Path (Split-Path -Parent $root) 'astro'
$dist = Join-Path $root 'dist'
$toolchain = 'stable-x86_64-pc-windows-gnullvm'

function Write-Step($message) {
    Write-Host ""
    Write-Host "▶ $message" -ForegroundColor Cyan
}

if (-not $SkipWeb) {
    Write-Step 'Interface Astro (npm run build)'
    Push-Location $astro
    try {
        if (-not (Test-Path 'node_modules')) {
            npm install
        }
        npm run build
    }
    finally {
        Pop-Location
    }
}

Write-Step "Binaire Windows ($toolchain)"
# `--features desktop` : fenêtre native WebView2. Sans la feature, le binaire
# n'est qu'un serveur (mode navigateur).
cargo "+$toolchain" build --release -p ctf-app --features desktop
if ($LASTEXITCODE -ne 0) { throw 'échec de la compilation Windows' }

$linuxBuilt = @()
if (-not $SkipLinux) {
    $lld = Get-Command ld.lld -ErrorAction SilentlyContinue
    if (-not $lld) {
        Write-Warning 'ld.lld introuvable : compilation Linux ignorée (installez LLVM-MinGW).'
    }
    else {
        foreach ($target in @('x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl')) {
            Write-Step "Binaire Linux $target (statique)"
            $envName = 'CARGO_TARGET_' + ($target.ToUpper().Replace('-', '_').Replace('.', '_')) + '_LINKER'
            Set-Item -Path "Env:$envName" -Value $lld.Source
            cargo "+$toolchain" build --release --target $target -p ctf-app
            if ($LASTEXITCODE -ne 0) { throw "échec de la compilation $target" }
            $linuxBuilt += $target
        }
    }
}

$macBuilt = @()
if (-not $SkipMac) {
    $zig = Get-Command zig -ErrorAction SilentlyContinue
    $zigbuild = Get-Command cargo-zigbuild -ErrorAction SilentlyContinue
    if (-not $zig -or -not $zigbuild) {
        Write-Warning 'zig et/ou cargo-zigbuild introuvables : compilation macOS ignorée.'
    }
    else {
        $installed = rustup "+$toolchain" target list --installed
        foreach ($target in @('aarch64-apple-darwin', 'x86_64-apple-darwin')) {
            if ($installed -notcontains $target) {
                Write-Warning "cible $target absente : rustup +$toolchain target add $target"
                continue
            }
            Write-Step "Binaire macOS $target"
            cargo "+$toolchain" zigbuild --release --target $target -p ctf-app
            if ($LASTEXITCODE -ne 0) { throw "échec de la compilation $target" }
            $macBuilt += $target
        }
    }
}

Write-Step 'Assemblage de dist/'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item (Join-Path $root 'target\release\cuttheflow.exe') (Join-Path $dist 'cuttheflow-windows-x86_64.exe') -Force

# La cible gnullvm importe libunwind.dll : sans elle, Windows affiche
# « le fichier spécifié est introuvable » et RIEN ne démarre. On la copie donc
# à côté de l'exécutable — c'est la seule dépendance externe du binaire.
$unwind = Join-Path (Split-Path (Get-Command rustup).Source -Parent) 'toolchains\stable-x86_64-pc-windows-gnullvm\bin\libunwind.dll'
if (-not (Test-Path $unwind)) {
    $unwind = Join-Path $env:USERPROFILE '.rustup\toolchains\stable-x86_64-pc-windows-gnullvm\bin\libunwind.dll'
}
if (Test-Path $unwind) {
    Copy-Item $unwind (Join-Path $dist 'libunwind.dll') -Force
} else {
    Write-Host '  ⚠ libunwind.dll introuvable : le binaire Windows ne démarrera pas hors machine de build.' -ForegroundColor Yellow
}

# WebView2Loader.dll : chargée au démarrage par la fenêtre native (wry lie
# l'import library, pas la version statique). Le runtime WebView2, lui, est
# fourni par Windows 10/11 — c'est cette petite DLL qui manquerait.
$loader = Get-ChildItem "$env:USERPROFILE\.cargo\registry\src" -Recurse -Filter 'WebView2Loader.dll' -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -match '\\x64$' } |
    Select-Object -First 1
if ($loader) {
    Copy-Item $loader.FullName (Join-Path $dist 'WebView2Loader.dll') -Force
} else {
    Write-Host '  ⚠ WebView2Loader.dll introuvable : la fenêtre native ne démarrera pas.' -ForegroundColor Yellow
}

Copy-Item (Join-Path $PSScriptRoot 'lisez-moi-dist.txt') (Join-Path $dist 'LISEZ-MOI.txt') -Force
$cuttheflowRoot = Split-Path -Parent $root
Copy-Item (Join-Path $cuttheflowRoot 'LICENSE') (Join-Path $dist 'LICENSE') -Force

if ($linuxBuilt -contains 'x86_64-unknown-linux-musl') {
    Copy-Item (Join-Path $root 'target\x86_64-unknown-linux-musl\release\cuttheflow') (Join-Path $dist 'cuttheflow-linux-x86_64') -Force
}
if ($linuxBuilt -contains 'aarch64-unknown-linux-musl') {
    Copy-Item (Join-Path $root 'target\aarch64-unknown-linux-musl\release\cuttheflow') (Join-Path $dist 'cuttheflow-linux-aarch64') -Force
}
if ($macBuilt -contains 'aarch64-apple-darwin') {
    Copy-Item (Join-Path $root 'target\aarch64-apple-darwin\release\cuttheflow') (Join-Path $dist 'cuttheflow-macos-arm64') -Force
}
if ($macBuilt -contains 'x86_64-apple-darwin') {
    Copy-Item (Join-Path $root 'target\x86_64-apple-darwin\release\cuttheflow') (Join-Path $dist 'cuttheflow-macos-x86_64') -Force
}

Write-Step 'Archives par système'
# Chaque archive contient tout ce qu'il faut : exécutable, dépendances,
# lanceur et mode d'emploi. Un utilisateur extrait et lance, sans rien installer.
$version = (Select-String -Path (Join-Path $root 'Cargo.toml') -Pattern '^version = "([^"]+)"' |
    Select-Object -First 1).Matches.Groups[1].Value
$packDir = Join-Path $cuttheflowRoot 'packages'
New-Item -ItemType Directory -Force -Path $packDir | Out-Null
Get-ChildItem $packDir -Filter 'CUTTHEFLOW-*.zip' -ErrorAction SilentlyContinue | Remove-Item -Force

$packages = @(
    @{ name = 'windows-x86_64'; exe = 'cuttheflow-windows-x86_64.exe'; target = 'cuttheflow.exe'; extra = @('libunwind.dll', 'WebView2Loader.dll'); launcher = 'DEMARRER.cmd' },
    @{ name = 'linux-x86_64';   exe = 'cuttheflow-linux-x86_64';       target = 'cuttheflow';     extra = @();                 launcher = 'demarrer.sh' },
    @{ name = 'linux-aarch64';  exe = 'cuttheflow-linux-aarch64';      target = 'cuttheflow';     extra = @();                 launcher = 'demarrer.sh' },
    @{ name = 'macos-arm64';    exe = 'cuttheflow-macos-arm64';        target = 'cuttheflow';     extra = @();                 launcher = 'demarrer.command' },
    @{ name = 'macos-x86_64';   exe = 'cuttheflow-macos-x86_64';       target = 'cuttheflow';     extra = @();                 launcher = 'demarrer.command' }
)

$staging = Join-Path $env:TEMP 'ctf-pack'
foreach ($package in $packages) {
    $source = Join-Path $dist $package.exe
    if (-not (Test-Path $source)) { continue }
    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Copy-Item $source (Join-Path $staging $package.target) -Force
    foreach ($dependency in $package.extra) {
        $path = Join-Path $dist $dependency
        if (Test-Path $path) { Copy-Item $path (Join-Path $staging $dependency) -Force }
    }
    Copy-Item (Join-Path $dist 'LISEZ-MOI.txt') $staging -Force
    Copy-Item (Join-Path $dist 'LICENSE') $staging -Force
    $launcherSource = Join-Path $PSScriptRoot "lanceurs\$($package.launcher)"
    if (Test-Path $launcherSource) {
        Copy-Item $launcherSource (Join-Path $staging $package.launcher) -Force
    }
    # Linux : sans entrée de menu ni icônes, l'application n'apparaît pas dans le
    # lanceur et le tableau de bord affiche une icône générique.
    if ($package.name -like 'linux-*') {
        Copy-Item (Join-Path $PSScriptRoot 'lanceurs\cuttheflow.desktop') $staging -Force
        Copy-Item (Join-Path $PSScriptRoot 'lanceurs\installer.sh') $staging -Force
        $icons = Join-Path $staging 'icons'
        New-Item -ItemType Directory -Force -Path $icons | Out-Null
        Copy-Item (Join-Path $PSScriptRoot 'icons\cuttheflow-*.png') $icons -Force
    }
    $archive = Join-Path $packDir "CUTTHEFLOW-$version-$($package.name).zip"
    New-ZipArchive -SourceDirectory $staging -Destination $archive
    Write-Host "  $([System.IO.Path]::GetFileName($archive))  ($([math]::Round((Get-Item $archive).Length / 1MB, 2)) Mo)"
}
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue

# Installateur Windows : seulement s'il est compilable ici. La CI le produit
# toujours ; en local il dépend d'Inno Setup, donc son absence n'est pas une
# erreur — on le signale et on continue.
$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
    Write-Host '  [info] Inno Setup absent : installateur Windows non produit (winget install JRSoftware.InnoSetup).'
} else {
    Add-Type -AssemblyName System.Drawing
    $iconSource = Join-Path $cuttheflowRoot 'astro\public\img\icon-512.png'
    $icon = Join-Path $env:TEMP 'cuttheflow-installer.ico'
    $image = [System.Drawing.Image]::FromFile($iconSource)
    $bitmap = New-Object System.Drawing.Bitmap 256, 256
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($image, 0, 0, 256, 256)
    $graphics.Dispose()
    $memory = New-Object System.IO.MemoryStream
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $memory.ToArray()
    $memory.Dispose(); $bitmap.Dispose(); $image.Dispose()
    $stream = [System.IO.File]::Create($icon)
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
    $writer.Write([Byte]0); $writer.Write([Byte]0); $writer.Write([Byte]0); $writer.Write([Byte]0)
    $writer.Write([UInt16]1); $writer.Write([UInt16]32)
    $writer.Write([UInt32]$png.Length); $writer.Write([UInt32]22)
    $writer.Write($png)
    $writer.Close()

    $studioVersion = (Get-Content (Join-Path $cuttheflowRoot 'astro\package.json') -Raw | ConvertFrom-Json).version
    & $iscc `
        "/DStudioVersion=$studioVersion" `
        "/DEngineVersion=$version" `
        "/DSourceExe=$(Join-Path $dist 'cuttheflow-windows-x86_64.exe')" `
        "/DSourceDir=$dist" `
        "/DOutputDir=$packDir" `
        "/DIconFile=$icon" `
        "/DReadmeFile=$(Join-Path $dist 'LISEZ-MOI.txt')" `
        "/DLicenseFile=$(Join-Path $dist 'LICENSE')" `
        (Join-Path $PSScriptRoot 'installer.iss') | Out-Null
    $setup = Join-Path $packDir 'CUTTHEFLOW-windows-x86_64-setup.exe'
    if ($LASTEXITCODE -eq 0 -and (Test-Path $setup)) {
        Write-Host "  CUTTHEFLOW-windows-x86_64-setup.exe  ($([math]::Round((Get-Item $setup).Length / 1MB, 2)) Mo)"
    } else {
        Write-Host '  [info] ISCC a échoué : installateur Windows non produit.'
    }
}

Write-Step 'Empreintes SHA-256'
$lines = Get-ChildItem $dist -File |
    Where-Object { $_.Name -notin @('SHA256SUMS.txt', 'LISEZ-MOI.txt', 'LICENSE') } |
    Sort-Object Name |
    ForEach-Object {
        $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
        "$hash  $($_.Name)"
    }
$lines | Set-Content -Encoding ascii (Join-Path $dist 'SHA256SUMS.txt')
$lines | ForEach-Object { Write-Host "  $_" }

Write-Step 'Terminé'
Get-ChildItem $dist | Select-Object Name, Length | Format-Table -AutoSize
