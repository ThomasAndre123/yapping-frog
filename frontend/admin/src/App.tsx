import { FormEvent, useCallback, useEffect, useState } from 'react';

import { adminApi } from './api';
import type {
  AdministratorIdentity,
  AdministratorRecord,
  AuditEntry,
  Tenant
} from './types';

type Panel = 'tenants' | 'administrators' | 'audit' | 'security';
type Notice = { message: string; success?: boolean } | null;

const panels: Array<{ id: Panel; label: string; superAdminOnly?: boolean }> = [
  { id: 'tenants', label: 'Tenants' },
  { id: 'administrators', label: 'Administrators', superAdminOnly: true },
  { id: 'audit', label: 'Audit log', superAdminOnly: true },
  { id: 'security', label: 'Security' }
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred';
}

export function App() {
  const [administrator, setAdministrator] = useState<AdministratorIdentity | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>();
  const [initializing, setInitializing] = useState(true);
  const [panel, setPanel] = useState<Panel>('tenants');
  const [notice, setNotice] = useState<Notice>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [administrators, setAdministrators] = useState<AdministratorRecord[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);

  const isSuperAdmin = administrator?.role === 'super_admin';

  const showError = useCallback((error: unknown) => {
    setNotice({ message: errorMessage(error) });
  }, []);

  const loadTenants = useCallback(async () => {
    const result = await adminApi.tenants();
    setTenants(result.tenants);
  }, []);

  const loadAdministrators = useCallback(async () => {
    const result = await adminApi.administrators();
    setAdministrators(result.administrators);
  }, []);

  const loadAuditLog = useCallback(async (before?: string) => {
    const result = await adminApi.auditLog(before);
    setAuditEntries((current) => before ? [...current, ...result.entries] : result.entries);
    setAuditCursor(result.nextBefore);
  }, []);

  const loadDashboard = useCallback(async (identity: AdministratorIdentity) => {
    const requests: Promise<unknown>[] = [loadTenants()];
    if (identity.role === 'super_admin') {
      requests.push(loadAdministrators(), loadAuditLog());
    }
    await Promise.all(requests);
  }, [loadAdministrators, loadAuditLog, loadTenants]);

  useEffect(() => {
    let active = true;
    adminApi.session()
      .then(async (session) => {
        if (!active) return;
        setAdministrator(session.administrator);
        setCsrfToken(session.csrfToken);
        await loadDashboard(session.administrator);
      })
      .catch(() => {})
      .finally(() => { if (active) setInitializing(false); });
    return () => { active = false; };
  }, [loadDashboard]);

  useEffect(() => {
    const requested = window.location.hash.slice(1) as Panel;
    const allowed = panels.some(({ id, superAdminOnly }) =>
      id === requested && (!superAdminOnly || isSuperAdmin));
    if (allowed) setPanel(requested);
  }, [isSuperAdmin]);

  function selectPanel(nextPanel: Panel) {
    setNotice(null);
    setPanel(nextPanel);
    window.history.replaceState(null, '', `#${nextPanel}`);
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await adminApi.login(String(form.get('email')), String(form.get('password')));
      const session = await adminApi.session();
      setAdministrator(session.administrator);
      setCsrfToken(session.csrfToken);
      await loadDashboard(session.administrator);
    } catch (error) {
      showError(error);
    }
  }

  async function logout() {
    if (!csrfToken) return;
    try {
      await adminApi.logout(csrfToken);
      setAdministrator(null);
      setCsrfToken(undefined);
      setNotice(null);
      setTenants([]);
      setAdministrators([]);
      setAuditEntries([]);
    } catch (error) {
      showError(error);
    }
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setNotice(null);
    try {
      await adminApi.createTenant(
        csrfToken,
        String(form.get('slug')),
        String(form.get('name'))
      );
      formElement.reset();
      setNotice({ message: 'Tenant created.', success: true });
      await loadTenants();
    } catch (error) {
      showError(error);
    }
  }

  async function toggleTenant(tenant: Tenant) {
    if (!csrfToken) return;
    setNotice(null);
    try {
      await adminApi.setTenantStatus(csrfToken, tenant, tenant.status === 1 ? 2 : 1);
      await loadTenants();
    } catch (error) {
      showError(error);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get('currentPassword'));
    const newPassword = String(form.get('newPassword'));
    const confirmation = String(form.get('confirmation'));
    setNotice(null);

    if (newPassword !== confirmation) {
      setNotice({ message: 'New password and confirmation do not match.' });
      return;
    }

    try {
      const result = await adminApi.changePassword(csrfToken, currentPassword, newPassword);
      formElement.reset();
      setNotice({ message: result.message, success: true });
      if (isSuperAdmin) await loadAuditLog();
    } catch (error) {
      showError(error);
    }
  }

  if (initializing) {
    return <main><p className="loading">Loading administration…</p></main>;
  }

  return (
    <main>
      <header>
        <div><span className="eyebrow">Yapping Frog</span><h1>Administration</h1></div>
        {administrator && (
          <div id="account">
            <span>{administrator.displayName} · {administrator.role}</span>
            <button type="button" className="secondary" onClick={logout}>Log out</button>
          </div>
        )}
      </header>

      {notice && (
        <section className={`notice${notice.success ? ' success' : ''}`} role="alert">
          {notice.message}
        </section>
      )}

      {!administrator ? (
        <section className="card narrow">
          <h2>Administrator login</h2>
          <p>Use an active platform administrator account.</p>
          <form onSubmit={login}>
            <label>Email<input name="email" type="email" autoComplete="username" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
            <button type="submit">Log in</button>
          </form>
        </section>
      ) : (
        <section className="dashboard">
          <nav className="admin-menu" aria-label="Administration sections">
            {panels.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`menu-item${panel === item.id ? ' active' : ''}`}
                aria-selected={panel === item.id}
                onClick={() => selectPanel(item.id)}
              >{item.label}</button>
            ))}
          </nav>

          <div className="admin-content">
            {panel === 'tenants' && <TenantsPanel
              tenants={tenants}
              readOnly={administrator.role === 'support'}
              onCreate={createTenant}
              onRefresh={() => loadTenants().catch(showError)}
              onToggle={toggleTenant}
            />}
            {panel === 'administrators' && isSuperAdmin &&
              <AdministratorsPanel administrators={administrators} />}
            {panel === 'audit' && isSuperAdmin && <AuditPanel
              entries={auditEntries}
              cursor={auditCursor}
              onRefresh={() => loadAuditLog().catch(showError)}
              onMore={() => auditCursor && loadAuditLog(auditCursor).catch(showError)}
            />}
            {panel === 'security' && <SecurityPanel onSubmit={changePassword} />}
          </div>
        </section>
      )}
    </main>
  );
}

function TenantsPanel({ tenants, readOnly, onCreate, onRefresh, onToggle }: {
  tenants: Tenant[];
  readOnly: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onToggle: (tenant: Tenant) => void;
}) {
  return <section className="panel active" aria-labelledby="tenants-title">
    <div className="toolbar">
      <div><h2 id="tenants-title">Tenants</h2><p>Manage customer organizations on this service.</p></div>
      <button type="button" className="secondary" onClick={onRefresh}>Refresh</button>
    </div>
    {!readOnly && <form className="card inline-form" onSubmit={onCreate}>
      <label>Slug<input name="slug" placeholder="acme-store" required pattern="[a-z0-9][a-z0-9-]{1,62}" /></label>
      <label>Name<input name="name" placeholder="Acme Store" required maxLength={200} /></label>
      <button type="submit">Create tenant</button>
    </form>}
    <div className="card table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
        <tbody>{tenants.map((tenant) => <tr key={tenant.public_id}>
          <td>{tenant.name}</td><td>{tenant.slug}</td>
          <td><span className={`status${tenant.status === 2 ? ' suspended' : ''}`}>
            {tenant.status === 1 ? 'Active' : 'Suspended'}
          </span></td>
          <td>{new Date(tenant.created_at).toLocaleString()}</td>
          <td><button type="button" className="secondary" disabled={readOnly} onClick={() => onToggle(tenant)}>
            {tenant.status === 1 ? 'Suspend' : 'Activate'}
          </button></td>
        </tr>)}</tbody>
      </table>
      {tenants.length === 0 && <p className="empty">No tenants have been created.</p>}
    </div>
  </section>;
}

function AdministratorsPanel({ administrators }: { administrators: AdministratorRecord[] }) {
  return <section className="panel active" aria-labelledby="administrators-title">
    <div className="toolbar"><div><h2 id="administrators-title">Administrators</h2>
      <p>Review accounts with access to this administration area.</p></div></div>
    <div className="card">{administrators.map((item) => <div className="admin-row" key={item.public_id}>
      <span>{item.display_name}</span><span>{item.email}</span><span>{item.role}</span>
      <span>{item.status === 1 ? 'Active' : 'Disabled'}</span>
    </div>)}</div>
  </section>;
}

function AuditPanel({ entries, cursor, onRefresh, onMore }: {
  entries: AuditEntry[];
  cursor: string | null;
  onRefresh: () => void;
  onMore: () => void;
}) {
  return <section className="panel active" aria-labelledby="audit-title">
    <div className="toolbar"><div><h2 id="audit-title">Administrator audit log</h2>
      <p>Recent security and tenant-management activity.</p></div>
      <button type="button" className="secondary" onClick={onRefresh}>Refresh</button></div>
    <div className="card table-wrap"><table>
      <thead><tr><th>Time</th><th>Administrator</th><th>Action</th><th>Target</th><th>IP address</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.id}>
        <td>{new Date(entry.created_at).toLocaleString()}</td>
        <td>{entry.administrator_name ?? entry.administrator_email ?? 'Deleted administrator'}</td>
        <td>{entry.action}</td><td>{entry.tenant_name ?? entry.target_id ?? entry.target_type}</td>
        <td>{entry.ip_address ?? '—'}</td>
      </tr>)}</tbody>
    </table>{cursor && <button type="button" className="secondary more-audit" onClick={onMore}>
      Load older entries
    </button>}</div>
  </section>;
}

function SecurityPanel({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section className="panel active" aria-labelledby="security-title">
    <div className="toolbar"><div><h2 id="security-title">Security</h2>
      <p>Manage your administrator credentials.</p></div></div>
    <form className="card password-form" onSubmit={onSubmit}>
      <h3>Change password</h3><p>Changing your password does not sign out active admin sessions.</p>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={1} required /></label>
      <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={1} required /></label>
      <button type="submit">Change password</button>
    </form>
  </section>;
}
