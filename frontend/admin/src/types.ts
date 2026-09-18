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
  administrator_email: string | null;
  administrator_name: string | null;
  tenant_name: string | null;
}
