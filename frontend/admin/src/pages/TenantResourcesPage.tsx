import { useCallback, useEffect, useState } from 'react';

import { adminApi } from '../api';
import type { Tenant, TenantApiKey, TenantResources, TenantSite, TenantUser } from '../types';
import { ApiKeysTab } from './tenant-resources/ApiKeysTab';
import { SitesTab } from './tenant-resources/SitesTab';
import { UsersTab } from './tenant-resources/UsersTab';

interface Props {
  tenant: Tenant;
  csrfToken: string;
  readOnly: boolean;
  initialTab: ResourceTab;
  onClose: () => void;
  onNotice: (message: string, success?: boolean) => void;
  onMutated?: () => Promise<void>;
}

export type ResourceTab = 'sites' | 'users' | 'api-keys';

export function TenantResourcesPage({
  tenant, csrfToken, readOnly, initialTab, onClose, onNotice, onMutated
}: Props) {
  const [resources, setResources] = useState<TenantResources>();
  const [secret, setSecret] = useState<string>();
  const [activeTab, setActiveTab] = useState<ResourceTab>(initialTab);

  const load = useCallback(async () => {
    setResources(await adminApi.tenantResources(tenant));
  }, [tenant]);

  useEffect(() => {
    load().catch((error) => onNotice(message(error)));
  }, [load, onNotice]);

  useEffect(() => setActiveTab(initialTab), [initialTab]);

  async function perform(operation: () => Promise<unknown>, success: string) {
    try {
      await operation();
      onNotice(success, true);
      await load();
      await onMutated?.();
    } catch (error) {
      onNotice(message(error));
      throw error;
    }
  }

  function selectTab(tab: ResourceTab) {
    setActiveTab(tab);
    window.history.pushState(null, '', `#tenants/${encodeURIComponent(tenant.slug)}/${tab}`);
  }

  return <section className="panel active tenant-resources" aria-labelledby="resources-title">
    <div className="toolbar">
      <div><h2 id="resources-title">{tenant.name}</h2><p>Sites, users, and server API keys.</p></div>
      <button type="button" className="secondary" onClick={onClose}>Back to tenants</button>
    </div>

    {!resources ? <p className="card">Loading tenant data…</p> : <>
      <nav className="resource-tabs" role="tablist" aria-label="Tenant resources">
        <ResourceTabButton id="sites" label="Sites" count={resources.sites.length}
          activeTab={activeTab} onSelect={selectTab} />
        <ResourceTabButton id="users" label="Users" count={resources.users.length}
          activeTab={activeTab} onSelect={selectTab} />
        <ResourceTabButton id="api-keys" label="API keys" count={resources.apiKeys.length}
          activeTab={activeTab} onSelect={selectTab} />
      </nav>

      {activeTab === 'sites' && <SitesTab sites={resources.sites} readOnly={readOnly}
        onCreate={(name, domains) => perform(
          () => adminApi.createSite(csrfToken, tenant, name, domains), 'Site created.')}
        onUpdate={(site: TenantSite) => perform(
          () => adminApi.updateSite(csrfToken, tenant, site), 'Site updated.')} />}

      {activeTab === 'users' && <UsersTab users={resources.users} readOnly={readOnly}
        onCreate={(details) => perform(
          () => adminApi.createTenantUser(csrfToken, tenant, details), 'Tenant user created.')}
        onUpdate={(user: TenantUser) => perform(
          () => adminApi.updateTenantUser(csrfToken, tenant, user), 'Tenant user updated.')} />}

      {activeTab === 'api-keys' && <ApiKeysTab apiKeys={resources.apiKeys} secret={secret}
        readOnly={readOnly}
        onCreate={async (details) => {
          try {
            const result = await adminApi.createApiKey(csrfToken, tenant, details);
            setSecret(result.secret);
            onNotice('API key created. Copy its secret now.', true);
            await load();
            await onMutated?.();
          } catch (error) {
            onNotice(message(error));
            throw error;
          }
        }}
        onRevoke={(apiKey: TenantApiKey) => perform(
          () => adminApi.revokeApiKey(csrfToken, tenant, apiKey), 'API key revoked.')} />}
    </>}
  </section>;
}

function ResourceTabButton({ id, label, count, activeTab, onSelect }: {
  id: ResourceTab; label: string; count: number; activeTab: ResourceTab;
  onSelect: (tab: ResourceTab) => void;
}) {
  const active = activeTab === id;
  return <button type="button" role="tab" id={`${id}-tab`} aria-selected={active}
    aria-controls={`${id}-panel`} className={`resource-tab${active ? ' active' : ''}`}
    onClick={() => onSelect(id)}>{label}<span>{count}</span></button>;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred';
}
