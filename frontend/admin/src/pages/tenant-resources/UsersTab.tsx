import { FormEvent } from 'react';

import type { TenantUser } from '../../types';

export function UsersTab({ users, readOnly, onCreate, onUpdate }: {
  users: TenantUser[];
  readOnly: boolean;
  onCreate: (details: { email: string; displayName: string; role: TenantUser['role']; password: string }) => Promise<void>;
  onUpdate: (user: TenantUser) => Promise<void>;
}) {
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await onCreate({ email: String(form.get('email')), displayName: String(form.get('displayName')),
      role: String(form.get('role')) as TenantUser['role'], password: String(form.get('password')) });
    element.reset();
  }

  async function update(event: FormEvent<HTMLFormElement>, user: TenantUser) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onUpdate({ ...user, email: String(form.get('email')),
      display_name: String(form.get('displayName')),
      role: String(form.get('role')) as TenantUser['role'],
      status: Number(form.get('status')) as 1 | 2 });
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
    {users.map((user) => readOnly
      ? <UserSummary key={user.public_id} user={user} />
      : <form className="resource-row user-row" key={user.public_id} onSubmit={(event) => update(event, user)}>
        <label>Email<input name="email" type="email" defaultValue={user.email} required /></label>
        <label>Name<input name="displayName" defaultValue={user.display_name} required /></label>
        <label>Role<select name="role" defaultValue={user.role}><option value="owner">Owner</option><option value="administrator">Administrator</option><option value="agent">Agent</option></select></label>
        <label>Status<select name="status" defaultValue={user.status}><option value="1">Active</option><option value="2">Disabled</option></select></label>
        <button type="submit">Save</button>
      </form>)}
    {users.length === 0 && <p className="empty">No tenant users.</p>}
  </section>;
}

function UserSummary({ user }: { user: TenantUser }) {
  return <div className="summary-row"><span>{user.display_name}</span><span>{user.email}</span>
    <span>{user.role}</span><span>{user.status === 1 ? 'Active' : 'Disabled'}</span></div>;
}
