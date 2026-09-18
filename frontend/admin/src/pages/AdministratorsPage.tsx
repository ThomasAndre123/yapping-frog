import { FormEvent, useState } from 'react';

import type { AdministratorRecord, AdministratorRole } from '../types';

interface AdministratorDetails {
  email: string;
  displayName: string;
  role: AdministratorRole;
  password: string;
}

interface AdministratorUpdateDetails extends Omit<AdministratorDetails, 'password'> {
  status: 1 | 2;
  password?: string;
}

export function AdministratorsPage({
  administrators, currentAdministratorId, onCreate, onUpdate, onRefresh
}: {
  administrators: AdministratorRecord[];
  currentAdministratorId: string;
  onCreate: (details: AdministratorDetails) => Promise<void>;
  onUpdate: (administrator: AdministratorRecord, details: AdministratorUpdateDetails) => Promise<void>;
  onRefresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdministratorRecord | null>(null);

  function closeForm() {
    setCreating(false);
    setEditing(null);
  }

  return <section className="panel active" aria-labelledby="administrators-title">
    <div className="toolbar">
      <div><h2 id="administrators-title">Administrators</h2>
        <p>Manage accounts with access to this administration area.</p></div>
      <div className="toolbar-actions">
        <button type="button" className="secondary" onClick={onRefresh}>Refresh</button>
        <button type="button" onClick={() => { setEditing(null); setCreating(true); }}>
          Create administrator
        </button>
      </div>
    </div>

    {creating && <AdministratorForm
      title="Create administrator"
      description="Add a platform administrator and choose their access level."
      submitLabel="Create administrator"
      onCancel={closeForm}
      onSubmit={async (details) => { await onCreate(details as AdministratorDetails); closeForm(); }}
    />}

    {editing && <AdministratorForm
      key={editing.public_id}
      title="Edit administrator"
      description={`Update access and account details for ${editing.display_name}.`}
      submitLabel="Save administrator"
      administrator={editing}
      isCurrentAdministrator={editing.public_id === currentAdministratorId}
      onCancel={closeForm}
      onSubmit={async (details) => {
        await onUpdate(editing, details as AdministratorUpdateDetails);
        closeForm();
      }}
    />}

    <div className="card table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Action</th></tr></thead>
        <tbody>{administrators.map((item) => <tr key={item.public_id}>
          <td>{item.display_name}{item.public_id === currentAdministratorId && <span className="you-label">You</span>}</td>
          <td>{item.email}</td><td>{roleLabel(item.role)}</td>
          <td><span className={`status${item.status === 2 ? ' suspended' : ''}`}>
            {item.status === 1 ? 'Active' : 'Disabled'}
          </span></td>
          <td>{item.last_login_at ? new Date(item.last_login_at).toLocaleString() : 'Never'}</td>
          <td><button type="button" onClick={() => { setCreating(false); setEditing(item); }}>Edit</button></td>
        </tr>)}</tbody>
      </table>
      {administrators.length === 0 && <p className="empty">No administrators found.</p>}
    </div>
  </section>;
}

function AdministratorForm({
  title, description, submitLabel, administrator, isCurrentAdministrator = false,
  onCancel, onSubmit
}: {
  title: string;
  description: string;
  submitLabel: string;
  administrator?: AdministratorRecord;
  isCurrentAdministrator?: boolean;
  onCancel: () => void;
  onSubmit: (details: AdministratorDetails | AdministratorUpdateDetails) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    const details = {
      email: String(form.get('email')),
      displayName: String(form.get('displayName')),
      role: String(form.get('role')) as AdministratorRole,
      ...(administrator && { status: Number(form.get('status')) as 1 | 2 }),
      ...((!administrator || password) && { password })
    };
    setSaving(true);
    try {
      await onSubmit(details as AdministratorDetails | AdministratorUpdateDetails);
    } catch {
      // The parent displays the API error and leaves the form open for correction.
    } finally {
      setSaving(false);
    }
  }

  return <form className="card administrator-form" onSubmit={submit}>
    <div className="form-heading">
      <div><h3>{title}</h3><p>{description}</p></div>
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </div>
    <div className="edit-fields">
      <label>Display name<input name="displayName" defaultValue={administrator?.display_name} required maxLength={200} /></label>
      <label>Email<input name="email" type="email" defaultValue={administrator?.email} required maxLength={320} /></label>
      <label>Role
        <select name="role" defaultValue={administrator?.role ?? 'support'} disabled={isCurrentAdministrator} required>
          <option value="support">Support</option><option value="operator">Operator</option>
          <option value="super_admin">Super administrator</option>
        </select>
        {isCurrentAdministrator && <input type="hidden" name="role" value="super_admin" />}
      </label>
      {administrator && <label>Status
        <select name="status" defaultValue={administrator.status} disabled={isCurrentAdministrator} required>
          <option value="1">Active</option><option value="2">Disabled</option>
        </select>
        {isCurrentAdministrator && <input type="hidden" name="status" value="1" />}
      </label>}
      <label>{administrator ? 'New password (optional)' : 'Temporary password'}
        <input name="password" type="password" autoComplete="new-password"
          required={!administrator} minLength={12} maxLength={1024} />
      </label>
    </div>
    <div><button type="submit" disabled={saving}>{saving ? 'Saving…' : submitLabel}</button></div>
  </form>;
}

function roleLabel(role: AdministratorRole) {
  return role === 'super_admin' ? 'Super administrator' :
    role.charAt(0).toUpperCase() + role.slice(1);
}
