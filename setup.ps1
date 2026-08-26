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

<#
  `docker info` writes to stderr while the engine is down, and Windows
  PowerShell turns native stderr into an ErrorRecord that $ErrorActionPreference
  = 'Stop' makes terminating. That killed the script on its first probe, so the
  60-second wait this function exists for never happened. start.ps1 already
  stands the preference down around its own probe; do the same here.
#>
function Test-DockerEngine {
  $previousNativePreference = $PSNativeCommandUseErrorActionPreference
  $previousErrorPreference = $ErrorActionPreference
  $PSNativeCommandUseErrorActionPreference = $false
  $ErrorActionPreference = 'Continue'
  try {
    docker info *> $null
    return ($LASTEXITCODE -eq 0)
  } finally {
    $PSNativeCommandUseErrorActionPreference = $previousNativePreference
    $ErrorActionPreference = $previousErrorPreference
  }
}

function Wait-DockerEngine([int]$timeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    if (Test-DockerEngine) { return }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw @'
Docker Desktop is installed, but its Linux engine is not ready.
Open Docker Desktop, wait until the engine is running, then run setup.ps1 again.
PostgreSQL, Redis and MinIO cannot start until Docker is available.
'@
}

<#
  `npm ci` deletes node_modules wholesale before it installs. A node process
  still running out of this folder holds
  apps\web\node_modules\@next\swc-win32-x64-msvc\next-swc.win32-x64-msvc.node
  open; the unlink fails EPERM and the tree is left half-removed, so the next
  start.ps1 reports missing dependencies. start.ps1 launches the web process
  with no window, which makes the usual culprit one nobody can see. Name it
  before npm starts deleting rather than after.
#>
function Get-RepoNodeProcesses {
  $pattern = [regex]::Escape($projectRoot)
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern })
  } catch {
    return @()
  }
}

function Assert-NoRepoNodeProcesses {
  $running = Get-RepoNodeProcesses
  if ($running.Count -eq 0) { return }
  $owners = ($running | ForEach-Object { "PID $($_.ProcessId)" }) -join ', '
  throw @"
Node is still running out of this folder ($owners). It holds files that npm has
to delete, and installing now would leave node_modules half-removed. Stop it:
  powershell -ExecutionPolicy Bypass -File .\stop.ps1
Close any editor or terminal open inside the project, then run setup.ps1 again.
"@
}

<#
  Skip the reinstall when node_modules already matches package-lock.json. This
  script is the documented recovery from any failed step, and a full `npm ci`
  costs several minutes and is the step most likely to fail for reasons that
  have nothing to do with the step that actually failed.
#>
$lockFile = Join-Path $webRoot 'package-lock.json'
$stampFile = Join-Path $webRoot 'node_modules\.setup-lock-hash'
# The same two binaries start.ps1 checks, so setup never calls a tree current
# that start.ps1 will then reject.
$requiredBinaries = @(
  (Join-Path $webRoot 'node_modules\.bin\prisma.cmd'),
  (Join-Path $webRoot 'node_modules\next\dist\bin\next')
)

function Get-LockHash { return (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash }

function Test-DependenciesCurrent {
  if (-not (Test-Path -LiteralPath $stampFile)) { return $false }
  if ($requiredBinaries | Where-Object { -not (Test-Path -LiteralPath $_) }) { return $false }
  $stamp = Get-Content -LiteralPath $stampFile -Raw
  if (-not $stamp) { return $false }
  return ($stamp.Trim() -eq (Get-LockHash))
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
  if (Test-DependenciesCurrent) {
    Write-Host 'Dependencies already match package-lock.json. Skipping npm ci.'
  } else {
    Assert-NoRepoNodeProcesses
    npm ci
    if ($LASTEXITCODE -eq -4048) {
      throw @'
npm could not delete a file inside node_modules (EPERM).
Something this script cannot see has it open - antivirus scanning the folder,
an editor indexing it, or a node process started outside the project path.
Close those and run setup.ps1 again. Nothing needs undoing first: npm ci
rebuilds node_modules from package-lock.json on every run.
'@
    }
    Assert-NativeSuccess 'npm dependency installation'
    Set-Content -LiteralPath $stampFile -Value (Get-LockHash) -Encoding ascii
  }
  docker compose -p master-saas -f infra/docker-compose.yml up -d postgres redis minio
  Assert-NativeSuccess 'Docker infrastructure startup'
  node scripts/wait-for-db.mjs
  Assert-NativeSuccess 'PostgreSQL readiness check'
  npm run db:deploy
  Assert-NativeSuccess 'Database migration'

  <#
    The seed's third gate is the operator saying so, per run - see the comment
    block at the top of prisma/seed/index.ts. This script cannot answer that on
    the operator's behalf, so it asks and passes the answer to that one child
    process. Putting ALLOW_DEMO_SEED in .env would answer it permanently, which
    is the thing the gate exists to prevent.
  #>
  $seedAnswer = Read-Host 'Seed the demo workspace? It creates dozens of active logins in the local database (y/N)'
  if ($seedAnswer -match '^\s*(y|yes)\s*$') {
    $env:ALLOW_DEMO_SEED = 'yes'
    try {
      npm run db:seed
      Assert-NativeSuccess 'Unified platform seed'
    } finally {
      Remove-Item -LiteralPath Env:\ALLOW_DEMO_SEED -ErrorAction SilentlyContinue
    }
    $seeded = $true
  } else {
    $seeded = $false
  }
} finally { Pop-Location }

if ($seeded) {
  Write-Host 'Setup complete. HRMS and Sales now use the same PostgreSQL workspace database.'
  Write-Host 'The demo account password is printed once in the seed output above and is stored nowhere.'
} else {
  Write-Host 'Setup complete, without the demo workspace. The database has its schema but no accounts.'
  Write-Host 'Create the Platform Owner (it prints a one-time password), from apps\web:'
  Write-Host '  node scripts/bootstrap-owner.mjs'
  Write-Host 'Or seed the demo workspace later, from apps\web:'
  Write-Host '  $env:ALLOW_DEMO_SEED = ''yes''; npm run db:seed'
}
Write-Host 'Run: powershell -ExecutionPolicy Bypass -File .\start.ps1'
