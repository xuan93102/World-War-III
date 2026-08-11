@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies, please wait...
    call npm install
)

echo.
echo Starting the game server...
echo Your browser will open automatically.
echo Keep this window open while playing. Close it to stop the game.
echo.

start "" http://localhost:5173
call npm run dev
