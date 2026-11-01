@echo off
rem Double-click to start chatAK12: checks Ollama and the model, builds, starts and opens the app.
title chatAK12
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get version 24 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)

node -e "process.exit(parseInt(process.version.slice(1)) < 24 ? 1 : 0)"
if errorlevel 1 (
  echo chatAK12 needs Node.js 24 or newer. Get it from https://nodejs.org and try again.
  pause
  exit /b 1
)

node --disable-warning=ExperimentalWarning scripts\launch.ts %*
rem Keep the window open on errors so the message can be read.
if errorlevel 1 pause
