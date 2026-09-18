export type AdministratorRole = 'support' | 'operator' | 'super_admin';

export interface AdministratorIdentity {
  publicId: string;
  email: string;
  displayName: string;
  role: AdministratorRole;
}

export interface SessionResponse {
  administrator: AdministratorIdentity;
  csrfToken: string;
}

export interface Tenant {
  public_id: string;
  slug: string;
  name: string;
  status: 1 | 2;
  subscription_type: string;
  subscription_valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdministratorRecord {
  public_id: string;
  email: string;
  display_name: string;
  role: AdministratorRole;
  status: number;
  created_at: string;
  last_login_at: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  ip_address: string | null;
  created_at: string;
  reason: string | null;
  metadata: unknown | null;
  administrator_public_id: string | null;
  administrator_email: string | null;
  administrator_name: string | null;
}

export interface TenantSite {
  public_id: string;
  name: string;
  widget_key: string;
  allowed_domains: string[];
  status: 1 | 2;
  created_at: string;
  updated_at: string;
}

export interface TenantUser {
  public_id: string;
  email: string;
  display_name: string;
  role: 'owner' | 'administrator' | 'agent';
  status: 1 | 2;
  created_at: string;
  last_login_at: string | null;
}

export interface TenantApiKey {
  public_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface TenantResources {
  sites: TenantSite[];
  users: TenantUser[];
  apiKeys: TenantApiKey[];
}
