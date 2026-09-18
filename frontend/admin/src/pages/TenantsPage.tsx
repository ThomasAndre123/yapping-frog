import { FormEvent, useEffect, useState } from 'react';

import type { Tenant } from '../types';
import { TenantResourcesPage } from './TenantResourcesPage';
import type { ResourceTab } from './TenantResourcesPage';

export interface TenantUpdateDetails {
  slug: string;
  name: string;
  status: 1 | 2;
  subscriptionType: string;
  subscriptionValidUntil: string | null;
}

interface TenantsPageProps {
  tenants: Tenant[];
  readOnly: boolean;
  csrfToken: string;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onUpdate: (tenant: Tenant, details: TenantUpdateDetails) => Promise<void>;
  onNotice: (message: string, success?: boolean) => void;
  onResourcesMutated?: () => Promise<void>;
}

export function TenantsPage({
  tenants,
  readOnly,
  csrfToken,
  onCreate,
  onRefresh,
  onUpdate,
  onNotice,
  onResourcesMutated
}: TenantsPageProps) {
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [resourceRoute, setResourceRoute] = useState(readResourceRoute);
  const viewing = resourceRoute
    ? tenants.find((tenant) => tenant.slug === resourceRoute.slug) ?? null
    : null;

  useEffect(() => {
    function syncRoute() { setResourceRoute(readResourceRoute()); }
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  function viewTenant(tenant: Tenant) {
    const route = { slug: tenant.slug, tab: 'sites' as ResourceTab };
    setResourceRoute(route);
    setEditing(null);
    window.history.pushState(null, '', `#tenants/${encodeURIComponent(tenant.slug)}/sites`);
  }

  function closeResources() {
    setResourceRoute(null);
    window.history.pushState(null, '', '#tenants');
  }

  if (viewing) return <TenantResourcesPage
    tenant={viewing}
    csrfToken={csrfToken}
    readOnly={readOnly}
    initialTab={resourceRoute?.tab ?? 'sites'}
    initialUserId={resourceRoute?.userId}
    onClose={closeResources}
    onNotice={onNotice}
    onMutated={onResourcesMutated}
  />;

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
    {editing && <EditTenantForm
      key={editing.public_id}
      tenant={editing}
      onCancel={() => setEditing(null)}
      onSave={async (details) => {
        await onUpdate(editing, details);
        setEditing(null);
      }}
    />}
    <div className="card table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Subscription</th><th>Valid until</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{tenants.map((tenant) => <tr key={tenant.public_id}>
          <td>{tenant.name}</td><td>{tenant.slug}</td>
          <td><span className="subscription-type">{tenant.subscription_type}</span></td>
          <td>{tenant.subscription_valid_until
            ? <span className={new Date(tenant.subscription_valid_until) < new Date() ? 'expired' : ''}>
              {new Date(tenant.subscription_valid_until).toLocaleString()}
            </span>
            : <span className="forever">Forever</span>}</td>
          <td><span className={`status${tenant.status === 2 ? ' suspended' : ''}`}>
            {tenant.status === 1 ? 'Active' : 'Suspended'}
          </span></td>
          <td><div className="row-actions">
            <button type="button" className="secondary" onClick={() => viewTenant(tenant)}>Details</button>
            {!readOnly && <button type="button" onClick={() => setEditing(tenant)}>Edit</button>}
          </div></td>
        </tr>)}</tbody>
      </table>
      {tenants.length === 0 && <p className="empty">No tenants have been created.</p>}
    </div>
  </section>;
}

function readResourceRoute(): { slug: string; tab: ResourceTab; userId?: string } | null {
  const match = window.location.hash.match(
    /^#tenants\/([^/]+)(?:\/(sites|users|api-keys))?(?:\/([^/]+))?$/
  );
  if (!match) return null;
  try {
    const tab = (match[2] ?? 'sites') as ResourceTab;
    if (match[3] && tab !== 'users') return null;
    return {
      slug: decodeURIComponent(match[1]),
      tab,
      ...(match[3] ? { userId: decodeURIComponent(match[3]) } : {})
    };
  } catch {
    return null;
  }
}

function EditTenantForm({ tenant, onCancel, onSave }: {
  tenant: Tenant;
  onCancel: () => void;
  onSave: (details: TenantUpdateDetails) => Promise<void>;
}) {
  const [forever, setForever] = useState(tenant.subscription_valid_until === null);
  const [saving, setSaving] = useState(false);
  const localExpiration = tenant.subscription_valid_until
    ? toLocalDateTimeValue(tenant.subscription_valid_until)
    : '';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiration = String(form.get('subscriptionValidUntil'));
    setSaving(true);
    try {
      await onSave({
        slug: String(form.get('slug')),
        name: String(form.get('name')),
        status: Number(form.get('status')) as 1 | 2,
        subscriptionType: String(form.get('subscriptionType')),
        subscriptionValidUntil: forever ? null : new Date(expiration).toISOString()
      });
    } catch {
      // The parent displays the API error and the form remains open for correction.
    } finally {
      setSaving(false);
    }
  }

  return <form className="card edit-tenant-form" onSubmit={submit}>
    <div className="form-heading">
      <div><h3>Edit tenant</h3><p>Update identity and subscription access for {tenant.name}.</p></div>
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </div>
    <div className="edit-fields">
      <label>Slug<input name="slug" defaultValue={tenant.slug} required pattern="[a-z0-9][a-z0-9-]{1,62}" /></label>
      <label>Name<input name="name" defaultValue={tenant.name} required maxLength={200} /></label>
      <label>Status
        <select name="status" defaultValue={tenant.status} required>
          <option value="1">Active</option><option value="2">Suspended</option>
        </select>
      </label>
      <label>Subscription type<input name="subscriptionType" defaultValue={tenant.subscription_type} required maxLength={50} pattern="[a-z0-9][a-z0-9_-]{0,49}" /></label>
      <label>Valid until
        <input name="subscriptionValidUntil" type="datetime-local" defaultValue={localExpiration}
          disabled={forever} required={!forever} />
      </label>
    </div>
    <label className="checkbox-label">
      <input type="checkbox" checked={forever} onChange={(event) => setForever(event.target.checked)} />
      Valid forever
    </label>
    <div><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save tenant'}</button></div>
  </form>;
}

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}
