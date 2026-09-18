import { FormEvent } from 'react';

import type { TenantUser } from '../../types';

export function UsersTab({ users, readOnly, onCreate, onEdit }: {
  users: TenantUser[];
  readOnly: boolean;
  onCreate: (details: { email: string; displayName: string; role: TenantUser['role']; password: string }) => Promise<void>;
  onEdit: (user: TenantUser) => void;
}) {
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await onCreate({ email: String(form.get('email')), displayName: String(form.get('displayName')),
      role: String(form.get('role')) as TenantUser['role'], password: String(form.get('password')) });
    element.reset();
  }

  return <section className="card resource-section" role="tabpanel" id="users-panel"
    aria-labelledby="users-tab"><h3>Users</h3>
    <p>Tenant users carry their role directly; there is no membership table.</p>
    {!readOnly && <form className="resource-form user-create-form" onSubmit={create}>
      <label>Email<input name="email" type="email" required /></label>
      <label>Display name<input name="displayName" required /></label>
      <label>Role<select name="role"><option value="owner">Owner</option><option value="administrator">Administrator</option><option value="agent">Agent</option></select></label>
      <label>Initial password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
      <button type="submit">Add user</button>
    </form>}
    {users.map((user) => <UserSummary key={user.public_id} user={user}
      onEdit={readOnly ? undefined : () => onEdit(user)} />)}
    {users.length === 0 && <p className="empty">No tenant users.</p>}
  </section>;
}

function UserSummary({ user, onEdit }: { user: TenantUser; onEdit?: () => void }) {
  return <div className="summary-row"><span>{user.display_name}</span><span>{user.email}</span>
    <span>{user.role}</span><span>{user.status === 1 ? 'Active' : 'Disabled'}</span>
    {onEdit && <button type="button" onClick={onEdit}>Edit</button>}</div>;
}
