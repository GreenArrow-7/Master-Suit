'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Option {
  id: string;
  name: string;
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
const today = () => new Date().toISOString().slice(0, 10);

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
  roles: Option[];
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
    joinedOn: today(),
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
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The account could not be created.');
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
          <a className="lf-btn" href={`/${workspaceSlug}/people/employees/${created.employeeId}/face`}>
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
          <label className="lf-label" htmlFor="nu-name">
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
          <label className="lf-label" htmlFor="nu-code">
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
          <label className="lf-label" htmlFor="nu-email">
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
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-phone">
            Phone
          </label>
          <input
            id="nu-phone"
            className="lf-input"
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            maxLength={32}
            placeholder="+971 50 000 0000"
          />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-role">
            Role
          </label>
          <select
            id="nu-role"
            className="lf-input"
            value={form.roleId}
            onChange={(e) => set('roleId', e.target.value)}
            required
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-dept">
            Department
          </label>
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
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-desig">
            Designation
          </label>
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
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-branch">
            Branch / office
          </label>
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
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-manager">
            Reporting manager
          </label>
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
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-joined">
            Joining date
          </label>
          <input
            id="nu-joined"
            className="lf-input"
            type="date"
            value={form.joinedOn}
            onChange={(e) => set('joinedOn', e.target.value)}
            required
          />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-type">
            Employment type
          </label>
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
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="nu-status">
            Account status
          </label>
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
        </div>
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
          <label className="lf-label" htmlFor="nu-loc">
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
