import type {
  AdministratorRecord,
  AuditEntry,
  SessionResponse,
  Tenant
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
  setTenantStatus: (csrfToken: string, tenant: Tenant, status: 1 | 2) =>
    request<{ tenant: Tenant }>(
      `/api/admin/v1/tenants/${encodeURIComponent(tenant.public_id)}/status`,
      { method: 'PATCH', csrfToken, body: JSON.stringify({ status }) }
    ),
  administrators: () => request<{ administrators: AdministratorRecord[] }>(
    '/api/admin/v1/administrators'
  ),
  auditLog: (before?: string) => request<{ entries: AuditEntry[]; nextBefore: string | null }>(
    `/api/admin/v1/audit-log${before ? `?before=${encodeURIComponent(before)}` : ''}`
  ),
  changePassword: (csrfToken: string, currentPassword: string, newPassword: string) =>
    request<{ message: string }>('/api/admin/v1/password', {
      method: 'PATCH', csrfToken, body: JSON.stringify({ currentPassword, newPassword })
    })
};
