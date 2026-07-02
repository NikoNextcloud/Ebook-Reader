@echo off
cd /d "%~dp0"
set "PATH=%~dp0..\.runtime\node-v24.18.0-win-x64;%PATH%"
if not exist node_modules (
  echo Installing Voxora dependencies...
  call "..\.runtime\node-v24.18.0-win-x64\npm.cmd" install
)
call "..\.runtime\node-v24.18.0-win-x64\npm.cmd" run dev
