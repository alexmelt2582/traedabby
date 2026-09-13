@echo off
setlocal
cd /d "%~dp0.."
node src\launcher.js %*
if errorlevel 1 pause

