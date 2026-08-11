@echo off
REM YouTube Parca Kesici - cift tikla-ishe sal (Windows)
REM Node.js qurulmalidir, hemcinin yt-dlp ve ffmpeg (README-ya bax).
chcp 65001 >nul
title YouTube Parca Kesici
cd /d "%~dp0"

echo(
echo   ==========================================
echo      YouTube Parca Kesici
echo   ==========================================
echo(

REM --- Node.js yoxlanishi ---
where node >nul 2>nul
if errorlevel 1 (
  echo   [XETA] Node.js tapilmadi.
  echo   Zehmet olmasa https://nodejs.org saytindan LTS versiyani qurun,
  echo   sonra bu fayli yeniden achin.
  echo(
  pause
  exit /b 1
)

REM --- yt-dlp / ffmpeg xeberdarligi (blok etmir) ---
where yt-dlp >nul 2>nul
if errorlevel 1 echo   [DIQQET] yt-dlp tapilmadi - indirme ishlemeyecek. README-ya bax.
where ffmpeg >nul 2>nul
if errorlevel 1 echo   [DIQQET] ffmpeg tapilmadi - kesim ishlemeyecek. README-ya bax.

REM --- Ilk defe: paketleri qur ---
if not exist "node_modules" (
  echo   Ilk defe achilir - paketler qurulur, biraz gozleyin...
  echo(
  call npm install
  if errorlevel 1 (
    echo(
    echo   [XETA] npm install ugursuz oldu.
    pause
    exit /b 1
  )
)

echo(
echo   Server achilir... brauzer avtomatik acilacaq:
echo   http://localhost:4545
echo(
echo   Dayandirmaq ucun bu pencerede Ctrl+C basin.
echo   ------------------------------------------
echo(

REM Server qalxandan ~3 saniye sonra brauzeri ac (paralel).
start "" cmd /c "timeout /t 3 >nul & start "" http://localhost:4545"

REM Serveri ishe sal (bu pencere achiq qalmalidir).
call npm start

echo(
echo   Server dayandi. Pencereni baglaya bilersiniz.
pause
