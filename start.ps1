$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Join-Path $projectRoot 'apps\web'
$runtimeRoot = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

function Assert-NativeSuccess([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." }
}

function Get-PortOwnerIds([int]$port) {
  $pattern = ":$port\s+.*LISTENING\s+(\d+)\s*$"
  return @(netstat -ano -p tcp | Select-String -Pattern $pattern | ForEach-Object {
    if ($_.Line -match $pattern) { [int]$Matches[1] }
  } | Sort-Object -Unique)
}

if (-not (Test-Path -LiteralPath (Join-Path $webRoot '.env'))) { throw 'Run setup.ps1 first.' }
$requiredCommands = @(
  (Join-Path $webRoot 'node_modules\.bin\prisma.cmd'),
  (Join-Path $webRoot 'node_modules\next\dist\bin\next')
)
if ($requiredCommands | Where-Object { -not (Test-Path -LiteralPath $_) }) {
  throw 'Project dependencies are missing or incomplete. Run .\setup.ps1, then run .\start.ps1 again.'
}

$portOwnerIds = @(Get-PortOwnerIds 3000)
if ($portOwnerIds.Count -gt 0) {
  $owners = $portOwnerIds | ForEach-Object {
    $process = Get-Process -Id $_ -ErrorAction SilentlyContinue
    if ($process) { "$($process.ProcessName) (PID $($_))" } else { "PID $($_)" }
  }
  throw "Port 3000 is already in use by $($owners -join ', '). Close that application, then run .\start.ps1 again."
}

$previousNativePreference = $PSNativeCommandUseErrorActionPreference
$previousErrorPreference = $ErrorActionPreference
$PSNativeCommandUseErrorActionPreference = $false
$ErrorActionPreference = 'Continue'
try {
  docker info *> $null
  $dockerExitCode = $LASTEXITCODE
} finally {
  $PSNativeCommandUseErrorActionPreference = $previousNativePreference
  $ErrorActionPreference = $previousErrorPreference
}
if ($dockerExitCode -ne 0) {
  throw 'Docker Desktop Linux engine is not running. Open Docker Desktop, wait until it reports Engine running, then run .\start.ps1 again.'
}

Push-Location $webRoot
try {
  docker compose -p master-saas -f infra/docker-compose.yml up -d postgres redis minio
  Assert-NativeSuccess 'Docker infrastructure startup'
  node scripts/wait-for-db.mjs
  Assert-NativeSuccess 'PostgreSQL readiness check'
  npm run db:deploy
  Assert-NativeSuccess 'Database migration'
} finally { Pop-Location }

$node = (Get-Command node -ErrorAction Stop).Source
$nextBin = Join-Path $webRoot 'node_modules\next\dist\bin\next'
$web = Start-Process -FilePath $node -ArgumentList "`"$nextBin`"",'dev','-p','3000' `
  -WorkingDirectory $webRoot -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $runtimeRoot 'web.out.log') `
  -RedirectStandardError (Join-Path $runtimeRoot 'web.err.log')

Start-Sleep -Seconds 2
if ($web.HasExited) {
  $errorLog = Join-Path $runtimeRoot 'web.err.log'
  $details = if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Raw } else { 'No error log was produced.' }
  throw "The web application could not start.`n$details"
}

$listenerIds = @()
for ($attempt = 1; $attempt -le 15; $attempt++) {
  $listenerIds = @(Get-PortOwnerIds 3000)
  if ($listenerIds.Count -gt 0) { break }
  Start-Sleep -Seconds 1
}
if ($listenerIds.Count -eq 0) {
  throw 'The web process started but did not bind to port 3000. Review .runtime\web.err.log.'
}

@{ web = $web.Id; listeners = $listenerIds } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'processes.json')
Write-Host 'Master SaaS is starting at http://localhost:3000'
Write-Host 'HRMS and Sales are modules in this application; no second customer service is started.'
