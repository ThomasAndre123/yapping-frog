import type { AuditEntry, Message, Room, Session, Site, User } from './types';

async function request<T>(url: string, options: RequestInit & { csrf?: string } = {}): Promise<T> {
  const { csrf, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (csrf) headers.set('x-csrf-token', csrf);
  const response = await fetch(url, { ...init, headers });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body as T;
}

export const tenantApi = {
  session: () => request<Session>('/api/tenant/v1/session'),
  login: (tenant: string, email: string, password: string) => request('/api/tenant/v1/session', { method: 'POST', body: JSON.stringify({ tenant, email, password }) }),
  logout: (csrf: string) => request<void>('/api/tenant/v1/session', { method: 'DELETE', csrf }),
  sites: () => request<{ sites: Site[] }>('/api/tenant/v1/sites'),
  createSite: (csrf: string, name: string, allowedDomains: string[]) => request('/api/tenant/v1/sites', { method: 'POST', csrf, body: JSON.stringify({ name, allowedDomains }) }),
  updateSite: (csrf: string, site: Site) => request(`/api/tenant/v1/sites/${site.public_id}`, { method: 'PATCH', csrf, body: JSON.stringify({ name: site.name, allowedDomains: site.allowed_domains, status: site.status }) }),
  users: () => request<{ users: User[] }>('/api/tenant/v1/users'),
  createUser: (csrf: string, details: object) => request('/api/tenant/v1/users', { method: 'POST', csrf, body: JSON.stringify(details) }),
  updateUser: (csrf: string, user: User & { password?: string }) => request(`/api/tenant/v1/users/${user.public_id}`, { method: 'PATCH', csrf, body: JSON.stringify({ email: user.email, displayName: user.display_name, role: user.role, status: user.status, ...(user.password ? { password: user.password } : {}) }) }),
  rooms: () => request<{ rooms: Room[] }>('/api/tenant/v1/rooms'),
  createRoom: (csrf: string, details: object) => request('/api/tenant/v1/rooms', { method: 'POST', csrf, body: JSON.stringify(details) }),
  updateRoom: (csrf: string, room: Room) => request(`/api/tenant/v1/rooms/${room.public_id}`, { method: 'PATCH', csrf, body: JSON.stringify({ title: room.title, pinned: room.pinned }) }),
  messages: (roomId: string) => request<{ messages: Message[] }>(`/api/tenant/v1/rooms/${roomId}/messages`),
  sendMessage: (csrf: string, roomId: string, content: string) => request(`/api/tenant/v1/rooms/${roomId}/messages`, { method: 'POST', csrf, body: JSON.stringify({ content }) }),
  auditLog: () => request<{ entries: AuditEntry[] }>('/api/tenant/v1/audit-log')
};
