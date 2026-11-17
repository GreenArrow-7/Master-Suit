# Production graphs what Prometheus already collects

**What** — a `grafana` container beside Prometheus and Alertmanager in
production, with its one data source provisioned from a file. It reads the
metrics already being scraped and raises nothing. No PR yet.

**Why** — the owner asked for a dashboard to watch production at go-live.
Alerting already existed (13 rules through Alertmanager); what was missing was
anywhere to _look_. Logs were the other half of the request and are deliberately
not here — see **Left open**.

**Where**

- `apps/web/infra/docker-compose.yml` — the `grafana` service, behind
  `profiles: ['observability']` with `logging: *logging`, as every service in
  this file must have (`scripts/check-observability.mjs` fails the build
  otherwise). New `grafanadata` volume.
- `apps/web/infra/docker-compose.azure.yml` — clears the profile, publishes
  `127.0.0.1:3001:3000`, and requires `GRAFANA_ADMIN_PASSWORD` with `:?` as the
  other production credentials do.
- `apps/web/infra/grafana-datasource.yml` — new. Points at `prometheus:9090`
  over the compose network, `editable: false`.
- `apps/web/.env.example` — `GRAFANA_ADMIN_PASSWORD`, empty. Not in
  `src/lib/env.ts`: the container reads it and the application never does, the
  same shape as `ALERT_EMAIL_TO`.
- `docs/OBSERVABILITY.md` — the service table, the diagram, the SSH tunnel line,
  and why it is `3001`.

**Behaviour** — nothing a customer sees. An operator with the SSH key reaches
Grafana at `127.0.0.1:3001` through the same tunnel as Prometheus, signs in as
`admin`, and finds the Prometheus data source already connected. Production
refuses to start if `GRAFANA_ADMIN_PASSWORD` is unset. Staging and development
are unchanged: staging does not clear the profile for Grafana, and development
never starts the observability services at all.

**Verified** — `npm run check:observability` passes (13 alert rules, 11 consumed
queues). `docker compose … config` renders the service with the logging anchor
applied (`json-file`, 10 MB × 5), the pinned image, and the data source bound
read-only; and with the azure overlay layered it lists `grafana` among the
production services. The `:?` guard was confirmed by rendering without the
variable: it refuses alongside `POSTGRES_PASSWORD` and `ALERT_EMAIL_TO`.
**Not run against a live Docker daemon** — the container has never been started.

**Left open** — no dashboards are provisioned, only the data source; the first
person in builds what they want to watch, and anything worth keeping should come
back here as a provisioned file rather than living in `grafanadata`. Log
shipping is still the open decision this document already records: Grafana shows
metrics only, and putting a log store on this VM would write to the disk
Postgres uses. Grafana also sits on the same host as the thing it watches, which
is the flaw the doc already names for Prometheus — if the host dies, so does the
dashboard that would have shown you why.
