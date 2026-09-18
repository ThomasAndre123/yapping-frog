import { FormEvent, useCallback, useEffect, useState } from 'react';

import { adminApi } from '../api';
import type { Tenant, TenantApiKey, TenantResources, TenantSite, TenantUser } from '../types';

interface Props {
  tenant: Tenant;
  csrfToken: string;
  readOnly: boolean;
  onClose: () => void;
  onNotice: (message: string, success?: boolean) => void;
}

type ResourceTab = 'sites' | 'users' | 'api-keys';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred';
}

function list(value: FormDataEntryValue | null) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function TenantResourcesPage({ tenant, csrfToken, readOnly, onClose, onNotice }: Props) {
  const [resources, setResources] = useState<TenantResources>();
  const [secret, setSecret] = useState<string>();
  const [activeTab, setActiveTab] = useState<ResourceTab>('sites');

  const load = useCallback(async () => {
    setResources(await adminApi.tenantResources(tenant));
  }, [tenant]);

  useEffect(() => {
    load().catch((error) => onNotice(message(error)));
  }, [load, onNotice]);

  async function perform(operation: () => Promise<unknown>, success: string) {
    try {
      await operation();
      onNotice(success, true);
      await load();
    } catch (error) {
      onNotice(message(error));
      throw error;
    }
  }

  async function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await perform(() => adminApi.createSite(
      csrfToken, tenant, String(form.get('name')), list(form.get('domains'))
    ), 'Site created.');
    formElement.reset();
  }

  async function updateSite(event: FormEvent<HTMLFormElement>, site: TenantSite) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await perform(() => adminApi.updateSite(csrfToken, tenant, {
      ...site,
      name: String(form.get('name')),
      allowed_domains: list(form.get('domains')),
      status: Number(form.get('status')) as 1 | 2
    }), 'Site updated.');
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await perform(() => adminApi.createTenantUser(csrfToken, tenant, {
      email: String(form.get('email')),
      displayName: String(form.get('displayName')),
      role: String(form.get('role')) as TenantUser['role'],
      password: String(form.get('password'))
    }), 'Tenant user created.');
    formElement.reset();
  }

  async function updateUser(event: FormEvent<HTMLFormElement>, user: TenantUser) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await perform(() => adminApi.updateTenantUser(csrfToken, tenant, {
      ...user,
      email: String(form.get('email')),
      display_name: String(form.get('displayName')),
      role: String(form.get('role')) as TenantUser['role'],
      status: Number(form.get('status')) as 1 | 2
    }), 'Tenant user updated.');
  }

  async function createApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await adminApi.createApiKey(csrfToken, tenant, {
        name: String(form.get('name')),
        scopes: list(form.get('scopes')),
        expiresAt: form.get('expiresAt')
          ? new Date(String(form.get('expiresAt'))).toISOString()
          : null
      });
      setSecret(result.secret);
      onNotice('API key created. Copy its secret now.', true);
      formElement.reset();
      await load();
    } catch (error) {
      onNotice(message(error));
    }
  }

  return <section className="panel active tenant-resources" aria-labelledby="resources-title">
    <div className="toolbar">
      <div><h2 id="resources-title">{tenant.name}</h2><p>Sites, users, and server API keys.</p></div>
      <button type="button" className="secondary" onClick={onClose}>Back to tenants</button>
    </div>

    {!resources ? <p className="card">Loading tenant data…</p> : <>
      <nav className="resource-tabs" role="tablist" aria-label="Tenant resources">
        <ResourceTabButton id="sites" label="Sites" count={resources.sites.length}
          activeTab={activeTab} onSelect={setActiveTab} />
        <ResourceTabButton id="users" label="Users" count={resources.users.length}
          activeTab={activeTab} onSelect={setActiveTab} />
        <ResourceTabButton id="api-keys" label="API keys" count={resources.apiKeys.length}
          activeTab={activeTab} onSelect={setActiveTab} />
      </nav>

      {activeTab === 'sites' && <ResourceSection id="sites" title="Sites"
        description="Publishable widget keys and allowed website domains.">
        {!readOnly && <form className="resource-form" onSubmit={createSite}>
          <label>Site name<input name="name" required maxLength={200} /></label>
          <label>Allowed domains<input name="domains" required placeholder="example.com, *.example.com" /></label>
          <button type="submit">Add site</button>
        </form>}
        {resources.sites.map((site) => readOnly
          ? <SiteSummary key={site.public_id} site={site} />
          : <form className="resource-row" key={site.public_id} onSubmit={(event) => updateSite(event, site)}>
            <label>Name<input name="name" defaultValue={site.name} required /></label>
            <label>Allowed domains<input name="domains" defaultValue={site.allowed_domains.join(', ')} required /></label>
            <label>Status<select name="status" defaultValue={site.status}><option value="1">Active</option><option value="2">Disabled</option></select></label>
            <code>{site.widget_key}</code><button type="submit">Save</button>
          </form>)}
        {resources.sites.length === 0 && <p className="empty">No sites configured.</p>}
      </ResourceSection>}

      {activeTab === 'users' && <ResourceSection id="users" title="Users"
        description="Tenant users carry their role directly; there is no membership table.">
        {!readOnly && <form className="resource-form user-create-form" onSubmit={createUser}>
          <label>Email<input name="email" type="email" required /></label>
          <label>Display name<input name="displayName" required /></label>
          <label>Role<select name="role"><option value="owner">Owner</option><option value="administrator">Administrator</option><option value="agent">Agent</option></select></label>
          <label>Initial password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
          <button type="submit">Add user</button>
        </form>}
        {resources.users.map((user) => readOnly
          ? <UserSummary key={user.public_id} user={user} />
          : <form className="resource-row user-row" key={user.public_id} onSubmit={(event) => updateUser(event, user)}>
            <label>Email<input name="email" type="email" defaultValue={user.email} required /></label>
            <label>Name<input name="displayName" defaultValue={user.display_name} required /></label>
            <label>Role<select name="role" defaultValue={user.role}><option value="owner">Owner</option><option value="administrator">Administrator</option><option value="agent">Agent</option></select></label>
            <label>Status<select name="status" defaultValue={user.status}><option value="1">Active</option><option value="2">Disabled</option></select></label>
            <button type="submit">Save</button>
          </form>)}
        {resources.users.length === 0 && <p className="empty">No tenant users.</p>}
      </ResourceSection>}

      {activeTab === 'api-keys' && <ResourceSection id="api-keys" title="API keys"
        description="Secrets are shown once and stored only as hashes.">
        {secret && <div className="secret-box" role="status"><strong>Copy this secret now:</strong><code>{secret}</code>
          <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(secret)}>Copy</button></div>}
        {!readOnly && <form className="resource-form" onSubmit={createApiKey}>
          <label>Key name<input name="name" required /></label>
          <label>Scopes<input name="scopes" placeholder="messages.read, messages.write" /></label>
          <label>Expires at (optional)<input name="expiresAt" type="datetime-local" /></label>
          <button type="submit">Create key</button>
        </form>}
        {resources.apiKeys.map((apiKey) => <ApiKeyRow key={apiKey.public_id} apiKey={apiKey}
          readOnly={readOnly} onRevoke={() => perform(
            () => adminApi.revokeApiKey(csrfToken, tenant, apiKey), 'API key revoked.'
          )} />)}
        {resources.apiKeys.length === 0 && <p className="empty">No API keys.</p>}
      </ResourceSection>}
    </>}
  </section>;
}

function ResourceTabButton({ id, label, count, activeTab, onSelect }: {
  id: ResourceTab;
  label: string;
  count: number;
  activeTab: ResourceTab;
  onSelect: (tab: ResourceTab) => void;
}) {
  const active = activeTab === id;
  return <button type="button" role="tab" id={`${id}-tab`} aria-selected={active}
    aria-controls={`${id}-panel`} className={`resource-tab${active ? ' active' : ''}`}
    onClick={() => onSelect(id)}>{label}<span>{count}</span></button>;
}

function ResourceSection({ id, title, description, children }: {
  id: ResourceTab; title: string; description: string; children: React.ReactNode;
}) {
  return <section className="card resource-section" role="tabpanel" id={`${id}-panel`}
    aria-labelledby={`${id}-tab`}><h3>{title}</h3><p>{description}</p>{children}</section>;
}

function SiteSummary({ site }: { site: TenantSite }) {
  return <div className="summary-row"><span>{site.name}</span><code>{site.widget_key}</code>
    <span>{site.allowed_domains.join(', ')}</span><span>{site.status === 1 ? 'Active' : 'Disabled'}</span></div>;
}

function UserSummary({ user }: { user: TenantUser }) {
  return <div className="summary-row"><span>{user.display_name}</span><span>{user.email}</span>
    <span>{user.role}</span><span>{user.status === 1 ? 'Active' : 'Disabled'}</span></div>;
}

function ApiKeyRow({ apiKey, readOnly, onRevoke }: {
  apiKey: TenantApiKey; readOnly: boolean; onRevoke: () => Promise<unknown>;
}) {
  const active = !apiKey.revoked_at;
  return <div className="summary-row"><span>{apiKey.name}</span><code>{apiKey.key_prefix}</code>
    <span>{apiKey.scopes.join(', ') || 'No scopes'}</span><span>{active ? 'Active' : 'Revoked'}</span>
    {!readOnly && active && <button type="button" className="danger" onClick={() => onRevoke()}>Revoke</button>}
  </div>;
}
