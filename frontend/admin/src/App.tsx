import { FormEvent, useCallback, useEffect, useState } from 'react';

import { adminApi } from './api';
import { AdministratorsPage } from './pages/AdministratorsPage';
import { AuditPage } from './pages/AuditPage';
import { SecurityPage } from './pages/SecurityPage';
import { TenantsPage } from './pages/TenantsPage';
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

  const showNotice = useCallback((message: string, success = false) => {
    setNotice({ message, success });
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

  async function updateTenant(
    tenant: Tenant,
    details: {
      slug: string;
      name: string;
      status: 1 | 2;
      subscriptionType: string;
      subscriptionValidUntil: string | null;
    }
  ) {
    if (!csrfToken) return;
    setNotice(null);
    try {
      await adminApi.updateTenant(csrfToken, tenant, details);
      setNotice({ message: 'Tenant updated.', success: true });
      await loadTenants();
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  async function createAdministrator(details: {
    email: string; displayName: string; role: AdministratorRecord['role']; password: string;
  }) {
    if (!csrfToken) return;
    setNotice(null);
    try {
      await adminApi.createAdministrator(csrfToken, details);
      showNotice('Administrator created.', true);
      await Promise.all([loadAdministrators(), loadAuditLog()]);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  async function updateAdministrator(administratorRecord: AdministratorRecord, details: {
    email: string; displayName: string; role: AdministratorRecord['role']; status: 1 | 2;
    password?: string;
  }) {
    if (!csrfToken) return;
    setNotice(null);
    try {
      await adminApi.updateAdministrator(csrfToken, administratorRecord, details);
      showNotice('Administrator updated.', true);
      await Promise.all([loadAdministrators(), loadAuditLog()]);
    } catch (error) {
      showError(error);
      throw error;
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
            {panel === 'tenants' && <TenantsPage
              tenants={tenants}
              readOnly={administrator.role === 'support'}
              csrfToken={csrfToken ?? ''}
              onCreate={createTenant}
              onRefresh={() => loadTenants().catch(showError)}
              onUpdate={updateTenant}
              onNotice={showNotice}
            />}
            {panel === 'administrators' && isSuperAdmin &&
              <AdministratorsPage administrators={administrators}
                currentAdministratorId={administrator.publicId}
                onCreate={createAdministrator} onUpdate={updateAdministrator}
                onRefresh={() => loadAdministrators().catch(showError)} />}
            {panel === 'audit' && isSuperAdmin && <AuditPage
              entries={auditEntries}
              cursor={auditCursor}
              onRefresh={() => loadAuditLog().catch(showError)}
              onMore={() => auditCursor && loadAuditLog(auditCursor).catch(showError)}
            />}
            {panel === 'security' && <SecurityPage onSubmit={changePassword} />}
          </div>
        </section>
      )}
    </main>
  );
}
