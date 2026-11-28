@echo off
rem Arraste um arquivo .ifc sobre este atalho para gerar o .agrega3d ao lado dele.
chcp 65001 >nul
node --max-old-space-size=8192 "%~dp0converter-ifc.ts" %*
pause
