# Génère les médias de test du banc de régression (ffmpeg requis).
#
#   powershell -ExecutionPolicy Bypass -File tools/regression/make-media.ps1
#
# Les repères audio sont volontaires : ils permettent de mesurer l'alignement son/image
# au millième de seconde dans les fichiers exportés.

$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'media'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$ff = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ff) {
    $ff = 'C:\Users\zigmoon\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe'
}
if (-not (Test-Path $ff)) { throw "ffmpeg introuvable : installez-le ou adaptez le chemin dans ce script." }

Write-Host "ffmpeg : $ff"
Write-Host "Sortie : $dir`n"

# ── a.mp4 : 6 s, 1920x1080 @30, audio 440 Hz 0-2 s / 880 Hz 2-4 s / 440 Hz 4-6 s ──────────
Write-Host '• a.mp4 (6 s, repères 440/880/440 Hz)'
& $ff -y -hide_banner -loglevel error `
    -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=6" `
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" `
    -f lavfi -i "sine=frequency=880:sample_rate=48000:duration=2" `
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" `
    -filter_complex "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]" `
    -map 0:v -map "[a]" `
    -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -g 30 `
    -c:a aac -b:a 192k -shortest (Join-Path $dir 'a.mp4')

# ── b.mp4 : 4 s, 1920x1080 @30, audio 1200 Hz ─────────────────────────────────────────────
Write-Host '• b.mp4 (4 s, 1200 Hz)'
& $ff -y -hide_banner -loglevel error `
    -f lavfi -i "testsrc=size=1920x1080:rate=30:duration=4" `
    -f lavfi -i "sine=frequency=1200:sample_rate=48000:duration=4" `
    -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -g 30 `
    -c:a aac -b:a 192k -shortest (Join-Path $dir 'b.mp4')

# ── img.png : image magenta 1920x1080 avec liseré blanc ──────────────────────────────────
Write-Host '• img.png (image magenta)'
& $ff -y -hide_banner -loglevel error `
    -f lavfi -i "color=c=0xCC0066:s=1920x1080" -frames:v 1 `
    -vf "drawbox=x=20:y=20:w=1880:h=1040:color=white@1:t=20" (Join-Path $dir 'img.png')

# ── music.wav : 13 s de 300 Hz (piste audio de fond) ─────────────────────────────────────
Write-Host '• music.wav (13 s, 300 Hz)'
& $ff -y -hide_banner -loglevel error `
    -f lavfi -i "sine=frequency=300:sample_rate=48000:duration=13" `
    -c:a pcm_s16le (Join-Path $dir 'music.wav')

# ── beep.wav : 3 s de 1500 Hz (piste audio d'appoint) ────────────────────────────────────
Write-Host '• beep.wav (3 s, 1500 Hz)'
& $ff -y -hide_banner -loglevel error `
    -f lavfi -i "sine=frequency=1500:sample_rate=48000:duration=3" `
    -c:a pcm_s16le (Join-Path $dir 'beep.wav')

Write-Host "`nMédias prêts :"
Get-ChildItem $dir | Sort-Object Name | ForEach-Object { '  {0,-12} {1,8:N0} Ko' -f $_.Name, ($_.Length / 1KB) }
