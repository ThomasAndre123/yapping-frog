DROP INDEX IF EXISTS admin_audit_log_tenant_idx;

ALTER TABLE admin_audit_log
DROP COLUMN tenant_id;

COMMENT ON COLUMN admin_audit_log.metadata IS
    'Non-sensitive, action-specific context. Never store credentials, secrets, tokens, or password hashes.';
