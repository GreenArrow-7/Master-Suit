$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $projectRoot '.runtime\processes.json'
if (Test-Path -LiteralPath $pidFile) {
  $processes = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  $processIds = @($processes.listeners) + @($processes.web) | Where-Object { $_ } | Sort-Object -Unique
  foreach ($processId in $processIds) {
    if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $processId
    }
  }
  Remove-Item -LiteralPath $pidFile -Force
}
Write-Host 'Application stopped. PostgreSQL, Redis and MinIO remain available for the next start.'
