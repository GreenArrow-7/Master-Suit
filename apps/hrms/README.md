# Manath Homes HRMS

> **Master SaaS integration note:** this directory is now a private domain
> service. Customers open `http://localhost:3000` through the repository-level
> launcher. The port-8000 instructions below are retained only for isolated HRMS
> maintenance and migration testing; do not expose that port in deployment.

Attendance, leave and employee lifecycle for a UAE real-estate company.
FastAPI + SQLite (swap to PostgreSQL by changing one setting), server-side face
recognition, geofenced check-in, and UAE labour-law rules.

---

## Run it

### Windows
Double-click **`run.bat`**, or from PowerShell:
```powershell
.\run.ps1
```

If PowerShell says the script *"is not digitally signed"*, that's Windows'
default execution policy, not a problem with the project. Either use `run.bat`
(batch files aren't affected), or run:

```powershell
Get-ChildItem -Recurse | Unblock-File
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

`Unblock-File` matters because extracting a zip marks every file inside as
downloaded from the internet, which keeps it blocked even under `RemoteSigned`.

**Starting the server by hand** (venv already set up)? The module is
`app.main:app` — there is no `server.main`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### macOS / Linux
```bash
./run.sh
```

First run creates a virtual environment, installs dependencies, generates a
signing key, seeds the database and starts the server. **It prints a generated
admin password once — write it down.**

Then open **http://localhost:8000/login.html**

### Face check-in

Face recognition is **required**, not optional. PIN check-in was removed, so
face verification is the only way to record attendance. The packages are in
`requirements.txt` and the launcher installs them and downloads the models
(~275 MB) on first run. No C++ compiler is needed on any platform.

If something looks wrong, ask the app rather than guessing:

```powershell
.\.venv\Scripts\python.exe scripts\check_face_setup.py    # Windows
./.venv/bin/python scripts/check_face_setup.py             # macOS / Linux
```

It prints which interpreter it is using, whether each package imports, whether
the models are present, and the exact command to fix anything missing.

**Run pip only through the venv.** A bare `pip` usually belongs to a different
Python installation. If that other interpreter is 3.14, several dependencies
have no wheel for it yet and pip will try to compile them from source and fail
(`zlib` headers for pillow, a PyO3 version ceiling for pydantic-core). That
failure says nothing about this project — it just means the wrong interpreter
was used. The venv is built on a supported version automatically.

To rebuild the environment from scratch:

```
run.bat -Recreate           # Windows
./run.sh --recreate         # macOS / Linux
```

**Camera access needs a secure context.** Browsers only grant `getUserMedia`
over HTTPS or on `localhost`. Reaching the app on a LAN address such as
`192.168.1.20:8000` will block the camera no matter how the server is
configured, so put TLS in front of it before staff use it.

### Tests
```powershell
.\run.ps1 -Test        # Windows
./run.sh --test        # macOS / Linux
```
**189 tests.** The face-model tests skip automatically if models aren't downloaded.

### Manual commands, if you'd rather not use the scripts
```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt          # Windows: .venv\Scripts\pip
cp .env.example .env                               # then set JWT_SECRET
export SEED_ADMIN_PASSWORD='choose-something-long'
.venv/bin/python seed.py
.venv/bin/python scripts/download_models.py        # optional, for face check-in
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API documentation is at **/docs** while the server runs.

---

## Sharing it on the network (and making the camera work)

Browsers only allow camera access over **HTTPS or `localhost`**. So face
check-in works on the machine running the server, but a colleague reaching it at
`http://192.168.1.20:8000` gets a blocked camera. A tunnel gives you a real
`https://` URL that works from any device on the network, phones included.

Start the HRMS (`run.bat`) and **leave it running**. Then in a **second**
window:

```
tunnel.bat                   # Windows  (double-click works too)
./scripts/tunnel.sh          # macOS / Linux
```

Use `tunnel.bat`, not `.\scripts\tunnel.ps1` directly - PowerShell blocks
unsigned `.ps1` files by default ("cannot be loaded ... is not digitally
signed"). The `.bat` wrapper bypasses that, exactly like `run.bat`.

**If you see Cloudflare's "Bad gateway - Host Error" (502):** the tunnel is
fine, but nothing is running on port 8000. Start the app with `run.bat` in the
first window before starting the tunnel. The tunnel script now checks for this
and tells you rather than opening a dead URL.

It installs `cloudflared` if needed, checks the app is up, and prints a
`https://<random>.trycloudflare.com` URL. Share that on the intranet. Ctrl-C
stops it.

This uses Cloudflare's free quick-tunnel: no account, no domain, a throwaway URL
each run. Fine for testing and small internal use. For a stable address and
access controls, register a named tunnel with a Cloudflare account and put it
behind Cloudflare Access - out of scope here, but this is the on-ramp.

## What's in it

| Module | State |
|---|---|
| Auth, RBAC, refresh-token rotation, forced password change | done |
| User administration: directory, password resets, roles, suspend, unlock | done |
| Attendance: server-side face match, challenge-response liveness, geofence, encrypted capture vault | done |
| Leave: accrual, approval chain, carry-forward, UAE holidays | done |
| Onboarding / offboarding: checklists, documents, gratuity, final settlement | done |
| Commission tracking, agent KPIs | not built |
| Payroll, WPS SIF export, payslips | not built |

---

## Forgotten the admin password?

`seed.py` only ever **creates** an admin — re-running it with a different
`SEED_ADMIN_PASSWORD` will NOT change an existing password. It prints
`admin already exists` and leaves the password alone, by design: a seed script
that silently resets credentials every run is a foot-gun.

To actually change it:

```powershell
.\.venv\Scripts\python.exe reset_admin.py
```

It prompts for the new password (never echoed, never in shell history), clears
any lockout, and signs out existing sessions. Add `--clear-2fa` if the
authenticator is on a phone you no longer have, or `--email someone@manathhomes.ae`
to reset a different account.

Locked out with `429 Too Many Requests`? That's five failed attempts inside the
lockout window. `reset_admin.py` clears it, or just wait 15 minutes.

## Managing users

Sign in as the admin created by `seed.py`, then open **Users** in the top nav
(visible to HR and admins only).

| Action | Who can do it |
|---|---|
| Add a user, set their role | HR and admin (only an admin can create an admin) |
| Reset someone's password | HR and admin |
| Unlock an account after 5 failed sign-ins | HR and admin |
| Suspend or restore an account | HR and admin |
| Change someone's role | **admin only** |
| Change your own password | everyone |

**The rule that governs all of it: you can never act on an account that outranks
you.** HR administers employees and managers; only an admin can touch another
admin. Without that, HR could reset the admin password and simply become admin,
and the role split would be decoration. The last active admin can't be demoted or
suspended either — otherwise the system locks itself out.

Every new account and every reset issues a *temporary* password. The user is
forced to set their own at next sign-in, and nothing else in the system opens
until they do. Password resets also revoke all existing sessions — if an account
was taken over, leaving the attacker's refresh token alive makes the reset
pointless.

### From the command line

```bash
# sign in
curl -s -X POST localhost:8000/api/auth/login \
  -d "username=admin@manathhomes.ae&password=YOUR_PASSWORD"

TOKEN="paste-the-access_token"

# add a user
curl -s -X POST localhost:8000/api/auth/employees \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"employee_code":"AGT-014","full_name":"Nadia Kassem",
       "work_email":"nadia@manathhomes.ae","role":"employee",
       "department":"Brokerage","date_of_joining":"2026-08-01",
       "temporary_password":"Temporary-Pass-2026!"}'

# reset a password (employee id 7)
curl -s -X POST localhost:8000/api/auth/employees/7/reset-password \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"temporary_password":"NewTemporary-2026!"}'

# unlock, suspend, change role
curl -s -X POST localhost:8000/api/auth/employees/7/unlock -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:8000/api/auth/employees/7/active \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"is_active":false,"reason":"Under investigation"}'
curl -s -X POST localhost:8000/api/auth/employees/7/role \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"role":"manager"}'
```

Temporary passwords are shown once, in the browser, at the moment you create or
reset. Hand them over in person or by phone — not email, and not WhatsApp.

---

## The three decisions worth defending

**1. Face processing runs on the server, not the browser.**
The earlier design had the browser compute the face embedding and post it. That
makes a punch nothing more than a vector in a JSON body — capture it once and you
can replay it from a beach in Goa forever. The camera frame now goes to the server,
which does detection, liveness and matching where the client can't reach it. It
costs a few hundred milliseconds and some bandwidth. Worth it.

**2. Liveness is challenge-response, and the server picks the challenge.**
The server randomly asks for a head turn left, right or up. The client sends a
neutral frame and a moved frame. We verify the pose actually changed in the
direction asked, that it's the same person in both frames, and that the bytes
differ. A client-chosen challenge is not a challenge — the attacker just always
picks the one they recorded earlier.

**3. Everything fails closed.**
No models, no attendance — a 503 naming exactly what is missing, never a wave-through.
No consent, no biometrics. Blocking onboarding step open, no activation. Clearance
incomplete, no exit. A system that degrades to "allow" under failure is worse than
no system, because people trust it.

---

## Two things that are honestly limited

**1. Liveness is not certified presentation-attack detection.**
It stops a held-up photo, a static screen and a face swapped between frames. It
will not reliably stop a high-quality video replay on a good screen, and it has
not been tested against 3D masks. If you need a real guarantee, buy an
iBeta Level 1/2 certified SDK and put it behind the same interface. Everything
else in the pipeline stays as it is.

**2. Documents aren't encrypted at rest.**
Uploads get generated filenames, magic-byte content sniffing, path-traversal
protection, HR-only access and an audit entry per download. The bytes themselves
sit unencrypted on disk. On a single trusted server that's tolerable. Before this
touches cloud storage, put it on encrypted volumes or S3 with SSE-KMS.

---

## Before it goes live

1. **Set real coordinates.** `seed.py` has placeholder lat/long for both sites.
   Stand in each office, read your phone's GPS, use those numbers.
2. **Tune the face threshold.** `FACE_MATCH_THRESHOLD=0.55` is a starting point.
   Enrol ten staff, have them check in across a week, look at the score
   distribution in the review queue, then adjust.
3. **Check the agent department list.** `AGENT_DEPARTMENTS` in
   `app/services/lifecycle.py` decides who gets the RERA onboarding track. If your
   departments are named differently, agents silently miss their BRN steps.
4. **Have a UAE labour lawyer review the calculations.** Gratuity, leave
   encashment and notice pay are implemented from Decree-Law 33/2021 as I read it.
   I am not your lawyer. The edge cases — termination versus resignation, unpaid
   leave during the qualifying period, contract-specific notice terms — are where
   money and disputes live.
5. **Add lunar holidays every year.** Eid al-Fitr, Eid al-Adha, Islamic New Year
   and Mawlid shift with the moon. The seed only has fixed Gregorian dates.
6. **Move to PostgreSQL past about 50 staff.** SQLite will start locking on
   concurrent morning punches.
7. **Put it behind HTTPS.** Face frames and passport scans over plain HTTP is not
   a defensible position.

---

## Layout

```
manath-homes/
├─ app/
│  ├─ core/          config, database, security
│  ├─ models/        SQLAlchemy models
│  ├─ services/      face, rules, leave, lifecycle, documents
│  ├─ api/           auth, attendance, leave, lifecycle
│  └─ main.py
├─ web/              login, check-in, leave, people, password
├─ tests/            189 tests
├─ scripts/          download_models.py
├─ seed.py  reset_admin.py  run.bat  run.ps1  run.sh  .env.example
├─ requirements.txt          core - no compiler needed
├─ requirements-face.txt     optional face recognition
```

## PDPL notes

- Face templates are 512-float embeddings. Raw images are never stored.
- Biometric consent is recorded with a timestamp and can be withdrawn; withdrawal
  deletes the templates immediately.
- Finalising an exit revokes all sessions and deletes all biometric data in one
  transaction — retaining it after employment has no lawful basis.
- Every document download is written to the audit log with actor and IP.
