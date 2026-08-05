# Authentication design

`PlatformUser`, `WorkspaceMembership` and `PlatformSession` are the canonical
login path for Platform Owner, company administrator and employee accounts.
Passwords and optional authentication factors belong to the platform identity;
roles, primary-administrator status and company access belong to memberships.

After one email/password login:

- a Platform Owner is sent to `/platform`;
- a company user is sent to `/{workspaceSlug}/dashboard`;
- suspended identities, memberships or workspaces cannot establish or continue a
  valid company session;
- session workspace changes are allowed only to another active membership.

Workspace creation transactionally creates the primary administrator's platform
identity, company membership, company-admin role assignment, employee profile,
and compatibility Sales user using the same workspace ID. The unified customer
application does not issue a second HRMS bearer/refresh identity.
