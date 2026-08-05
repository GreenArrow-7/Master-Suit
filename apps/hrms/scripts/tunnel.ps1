# Expose the local HRMS over an HTTPS URL with Cloudflare Tunnel.
#
#   .\scripts\tunnel.ps1
#
# Why a tunnel and not just the LAN IP: browsers only allow the camera
# (getUserMedia) over HTTPS or on localhost. A plain http://192.168.x.x address
# silently blocks face check-in. cloudflared gives you a real https:// URL, so
# the camera works from any device on the network - phones included.
#
# The HRMS must already be running (run.bat) on port 8000.

param([int]$Port = 8000)
$ErrorActionPreference = "Stop"

function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# Check the app is actually up FIRST. A tunnel to a dead port is the 502
# "Host Error" Cloudflare shows - browser ok, Cloudflare ok, host down.
try {
    Invoke-WebRequest "http://localhost:$Port/health" -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
    Write-Host ""
    Write-Host "The HRMS is not running on http://localhost:$Port." -ForegroundColor Yellow
    Write-Host "That is what causes Cloudflare's 502 'Bad gateway - Host Error':" -ForegroundColor Yellow
    Write-Host "the tunnel works, but there is nothing behind it."
    Write-Host ""
    Write-Host "Open a FIRST window and start the app, leave it running:" -ForegroundColor Cyan
    Write-Host "    run.bat"
    Write-Host "Then run this tunnel in a SECOND window." -ForegroundColor Cyan
    exit 1
}

if (-not (Have cloudflared)) {
    Write-Host "cloudflared is not installed." -ForegroundColor Yellow
    if (Have winget) {
        Write-Host "Installing it with winget..." -ForegroundColor Cyan
        winget install --id Cloudflare.cloudflared -e --source winget
    } else {
        Write-Host ""
        Write-Host "Install it one of these ways, then re-run this script:"
        Write-Host "  winget install --id Cloudflare.cloudflared -e"
        Write-Host "  or download cloudflared.exe from:"
        Write-Host "  https://github.com/cloudflare/cloudflared/releases/latest" -ForegroundColor Cyan
        exit 1
    }
}

Write-Host ""
Write-Host "Starting a Cloudflare Tunnel to http://localhost:$Port" -ForegroundColor Green
Write-Host "Watch for the https://<random>.trycloudflare.com line below - that is"
Write-Host "your intranet URL. Share it on the network; the camera will work over it."
Write-Host "Leave this window open. Ctrl-C stops the tunnel."
Write-Host ""

# --http-host-header keeps the Host uvicorn sees as localhost, so same-origin
# cookies and redirects keep working through the tunnel.
cloudflared tunnel --url "http://localhost:$Port" --http-host-header "localhost:$Port"
