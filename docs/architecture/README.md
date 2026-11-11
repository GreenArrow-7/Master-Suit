# Diagram sources

One Mermaid diagram per file, each embedded in [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
and referenced from there. Edit the `.mmd` file, then paste it back into the
matching fenced block in `ARCHITECTURE.md` — the document is the thing people
read, these files are what you edit.

| File                             | Shown in                                        |
| -------------------------------- | ----------------------------------------------- |
| `01-system-overview.mmd`         | §2.1 the whole system                           |
| `02-frontend.mmd`                | §2.2 frontend                                   |
| `03-backend-request.mmd`         | §2.3 the life of one request                    |
| `04-background-jobs.mmd`         | §2.4 background processing                      |
| `05-data-core.mmd`               | §2.6 core identity and permission entities      |
| `06-data-lead.mmd`               | §2.6 the lead and its orbit                     |
| `07-tenancy.mmd`                 | §2.6 data and tenant isolation                  |
| `08-mobile.mmd`                  | §2.5 mobile apps                                |
| `09-external-services.mmd`       | §2.7 external services                          |
| `10-workflow-login.mmd`          | §4.1 signing in                                 |
| `11-workflow-password-reset.mmd` | §4.2 resetting a password                       |
| `12-workflow-call.mmd`           | §4.3 placing an AI-assisted call, and ending it |
| `13-workflow-daily-activity.mmd` | §4.4 Daily Activity and daily targets           |
| `14-workflow-lead-intake.mmd`    | §4.5 a lead arriving from a portal              |
| `15-ci-cd.mmd`                   | §6.4 CI/CD                                      |
| `16-runtime-deployment.mmd`      | §2.8 runtime and deployment shape               |
