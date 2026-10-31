@echo off
cd /d "%~dp0"
if not exist "node_modules" (
  echo Instalando dependencias, un momento...
  call npm install
)
echo Iniciando la app... (puede tardar unos segundos, se abrira sola en el navegador)
call npm start
if errorlevel 1 (
  echo.
  echo Hubo un error al iniciar. Copia el mensaje de arriba y mandaselo a Claude.
  pause
)
