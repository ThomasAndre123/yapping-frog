import { FormEvent, useState } from 'react';

import type { TenantUser } from '../../types';

export function TenantUserEditPage({ user, onBack, onSave }: {
  user: TenantUser;
  onBack: () => void;
  onSave: (user: TenantUser) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    setSaving(true);
    try {
      await onSave({
        ...user,
        email: String(form.get('email')),
        display_name: String(form.get('displayName')),
        role: String(form.get('role')) as TenantUser['role'],
        status: Number(form.get('status')) as 1 | 2,
        ...(password ? { password } : {})
      });
    } catch {
      // The parent displays the API error and keeps this page open for correction.
    } finally {
      setSaving(false);
    }
  }

  return <section className="tenant-user-edit" aria-labelledby="tenant-user-edit-title">
    <div className="toolbar">
      <div><h3 id="tenant-user-edit-title">Edit tenant user</h3>
        <p>Update account details, access, or set a new password.</p></div>
      <button type="button" className="secondary" onClick={onBack}>Back to users</button>
    </div>
    <form className="card edit-tenant-form" onSubmit={submit}>
      <div className="edit-fields">
        <label>Email<input name="email" type="email" defaultValue={user.email} required maxLength={320} /></label>
        <label>Display name<input name="displayName" defaultValue={user.display_name} required maxLength={200} /></label>
        <label>Role<select name="role" defaultValue={user.role}>
          <option value="owner">Owner</option><option value="administrator">Administrator</option>
          <option value="agent">Agent</option>
        </select></label>
        <label>Status<select name="status" defaultValue={user.status}>
          <option value="1">Active</option><option value="2">Disabled</option>
        </select></label>
        <label>New password (optional)<input name="password" type="password"
          minLength={8} maxLength={1024} autoComplete="new-password" /></label>
      </div>
      <div><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save user'}</button></div>
    </form>
  </section>;
}
