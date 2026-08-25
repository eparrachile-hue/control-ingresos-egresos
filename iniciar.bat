@echo off
cd /d "%~dp0"
if not exist "node_modules" (
  echo Instalando dependencias, un momento...
  call npm install
)
call npm start
