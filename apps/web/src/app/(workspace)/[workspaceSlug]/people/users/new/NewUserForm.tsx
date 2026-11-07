'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { problemSummary } from '@/components/forms/useFormErrors';
import Field from '@/components/forms/Field';
import DateInput from '@/components/forms/DateInput';
import { toDateValue } from '@/lib/dates';

interface Option {
  id: string;
  name: string;
}

/**
 * A role, with enough beside its name to choose it without guessing.
 *
 * The picker used to be a bare list of names, which is fine for "Sales Agent"
 * and useless for a workspace holding Agent, Telecaller, Viewer and whatever
 * the last administrator built. `scope` and `modules` come from the role's own
 * grants, so a role trimmed by hand describes itself accurately.
 */
interface RoleOption extends Option {
  description: string | null;
  scope: string;
  modules: number;
  /** One of the six business roles, listed before the rest. */
  primary: boolean;
}

interface Created {
  fullName: string;
  employeeId: string;
  employeeNumber: string;
  email: string;
  role: string;
  attendanceLocation: string | null;
  temporaryPassword: string;
  note: string;
}

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'PROBATION', 'INTERN'];

/** The scope as a sentence, because OWN and ORGANIZATION are not English. */
const scopeWords = (scope: string) =>
  ({
    OWN: 'only their own records',
    TEAM: 'their team’s records',
    BRANCH: 'their branch’s records',
    REGION: 'their region’s records',
    ORGANIZATION: 'the whole workspace',
  })[scope] ?? scope.toLowerCase();

interface MatrixGrant {
  module: string;
  action: string;
  scope: string;
}

/**
 * What the role actually permits, before anyone is given it.
 *
 * Fetched on expand rather than with the page: a workspace can hold dozens of
 * roles and nobody opens this for more than one. The endpoint is the same
 * `matrix` the Roles screen reads, and it is gated on `roles:VIEW` — which an
 * administrator who may add users does not necessarily hold. So a refusal is
 * reported as what it is rather than as an empty list, because "this role
 * permits nothing" and "you may not read this" must not look alike.
 */
function RolePreview({ workspaceSlug, roleId }: { workspaceSlug: string; roleId: string }) {
  const [state, setState] = useState<{ roleId: string; grants: MatrixGrant[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (state?.roleId === roleId || loading) return;
    setLoading(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceSlug}/roles/matrix?roleId=${roleId}`);
      if (!res.ok) {
        setProblem(
          res.status === 403
            ? 'Reading the full permission list needs access to Roles & permissions.'
            : 'The permission list could not be loaded.',
        );
        return;
      }
      // `permissionMatrix` returns the whole catalogue with a scope of NONE for
      // what the role does not hold, so the held ones are the granted rows.
      const body = (await res.json()) as {
        permissions?: { module: string; action: string; scope: string; granted: boolean }[];
      };
      setState({
        roleId,
        grants: (body.permissions ?? []).filter((row) => row.granted && row.scope !== 'NONE'),
      });
    } catch {
      setProblem('The permission list could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const byModule = new Map<string, MatrixGrant[]>();
  for (const grant of state?.roleId === roleId ? state.grants : [])
    byModule.set(grant.module, [...(byModule.get(grant.module) ?? []), grant]);

  return (
    <details className="lf-role-brief__preview">
      {/*
       * The fetch hangs off the summary's click rather than the element's
       * `toggle` event: `onToggle` did not fire here, so the panel opened on
       * nothing. A click is what a person does either way, and the handler runs
       * before the open state flips — `load` is idempotent per role, so the
       * close-then-open case costs nothing.
       */}
      <summary onClick={() => void load()}>Preview effective permissions</summary>
      <div className="lf-role-brief__preview-body">
        {loading && <p>Loading…</p>}
        {problem && <p data-bad>{problem}</p>}
        {!loading && !problem && state?.roleId === roleId && byModule.size === 0 && (
          <p>This role grants no permissions. Someone holding it can reach only their own self-service screens.</p>
        )}
        {[...byModule.entries()].map(([module, grants]) => (
          <p key={module}>
            <strong>{module}</strong> —{' '}
            {grants.map((grant) => `${grant.action.toLowerCase()} (${grant.scope.toLowerCase()})`).join(', ')}
          </p>
        ))}
      </div>
    </details>
  );
}

/**
 * The add-user form.
 *
 * The temporary password is rendered exactly once, on the success panel, and is
 * never fetched again — there is no endpoint that will return it, because a
 * password an administrator can look up later is not temporary, it is shared.
 */
export default function NewUserForm({
  endpoint,
  usersHref,
  workspaceSlug,
  defaultRoleId,
  roles,
  departments,
  designations,
  branches,
  locations,
  managers,
}: {
  endpoint: string;
  usersHref: string;
  workspaceSlug: string;
  /** Employee, resolved by key on the server — never the most senior grantable role. */
  defaultRoleId: string;
  roles: RoleOption[];
  departments: Option[];
  designations: Option[];
  branches: Option[];
  locations: Option[];
  managers: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    employeeNumber: '',
    email: '',
    phone: '',
    roleId: defaultRoleId,
    departmentId: '',
    designationId: '',
    branchId: '',
    managerEmployeeId: '',
    joinedOn: toDateValue(new Date()),
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    // Only default this on when there is a location to assign. It used to
    // default on unconditionally, which revealed a `required` location select
    // holding nothing but its placeholder — no tenant here has an active work
    // location — so "Create user" silently did nothing: the browser blocks
    // submit on a required field that cannot be satisfied, and the form has no
    // way to say so. Attendance off with no location is a valid account; the
    // server only demands a location when this is on.
    attendanceEligible: locations.length > 0,
    workLocationId: locations[0]?.id ?? '',
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const chosen = roles.find((role) => role.id === form.roleId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}/account-create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(problemSummary(data, 'The account could not be created.'));
      setCreated(data as Created);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="lf-card lf-users__created">
        <h2>{created.fullName} can now sign in</h2>
        <dl>
          <div>
            <dt>Employee code</dt>
            <dd>{created.employeeNumber}</dd>
          </div>
          <div>
            <dt>Work email</dt>
            <dd>{created.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{created.role}</dd>
          </div>
          <div>
            <dt>Attendance location</dt>
            <dd>{created.attendanceLocation ?? 'Not eligible for attendance'}</dd>
          </div>
        </dl>
        <p className="lf-users__temp">
          Temporary password: <code>{created.temporaryPassword}</code>
        </p>
        <p className="lf-users__once">{created.note}</p>
        <div className="lf-face__actions">
          <a className="lf-btn" href={`/${workspaceSlug}/admin/work-locations/${created.employeeId}/face`}>
            Enrol their face
          </a>
          <a className="lf-btn lf-btn--secondary" href={usersHref}>
            Back to users
          </a>
        </div>
      </div>
    );
  }

  return (
    <form className="lf-card lf-users__form" onSubmit={submit}>
      {error && (
        <p className="lf-security__note" data-bad role="alert">
          {error}
        </p>
      )}

      <div className="lf-users__grid">
        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="nu-name">
            Full name
          </label>
          <input
            id="nu-name"
            className="lf-input"
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            minLength={2}
            maxLength={160}
            required
          />
        </div>
        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="nu-code">
            Employee code
          </label>
          <input
            id="nu-code"
            className="lf-input"
            value={form.employeeNumber}
            onChange={(e) => set('employeeNumber', e.target.value)}
            maxLength={40}
            required
            placeholder="EMP-014"
          />
        </div>
        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="nu-email">
            Work email
          </label>
          <input
            id="nu-email"
            className="lf-input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            maxLength={254}
            required
          />
        </div>
        <Field label="Phone" htmlFor="nu-phone">
          <input
            id="nu-phone"
            className="lf-input"
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            maxLength={32}
            placeholder="+971 50 000 0000"
          />
        </Field>
        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="nu-role">
            Role
          </label>
          <select
            id="nu-role"
            className="lf-input"
            value={form.roleId}
            onChange={(e) => set('roleId', e.target.value)}
            required
          >
            {/*
             * Grouped, so the six a brokerage recognises are not interleaved
             * with specialist and custom roles. Both groups are offered: the
             * point is which to read first, not which exist.
             */}
            {[
              { label: 'Business roles', items: roles.filter((role) => role.primary) },
              { label: 'Advanced & custom roles', items: roles.filter((role) => !role.primary) },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
          {chosen && (
            <div className="lf-role-brief">
              {chosen.description && <p className="lf-role-brief__what">{chosen.description}</p>}
              <p className="lf-role-brief__meta">
                Sees <strong>{scopeWords(chosen.scope)}</strong>
                {chosen.modules > 0
                  ? ` · ${chosen.modules} permission module${chosen.modules === 1 ? '' : 's'}`
                  : ' · no permissions yet'}
              </p>
              <RolePreview workspaceSlug={workspaceSlug} roleId={chosen.id} />
            </div>
          )}
        </div>
        <Field label="Department" htmlFor="nu-dept">
          <select
            id="nu-dept"
            className="lf-input"
            value={form.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
          >
            <option value="">Not set</option>
            {departments.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Designation" htmlFor="nu-desig">
          <select
            id="nu-desig"
            className="lf-input"
            value={form.designationId}
            onChange={(e) => set('designationId', e.target.value)}
          >
            <option value="">Not set</option>
            {designations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch / office" htmlFor="nu-branch">
          <select
            id="nu-branch"
            className="lf-input"
            value={form.branchId}
            onChange={(e) => set('branchId', e.target.value)}
          >
            <option value="">Not set</option>
            {branches.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reporting manager" htmlFor="nu-manager">
          <select
            id="nu-manager"
            className="lf-input"
            value={form.managerEmployeeId}
            onChange={(e) => set('managerEmployeeId', e.target.value)}
          >
            <option value="">Not set</option>
            {managers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="nu-joined">
            Joining date
          </label>
          <DateInput id="nu-joined" value={form.joinedOn} onChange={(value) => set('joinedOn', value)} required />
        </div>
        <Field label="Employment type" htmlFor="nu-type">
          <select
            id="nu-type"
            className="lf-input"
            value={form.employmentType}
            onChange={(e) => set('employmentType', e.target.value)}
          >
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Account status" htmlFor="nu-status">
          <select
            id="nu-status"
            className="lf-input"
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="ACTIVE">Active</option>
            <option value="INVITED">Invited</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </Field>
      </div>

      <label className="lf-users__check">
        <input
          type="checkbox"
          checked={form.attendanceEligible}
          onChange={(e) => set('attendanceEligible', e.target.checked)}
          disabled={locations.length === 0}
        />
        <span>Eligible for geofenced attendance</span>
      </label>
      {locations.length === 0 && (
        <p className="lf-users__once">
          No attendance location exists yet, so nobody can be made eligible. Add one under Attendance locations first —
          this person can be created now and made eligible afterwards.
        </p>
      )}

      {form.attendanceEligible && (
        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="nu-loc">
            Assigned attendance location
          </label>
          <select
            id="nu-loc"
            className="lf-input"
            value={form.workLocationId}
            onChange={(e) => set('workLocationId', e.target.value)}
            required
          >
            <option value="">Choose a location</option>
            {locations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <p className="lf-users__once">
            Without a location this person could never check in, so one is required while attendance is on.
          </p>
        </div>
      )}

      <div className="lf-face__actions">
        <button className="lf-btn" type="submit" disabled={busy || !form.roleId}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
        <a className="lf-btn lf-btn--secondary" href={usersHref}>
          Cancel
        </a>
      </div>
      <p className="lf-users__once">
        A temporary password is generated and shown once on the next screen. The account must replace it at first
        sign-in before anything else opens.
      </p>
    </form>
  );
}
