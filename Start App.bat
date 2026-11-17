@echo off
title Vastra Books
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First start: installing. This needs internet and takes a few minutes...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist dist\index.html (
  echo Building the screens...
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

call npm start
pause
