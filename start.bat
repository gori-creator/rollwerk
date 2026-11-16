@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
echo Sobald "Rollwerk laeuft" erscheint: http://localhost:5174 in Chrome oder Edge oeffnen.
call npm start
pause
