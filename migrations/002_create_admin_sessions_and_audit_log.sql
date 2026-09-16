CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    administrator_id BIGINT NOT NULL
        REFERENCES platform_administrators(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX admin_sessions_administrator_idx
ON admin_sessions (administrator_id);

CREATE INDEX admin_sessions_expires_idx
ON admin_sessions (expires_at);

CREATE TABLE admin_audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    administrator_id BIGINT REFERENCES platform_administrators(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    tenant_id BIGINT REFERENCES tenants(id),
    reason TEXT,
    metadata JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_log_created_idx
ON admin_audit_log (created_at DESC);

CREATE INDEX admin_audit_log_tenant_idx
ON admin_audit_log (tenant_id, created_at DESC);
