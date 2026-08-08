$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Join-Path $projectRoot 'apps\web'

function New-Secret([int]$bytes = 48) {
  $buffer = New-Object byte[] $bytes
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($buffer)
}

function Assert-NativeSuccess([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE. Review the output above and run setup again." }
}

function Wait-DockerEngine([int]$timeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw @'
Docker Desktop is installed, but its Linux engine is not ready.
Open Docker Desktop, wait until the engine is running, then run setup.ps1 again.
PostgreSQL, Redis and MinIO cannot start until Docker is available.
'@
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or newer is required.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required.' }
Write-Host 'Waiting for the Docker Desktop Linux engine...'
Wait-DockerEngine
Write-Host 'Docker engine is ready.'

$webEnv = Join-Path $webRoot '.env'
if (-not (Test-Path -LiteralPath $webEnv)) {
  $ownerPasswordSecure = Read-Host 'Initial platform owner password (16+ characters)' -AsSecureString
  $ownerPasswordPlain = [System.Net.NetworkCredential]::new('', $ownerPasswordSecure).Password
  if ($ownerPasswordPlain.Length -lt 16) { throw 'The platform owner password must contain at least 16 characters.' }
  $template = Get-Content -LiteralPath (Join-Path $webRoot '.env.example') -Raw
  $template = $template -replace 'FIELD_ENCRYPTION_KEY=.*', "FIELD_ENCRYPTION_KEY=$(New-Secret 32)"
  $template = $template -replace 'WEBHOOK_SIGNING_PEPPER=.*', "WEBHOOK_SIGNING_PEPPER=$(New-Secret 32)"
  $template = $template.Replace('PLATFORM_OWNER_PASSWORD=CHANGE_ME_AT_LEAST_16_CHARS', "PLATFORM_OWNER_PASSWORD=$ownerPasswordPlain")
  Set-Content -LiteralPath $webEnv -Value $template -Encoding utf8
  $ownerPasswordPlain = $null
}

Push-Location $webRoot
try {
  npm ci
  Assert-NativeSuccess 'npm dependency installation'
  docker compose -p master-saas -f infra/docker-compose.yml up -d postgres redis minio
  Assert-NativeSuccess 'Docker infrastructure startup'
  node scripts/wait-for-db.mjs
  Assert-NativeSuccess 'PostgreSQL readiness check'
  npm run db:deploy
  Assert-NativeSuccess 'Database migration'
  npm run db:seed
  Assert-NativeSuccess 'Unified platform seed'
} finally { Pop-Location }

Write-Host 'Setup complete. HRMS and Sales now use the same PostgreSQL workspace database.'
Write-Host 'Run: powershell -ExecutionPolicy Bypass -File .\start.ps1'
