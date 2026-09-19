export type Role = 'owner' | 'administrator' | 'agent';
export interface Session { csrfToken: string; user: { publicId: string; email: string; displayName: string; role: Role }; tenant: { publicId: string; slug: string; name: string } }
export interface Site { public_id: string; name: string; widget_key: string; allowed_domains: string[]; status: 1 | 2 }
export interface User { public_id: string; email: string; display_name: string; role: Role; status: 1 | 2; last_login_at: string | null }
export interface Room { public_id: string; title: string; visibility: 'tenant' | 'private'; pinned: boolean; creator_name: string; last_message: string | null }
export interface Message { public_id: string; content: string; created_at: string; sender_public_id: string; sender_name: string }
