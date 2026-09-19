CREATE TABLE tenant_audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_user_id BIGINT REFERENCES tenant_users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    metadata JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tenant_audit_log_tenant_created_idx
ON tenant_audit_log (tenant_id, id DESC);

COMMENT ON COLUMN tenant_audit_log.metadata IS
    'Non-sensitive tenant activity context; credentials and secrets must never be stored here.';
