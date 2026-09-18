import { FormEvent } from 'react';

import type { TenantSite } from '../../types';

export function SitesTab({ sites, readOnly, onCreate, onUpdate }: {
  sites: TenantSite[];
  readOnly: boolean;
  onCreate: (name: string, domains: string[]) => Promise<void>;
  onUpdate: (site: TenantSite) => Promise<void>;
}) {
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await onCreate(String(form.get('name')), list(form.get('domains')));
    element.reset();
  }

  async function update(event: FormEvent<HTMLFormElement>, site: TenantSite) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onUpdate({ ...site, name: String(form.get('name')),
      allowed_domains: list(form.get('domains')),
      status: Number(form.get('status')) as 1 | 2 });
  }

  return <section className="card resource-section" role="tabpanel" id="sites-panel"
    aria-labelledby="sites-tab"><h3>Sites</h3>
    <p>Publishable widget keys and allowed website domains. Add * to allow every domain.</p>
    {!readOnly && <form className="resource-form" onSubmit={create}>
      <label>Site name<input name="name" required maxLength={200} /></label>
      <label>Allowed domains<input name="domains" required placeholder="example.com, *.example.com, or * for all" /></label>
      <button type="submit">Add site</button>
    </form>}
    {sites.map((site) => readOnly
      ? <SiteSummary key={site.public_id} site={site} />
      : <form className="resource-row" key={site.public_id} onSubmit={(event) => update(event, site)}>
        <label>Name<input name="name" defaultValue={site.name} required /></label>
        <label>Allowed domains<input name="domains" defaultValue={site.allowed_domains.join(', ')} required /></label>
        <label>Status<select name="status" defaultValue={site.status}><option value="1">Active</option><option value="2">Disabled</option></select></label>
        <div className="resource-value"><span>Widget key</span><code>{site.widget_key}</code></div>
        <button type="submit">Save</button>
      </form>)}
    {sites.length === 0 && <p className="empty">No sites configured.</p>}
  </section>;
}

function SiteSummary({ site }: { site: TenantSite }) {
  return <div className="summary-row"><span>{site.name}</span>
    <div className="resource-value"><span>Widget key</span><code>{site.widget_key}</code></div>
    <span>{site.allowed_domains.join(', ')}</span><span>{site.status === 1 ? 'Active' : 'Disabled'}</span></div>;
}

function list(value: FormDataEntryValue | null) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}
