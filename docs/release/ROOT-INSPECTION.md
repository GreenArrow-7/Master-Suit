# Root inspection — one copy-paste block (prints no secret)

Run as root on `mastersuite-prod-01`; paste the output back unchanged. Every line is a name,
a number, a hash prefix, or one of SET / UNSET / PRESENT / ABSENT / SAME / DIFFERENT / NOT VERIFIED.

```bash
cd /opt/mastersuite/apps/web && python3 - <<'PY'
import os, re, hashlib, subprocess, urllib.parse as up, glob
def sha(s): return hashlib.sha256(s.encode()).hexdigest()[:12]
def kv(path):
    d = {}
    try:
        for line in open(path, encoding='utf-8', errors='replace'):
            m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line.rstrip('\n'))
            if m: d[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    except FileNotFoundError:
        return None
    return d
env = kv('.env.production') or {}
bk = kv('/etc/master-suite/backup.env')

print('== 1. backup policy')
if bk is None:
    print('backup.env: ABSENT -> retention/encryption/off-host: NOT VERIFIED (may be configured elsewhere)')
else:
    for k in ('BACKUP_RETENTION_DAYS', 'BACKUP_KEEP_MIN'):
        print(f'{k}: {bk[k] if k in bk and bk[k] else "UNSET (script default applies)"}')
    for k in ('BACKUP_PASSPHRASE', 'BACKUP_REMOTE'):
        print(f'{k}: {"SET" if bk.get(k) else "UNSET in backup.env -> NOT VERIFIED"}')
runs = sorted(d for d in os.listdir('/var/backups/master-suite') if re.match(r'^\d{8}T\d{6}Z$', d)) if os.path.isdir('/var/backups/master-suite') else []
print(f'backup runs on disk: {len(runs)}; newest: {runs[-1] if runs else "NONE"}')
sched = subprocess.run("(crontab -l 2>/dev/null; cat /etc/cron.d/* /etc/crontab 2>/dev/null; systemctl list-timers --all 2>/dev/null) | grep -qi backup && echo PRESENT || echo ABSENT", shell=True, capture_output=True, text=True).stdout.strip()
print(f'backup schedule entry: {sched}')

print('== 2. production env keys (presence only)')
for k in ('DATABASE_URL','MIGRATION_DATABASE_URL','STAGING_NETWORK','STAGING_DATABASE_URL','ALLOW_UNSTAGED_MIGRATION','ACCOUNT_DELETION_EXECUTION_ENABLED','GEMINI_API_KEY','EMAIL_PROVIDER','S3_ENDPOINT','APP_ENV'):
    print(f'{k}: {"SET" if env.get(k) else "UNSET"}')
print('EMAIL_PROVIDER value:', env.get('EMAIL_PROVIDER') or 'UNSET')
print('S3_ENDPOINT host:', re.sub(r'//[^@/]*@', '//', env.get('S3_ENDPOINT','')) or 'UNSET')

print('== 3. committed-default DB password equality')
def pw_from_url(u):
    m = re.match(r'^postgresql://([^:/@]+):([^@]+)@', u or '')
    return (m.group(1), up.unquote(m.group(2))) if m else (None, None)
try: compose = open('infra/docker-compose.prod.yml', encoding='utf-8').read()
except FileNotFoundError: compose = ''
defaults = {}
for m in re.finditer(r'postgresql://([^:/@\$]+):([^@\$]+)@postgres:5432/', compose):
    defaults.setdefault(m.group(1), up.unquote(m.group(2)))
live = {}
for k in ('DATABASE_URL','MIGRATION_DATABASE_URL'):
    u, p = pw_from_url(env.get(k)); 
    if u and p: live.setdefault(u, p)
for user in ('master_saas_app','leadflow'):
    d, l = defaults.get(user), live.get(user)
    if not d or not l: print(f'{user}: NOT VERIFIED (default {"found" if d else "missing"}, live {"found" if l else "missing"})')
    else: print(f'{user}: {"SAME" if sha(d)==sha(l) else "DIFFERENT"}')

print('== 4. AI / transcription connections in production (provider, status, count)')
q = subprocess.run(['docker','exec','infra-postgres-1','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select provider, status, count(*) from \\"IntegrationConnection\\" group by 1,2 order by 1"'], capture_output=True, text=True)
print(q.stdout.strip() or '(none configured)')

print('== 5. running release identity')
print(subprocess.run(['docker','exec','infra-web-1','sh','-c','env | grep ^BUILD_COMMIT='], capture_output=True, text=True).stdout.strip())
for c in ('infra-web-1','infra-worker-1'):
    print(subprocess.run(['docker','inspect',c,'--format','{{.Name}} {{.Config.Image}} {{.Image}}'], capture_output=True, text=True).stdout.strip())
PY
```
