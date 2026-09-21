@echo off
setlocal enabledelayedexpansion

rem ---------------------------------------------------------------------------
rem  Builds every A-X-M package in one go:
rem
rem    1. Windows portable  - a single .exe that runs from a stick
rem    2. Windows installer - the NSIS setup, with the desktop shortcut prompt
rem    3. Steam Deck image  - a Linux x64 AppImage
rem
rem  Each target is built separately and its own success or failure reported, so
rem  one failing does not hide the others. Nothing is deleted on the way in; the
rem  release folder is left alone except for what electron-builder replaces.
rem
rem  Usage:  build-all.bat              build everything
rem          build-all.bat win          Windows portable and installer only
rem          build-all.bat deck         Steam Deck AppImage only
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=all"

set "WIN_RESULT=skipped"
set "DECK_RESULT=skipped"

for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" package.json') do (
  set "VERSION=%%~v"
  goto :gotversion
)
:gotversion
echo.
echo ===========================================================
echo   A-X-M build-all   version !VERSION!
echo   target: %TARGET%
echo ===========================================================
echo.

rem -- prerequisites ----------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] node was not found on PATH. Install Node.js and try again.
  exit /b 1
)
if not exist "node_modules\" (
  echo [....] node_modules is missing, installing dependencies first
  call npm install
  if errorlevel 1 (
    echo [FAIL] npm install failed
    exit /b 1
  )
)

rem -- compile ----------------------------------------------------------------
echo [....] compiling main, renderer and assets
call npm run build
if errorlevel 1 (
  echo [FAIL] compile failed, nothing was packaged
  exit /b 1
)
echo [ OK ] compiled
echo.

rem -- Windows portable + installer -------------------------------------------
if /i "%TARGET%"=="deck" goto :deck

echo [....] packaging Windows portable and installer
call npx electron-builder --win nsis portable --x64 --publish never
if errorlevel 1 (
  set "WIN_RESULT=FAILED"
  echo [FAIL] Windows packaging failed
) else (
  set "WIN_RESULT=ok"
  echo [ OK ] Windows packages built
)
echo.

if /i "%TARGET%"=="win" goto :summary

rem -- Steam Deck AppImage -----------------------------------------------------
rem  This one cannot be built natively on Windows. electron-builder squashes the
rem  AppImage with mksquashfs, and the copy it caches is a Linux binary Windows
rem  cannot execute - it fails with a confusing "file does not exist". So the
rem  build is handed to WSL, which has a real mksquashfs and can see the project
rem  through /mnt/c. The Windows packages are already on disk by this point, so
rem  a machine without WSL still gets those.
:deck
echo [....] packaging Steam Deck AppImage (x64)

where wsl.exe >nul 2>&1
if errorlevel 1 (
  set "DECK_RESULT=FAILED - no WSL"
  echo [FAIL] AppImage needs WSL, which is not installed.
  echo        Install it with:  wsl --install -d Ubuntu
  goto :summary
)

wsl.exe -d Ubuntu -- bash -lc "command -v mksquashfs >/dev/null" >nul 2>&1
if errorlevel 1 (
  set "DECK_RESULT=FAILED - no mksquashfs in WSL"
  echo [FAIL] WSL is present but mksquashfs is missing.
  echo        Install it with:  wsl -d Ubuntu -- sudo apt install squashfs-tools
  goto :summary
)

set "WSLPATH=/mnt/c%CD:~2%"
set "WSLPATH=%WSLPATH:\=/%"
wsl.exe -d Ubuntu -- bash -lc "cd '%WSLPATH%' && npx electron-builder --linux AppImage --x64 --publish never"
if errorlevel 1 (
  set "DECK_RESULT=FAILED"
  echo [FAIL] AppImage packaging failed inside WSL
) else (
  set "DECK_RESULT=ok"
  echo [ OK ] Steam Deck AppImage built
)
echo.

rem -- summary -----------------------------------------------------------------
:summary
echo ===========================================================
echo   Results for !VERSION!
echo     Windows portable + installer : !WIN_RESULT!
echo     Steam Deck AppImage          : !DECK_RESULT!
echo ===========================================================
if exist "release\" (
  echo.
  echo   Packages in release\:
  for %%f in ("release\*.exe" "release\*.AppImage") do (
    if exist "%%~f" echo     %%~nxf   %%~zf bytes
  )
)
echo.

if /i "!WIN_RESULT!"=="FAILED" exit /b 1
if /i "!DECK_RESULT!"=="FAILED" exit /b 1
exit /b 0
