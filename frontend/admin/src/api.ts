import type {
  AdministratorRecord,
  AuditEntry,
  SessionResponse,
  Tenant,
  TenantApiKey,
  TenantResources,
  TenantSite,
  TenantUser
} from './types';

interface RequestOptions extends RequestInit {
  csrfToken?: string;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { csrfToken, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);

  if (requestOptions.body) headers.set('content-type', 'application/json');
  if (csrfToken && requestOptions.method && requestOptions.method !== 'GET') {
    headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(url, { ...requestOptions, headers });
  const body = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    const message = body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}

export const adminApi = {
  session: () => request<SessionResponse>('/api/admin/v1/session'),
  login: (email: string, password: string) => request<{ csrfToken: string }>(
    '/api/admin/v1/session',
    { method: 'POST', body: JSON.stringify({ email, password }) }
  ),
  logout: (csrfToken: string) => request<void>('/api/admin/v1/session', {
    method: 'DELETE', csrfToken
  }),
  tenants: () => request<{ tenants: Tenant[] }>('/api/admin/v1/tenants'),
  createTenant: (csrfToken: string, slug: string, name: string) =>
    request<{ tenant: Tenant }>('/api/admin/v1/tenants', {
      method: 'POST', csrfToken, body: JSON.stringify({ slug, name })
    }),
  updateTenant: (
    csrfToken: string,
    tenant: Tenant,
    details: {
      slug: string;
      name: string;
      status: 1 | 2;
      subscriptionType: string;
      subscriptionValidUntil: string | null;
    }
  ) => request<{ tenant: Tenant }>(
    `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}`,
    { method: 'PATCH', csrfToken, body: JSON.stringify(details) }
  ),
  tenantResources: (tenant: Tenant) => request<TenantResources>(
    `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/resources`
  ),
  createSite: (csrfToken: string, tenant: Tenant, name: string, allowedDomains: string[]) =>
    request<{ site: TenantSite }>(
      `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/sites`,
      { method: 'POST', csrfToken, body: JSON.stringify({ name, allowedDomains }) }
    ),
  updateSite: (csrfToken: string, tenant: Tenant, site: TenantSite) =>
    request<{ site: TenantSite }>(
      `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/sites/${encodeURIComponent(site.public_id)}`,
      { method: 'PATCH', csrfToken, body: JSON.stringify({
        name: site.name, allowedDomains: site.allowed_domains, status: site.status
      }) }
    ),
  createTenantUser: (csrfToken: string, tenant: Tenant, details: {
    email: string; displayName: string; role: TenantUser['role']; password: string;
  }) => request<{ user: TenantUser }>(
    `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/users`,
    { method: 'POST', csrfToken, body: JSON.stringify(details) }
  ),
  updateTenantUser: (csrfToken: string, tenant: Tenant, user: TenantUser) =>
    request<{ user: TenantUser }>(
      `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/users/${encodeURIComponent(user.public_id)}`,
      { method: 'PATCH', csrfToken, body: JSON.stringify({
        email: user.email, displayName: user.display_name, role: user.role, status: user.status
      }) }
    ),
  createApiKey: (csrfToken: string, tenant: Tenant, details: {
    name: string; scopes: string[]; expiresAt: string | null;
  }) => request<{ apiKey: TenantApiKey; secret: string }>(
    `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/api-keys`,
    { method: 'POST', csrfToken, body: JSON.stringify(details) }
  ),
  revokeApiKey: (csrfToken: string, tenant: Tenant, apiKey: TenantApiKey) =>
    request<void>(
      `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/api-keys/${encodeURIComponent(apiKey.public_id)}`,
      { method: 'DELETE', csrfToken }
    ),
  administrators: () => request<{ administrators: AdministratorRecord[] }>(
    '/api/admin/v1/administrators'
  ),
  createAdministrator: (csrfToken: string, details: {
    email: string; displayName: string; role: AdministratorRecord['role']; password: string;
  }) => request<{ administrator: AdministratorRecord }>('/api/admin/v1/administrators', {
    method: 'POST', csrfToken, body: JSON.stringify(details)
  }),
  updateAdministrator: (csrfToken: string, administrator: AdministratorRecord, details: {
    email: string; displayName: string; role: AdministratorRecord['role']; status: 1 | 2;
    password?: string;
  }) => request<{ administrator: AdministratorRecord }>(
    `/api/admin/v1/administrators/${encodeURIComponent(administrator.public_id)}`,
    { method: 'PATCH', csrfToken, body: JSON.stringify(details) }
  ),
  auditLog: (before?: string) => request<{ entries: AuditEntry[]; nextBefore: string | null }>(
    `/api/admin/v1/audit-log${before ? `?before=${encodeURIComponent(before)}` : ''}`
  ),
  changePassword: (csrfToken: string, currentPassword: string, newPassword: string) =>
    request<{ message: string }>('/api/admin/v1/password', {
      method: 'PATCH', csrfToken, body: JSON.stringify({ currentPassword, newPassword })
    })
};
