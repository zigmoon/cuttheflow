# Construction des binaires CUT THE FLOW 2 (hôte Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts/build.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -SkipWeb
#
# Produit dans dist/ :
#   cuttheflow-windows-x86_64.exe
#   cuttheflow-linux-x86_64        (statique, musl)
#   cuttheflow-linux-aarch64       (statique, musl)
#   SHA256SUMS.txt
#
# macOS ne peut pas être produit depuis Windows : le linkage Mach-O exige le SDK
# Apple. Le workflow `.github/workflows/cuttheflow.yml` construit macOS (Intel et
# Apple Silicon) sur des runners macOS.

param(
    [switch]$SkipWeb,
    [switch]$SkipLinux
)

$ErrorActionPreference = 'Stop'
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
cargo "+$toolchain" build --release -p ctf-app
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

Write-Step 'Assemblage de dist/'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item (Join-Path $root 'target\release\cuttheflow.exe') (Join-Path $dist 'cuttheflow-windows-x86_64.exe') -Force
Copy-Item (Join-Path $PSScriptRoot 'lisez-moi-dist.txt') (Join-Path $dist 'LISEZ-MOI.txt') -Force
$cuttheflowRoot = Split-Path -Parent $root
Copy-Item (Join-Path $cuttheflowRoot 'LICENSE') (Join-Path $dist 'LICENSE') -Force

if ($linuxBuilt -contains 'x86_64-unknown-linux-musl') {
    Copy-Item (Join-Path $root 'target\x86_64-unknown-linux-musl\release\cuttheflow') (Join-Path $dist 'cuttheflow-linux-x86_64') -Force
}
if ($linuxBuilt -contains 'aarch64-unknown-linux-musl') {
    Copy-Item (Join-Path $root 'target\aarch64-unknown-linux-musl\release\cuttheflow') (Join-Path $dist 'cuttheflow-linux-aarch64') -Force
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
