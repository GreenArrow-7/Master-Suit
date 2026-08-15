@echo off
setlocal
rem ────────────────────────────────────────────────────────────────────────────
rem  Master Suite demo launcher.
rem
rem  Double-click this after a reboot (or any time the app is down) and wait
rem  for "Ready". It brings up, in order:
rem    1. Docker Desktop (postgres / redis / minio / mailpit live in it)
rem    2. The database containers
rem    3. The web app on http://localhost:3000 (production build; builds it
rem       first if the artefact is missing — that first build takes a few
rem       minutes, later starts are seconds)
rem
rem  Keep this window open: closing it stops the web app (the database keeps
rem  running in Docker). Rebuild after changing source with:
rem      npm run start:local -- --build     (from apps\web)
rem ────────────────────────────────────────────────────────────────────────────
cd /d "%~dp0apps\web"

echo [1/4] Checking Docker...
docker info >nul 2>&1
if errorlevel 1 (
  echo        Docker engine is not running - starting Docker Desktop...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  echo        Waiting for the engine (this can take a minute)...
  :wait_docker
  timeout /t 5 /nobreak >nul
  docker info >nul 2>&1
  if errorlevel 1 goto wait_docker
)
echo        Docker is up.

echo [2/4] Starting database containers...
call npm run --silent docker:up
if errorlevel 1 (
  echo        Failed to start containers. Is another program using port 5432?
  pause
  exit /b 1
)

echo [3/4] Waiting for PostgreSQL...
node scripts\wait-for-db.mjs
if errorlevel 1 (
  echo        The database did not come up. Check: docker compose -p master-saas logs postgres
  pause
  exit /b 1
)

echo [4/4] Starting the app on http://localhost:3000 ...
echo        (first run builds the production bundle - a few minutes)
call npm run start:local
pause
