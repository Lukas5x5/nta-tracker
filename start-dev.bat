@echo off
echo ========================================
echo NTA - Development Mode
echo ========================================
echo.

echo [1/4] Stopping old processes...
powershell "Get-Process | Where-Object {$_.ProcessName -eq 'node' -or $_.ProcessName -eq 'electron'} | ForEach-Object { Stop-Process -Id $_.Id -Force }" 2>nul
timeout /t 2 /nobreak >nul

echo [2/4] Cleaning dist folder...
if exist dist rd /s /q dist

echo [3/4] Building TypeScript...
call npm run build:main
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo [4/4] Starting Vite dev server and Electron...
echo.
echo ========================================
echo Starting development environment...
echo Press Ctrl+C to stop
echo ========================================
echo.

start /B cmd /c "npm run dev"
timeout /t 5 /nobreak >nul

set NODE_ENV=development
npx electron .
