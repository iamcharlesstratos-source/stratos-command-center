@echo off
cd /d "%~dp0"
title STRATOS AI Proxy (FREE / Groq)

if exist ".ai_key" goto run

echo.
echo  ============================================================
echo   FIRST-TIME SETUP  -  free AI for the hook generator
echo  ============================================================
echo.
echo   1. Get a FREE Groq API key (no credit card needed):
echo        https://console.groq.com/keys
echo      (Sign up - API Keys - Create Key - copy it, starts with gsk_)
echo.
set /p AIKEY=  2. Paste your Groq key here and press Enter:
echo.
if "%AIKEY%"=="" (
  echo   No key entered. Try again.
  echo.
  pause
  exit /b 1
)
>.ai_key echo %AIKEY%
echo   Saved to .ai_key  -  you only do this once.
echo.

:run
echo  ============================================================
echo   STRATOS AI proxy is starting...
echo   URL: http://localhost:8787/ai   (FREE via Groq)
echo.
echo   KEEP THIS WINDOW OPEN while using the app.
echo   Close it to stop the AI proxy.
echo  ============================================================
echo.
node server.js
echo.
echo  Proxy stopped. Press any key to close.
pause >nul
