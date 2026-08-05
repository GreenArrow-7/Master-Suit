# Manath Homes HRMS - one-command setup and run (Windows PowerShell)
#
#   .\run.ps1              first run: install everything, seed, start server
#   .\run.ps1 -SkipSetup   start faster once installed
#   .\run.ps1 -Test        run the test suite
#   .\run.ps1 -Models      re-download the face recognition models (~275 MB)
#   .\run.ps1 -Recreate    rebuild the virtual environment from scratch

param([switch]$SkipSetup, [switch]$Test, [switch]$Models, [switch]$Recreate)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Say  ($m) { Write-Host "==> $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "!!  $m" -ForegroundColor Yellow }
function Fail ($m) { Write-Host ""; Write-Host "!!  $m" -ForegroundColor Red; exit 1 }

# $ErrorActionPreference does NOT stop the script when a native .exe returns a
# non-zero exit code, so every external call has to be checked by hand. Without
# this the script sails past a failed pip install and starts a broken server.
function Assert-LastExit ($what) {
    if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE). Nothing else was changed." }
}

# ---------------------------------------------------------------------------
# Find a usable Python
#
# Upper bound is deliberate: pydantic-core and onnxruntime publish
# prebuilt wheels only up to 3.13. On 3.14 pip tries to compile pydantic-core
# from Rust source and fails, because PyO3 0.22 doesn't support 3.14 either.
# 3.12 is the sweet spot - every dependency here has a wheel for it.
# ---------------------------------------------------------------------------
$MinVersion = [version]"3.10"
$MaxVersion = [version]"3.14"   # exclusive

function Get-PyVersion ($exe, $preArgs) {
    try {
        $out = & $exe @preArgs -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
        return [version]($out.Trim())
    } catch { return $null }
}

function Find-Python {
    # Preferred order: known-good versions first, then whatever's on PATH.
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in @("3.12", "3.11", "3.13", "3.10")) {
            $candidates += ,@("py", @("-$v"))
        }
    }
    foreach ($c in @("python", "python3")) {
        if (Get-Command $c -ErrorAction SilentlyContinue) { $candidates += ,@($c, @()) }
    }

    $rejected = @()
    foreach ($cand in $candidates) {
        $ver = Get-PyVersion $cand[0] $cand[1]
        if ($null -eq $ver) { continue }
        if ($ver -ge $MinVersion -and $ver -lt $MaxVersion) {
            return @{ Exe = $cand[0]; PreArgs = $cand[1]; Version = $ver }
        }
        $rejected += "$($cand[0]) $($cand[1] -join ' ') -> $ver"
    }

    if ($rejected.Count) {
        Write-Host ""
        Write-Host "!!  Found Python, but no supported version." -ForegroundColor Red
        $rejected | Select-Object -Unique | ForEach-Object { Write-Host "      $_" }
        Write-Host ""
        Write-Host "    This project needs Python 3.10, 3.11, 3.12 or 3.13."
        Write-Host "    Python 3.14 is too new: pydantic-core has no wheel for it yet, so pip"
        Write-Host "    tries to compile it from Rust source and fails."
        Write-Host ""
        Write-Host "    Install 3.12 alongside what you have - it won't replace it:"
        Write-Host "      https://www.python.org/downloads/release/python-3128/" -ForegroundColor Cyan
        Write-Host "    Tick 'Add python.exe to PATH' during setup, then run this script again."
        exit 1
    }

    Fail ("Python was not found on your PATH.`n" +
          "    Install Python 3.12 from https://www.python.org/downloads/ and tick`n" +
          "    'Add python.exe to PATH' during setup, then run this again.")
}

$py = ".\.venv\Scripts\python.exe"

# A virtual environment built by an unsupported interpreter can't be repaired -
# it has to go. This is what happened if you hit the 3.14 build error before.
if ((Test-Path $py) -and -not $Recreate) {
    $venvVer = Get-PyVersion $py @()
    if ($null -eq $venvVer -or $venvVer -lt $MinVersion -or $venvVer -ge $MaxVersion) {
        Warn "The existing .venv uses Python $venvVer, which isn't supported. Rebuilding it."
        $Recreate = $true
    }
}

if ($Recreate -and (Test-Path ".venv")) {
    Say "Removing the old virtual environment"
    Remove-Item -Recurse -Force ".venv"
}

if (-not (Test-Path $py)) {
    $found = Find-Python
    Say "Using Python $($found.Version) ($($found.Exe) $($found.PreArgs -join ' '))"
    Say "Creating virtual environment"
    & $found.Exe @($found.PreArgs) -m venv .venv
    Assert-LastExit "Creating the virtual environment"
    $SkipSetup = $false   # a brand-new venv always needs dependencies
}

if (-not (Test-Path $py)) { Fail "The virtual environment was created but $py is missing." }

if (-not $SkipSetup) {
    Say "Installing dependencies (first run takes a few minutes)"
    & $py -m pip install --upgrade pip --quiet
    Assert-LastExit "Upgrading pip"
    & $py -m pip install -r requirements.txt
    Assert-LastExit "Installing dependencies"

    & $py -c "import fastapi, sqlalchemy, uvicorn, pydantic" 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "Dependencies reported success but won't import. Try: .\run.ps1 -Recreate" }

    # Face recognition is mandatory now that PIN check-in is gone: without it
    # nobody can record attendance at all. Catch it here rather than letting
    # staff discover it at the door.
    & $py -c "import cv2, onnxruntime" 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "opencv/onnxruntime installed but won't import. Try: .\run.ps1 -Recreate" }
    Say "Dependencies installed"
}

# Models are required, not an extra. Fetch them on first run automatically.
$modelDir = Join-Path $env:USERPROFILE ".insightface\models\buffalo_l"
$haveModels = (Test-Path (Join-Path $modelDir "det_10g.onnx")) -and `
              (Test-Path (Join-Path $modelDir "w600k_r50.onnx"))
if ($Models -or -not $haveModels) {
    Say "Downloading face recognition models (about 275 MB, one time)"
    & $py scripts\download_models.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Warn "The face models could not be downloaded."
        Warn "Attendance CANNOT be recorded until they are present - there is no PIN fallback."
        Write-Host "    Retry with:  .\run.ps1 -Models" -ForegroundColor Cyan
        Write-Host "    Diagnose:    .\.venv\Scripts\python.exe scripts\check_face_setup.py" -ForegroundColor Cyan
        Write-Host ""
    }
}

if (-not (Test-Path ".env")) {
    Say "Creating .env with a generated signing key"
    $secret = & $py -c "import secrets;print(secrets.token_urlsafe(48))"
    Assert-LastExit "Generating a signing key"
    (Get-Content ".env.example") -replace "replace-me-with-64-random-characters", $secret |
        Set-Content ".env"
}

if ($Test) {
    Say "Running tests"
    & $py -m pytest tests -q
    exit $LASTEXITCODE
}

if (-not (Test-Path "manath_homes.db")) {
    Say "Seeding database"
    if (-not $env:SEED_ADMIN_PASSWORD) {
        $env:SEED_ADMIN_PASSWORD = & $py -c "import secrets;print(secrets.token_urlsafe(16))"
        Assert-LastExit "Generating an admin password"
    }
    if (-not $env:SEED_ADMIN_EMAIL) { $env:SEED_ADMIN_EMAIL = "admin@manathhomes.ae" }

    & $py seed.py
    Assert-LastExit "Seeding the database"

    Write-Host ""
    Warn "Sign in as $env:SEED_ADMIN_EMAIL"
    Warn "Admin password: $env:SEED_ADMIN_PASSWORD"
    Warn "Write this down now - it is not stored anywhere."
    Write-Host ""
}

Say "Starting Manath Homes HRMS"
Write-Host "    App   http://localhost:8000/login.html"
Write-Host "    API   http://localhost:8000/docs"
Write-Host ""
& $py -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
