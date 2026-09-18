import { FormEvent } from 'react';

import type { TenantApiKey } from '../../types';

export function ApiKeysTab({ apiKeys, secret, readOnly, onCreate, onRevoke }: {
  apiKeys: TenantApiKey[];
  secret?: string;
  readOnly: boolean;
  onCreate: (details: { name: string; scopes: string[]; expiresAt: string | null }) => Promise<void>;
  onRevoke: (apiKey: TenantApiKey) => Promise<void>;
}) {
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await onCreate({ name: String(form.get('name')), scopes: list(form.get('scopes')),
      expiresAt: form.get('expiresAt') ? new Date(String(form.get('expiresAt'))).toISOString() : null });
    element.reset();
  }

  return <section className="card resource-section" role="tabpanel" id="api-keys-panel"
    aria-labelledby="api-keys-tab"><h3>API keys</h3>
    <p>Secrets are shown once and stored only as hashes.</p>
    {secret && <div className="secret-box" role="status"><strong>Copy this secret now:</strong><code>{secret}</code>
      <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(secret)}>Copy</button></div>}
    {!readOnly && <form className="resource-form" onSubmit={create}>
      <label>Key name<input name="name" required /></label>
      <label>Scopes<input name="scopes" placeholder="messages.read, messages.write" /></label>
      <label>Expires at (optional)<input name="expiresAt" type="datetime-local" /></label>
      <button type="submit">Create key</button>
    </form>}
    {apiKeys.map((apiKey) => <ApiKeyRow key={apiKey.public_id} apiKey={apiKey}
      readOnly={readOnly} onRevoke={() => onRevoke(apiKey)} />)}
    {apiKeys.length === 0 && <p className="empty">No API keys.</p>}
  </section>;
}

function ApiKeyRow({ apiKey, readOnly, onRevoke }: {
  apiKey: TenantApiKey; readOnly: boolean; onRevoke: () => Promise<void>;
}) {
  const active = !apiKey.revoked_at;
  return <div className="summary-row"><span>{apiKey.name}</span><code>{apiKey.key_prefix}</code>
    <span>{apiKey.scopes.join(', ') || 'No scopes'}</span><span>{active ? 'Active' : 'Revoked'}</span>
    {!readOnly && active && <button type="button" className="danger" onClick={onRevoke}>Revoke</button>}
  </div>;
}

function list(value: FormDataEntryValue | null) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}
