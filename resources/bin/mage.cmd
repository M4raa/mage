@echo off
rem Lanzador de la terminal de Mage (F7.4): el propio Mage.exe en modo Node ejecuta el cliente empaquetado.
rem No hace falta Node instalado. `setlocal` impide que la variable se quede en la consola de quien lo llama.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\Mage.exe" "%~dp0..\cli\mage.mjs" %*
exit /b %ERRORLEVEL%
