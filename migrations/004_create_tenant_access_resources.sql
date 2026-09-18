CREATE TABLE tenant_sites (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    widget_key TEXT NOT NULL UNIQUE,
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenant_sites_name_not_empty CHECK (BTRIM(name) <> ''),
    CONSTRAINT tenant_sites_status_valid CHECK (status IN (1, 2))
);

CREATE INDEX tenant_sites_tenant_idx ON tenant_sites (tenant_id);

COMMENT ON COLUMN tenant_sites.widget_key IS
    'Publishable embed identifier; it is not an authentication secret';
COMMENT ON COLUMN tenant_sites.allowed_domains IS
    'Normalized exact hostnames or leading wildcard patterns such as *.example.com';

CREATE TABLE tenant_users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    status SMALLINT NOT NULL DEFAULT 1,
    password_hash TEXT,
    identity_provider_subject TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,

    CONSTRAINT tenant_users_email_not_empty CHECK (BTRIM(email) <> ''),
    CONSTRAINT tenant_users_display_name_not_empty CHECK (BTRIM(display_name) <> ''),
    CONSTRAINT tenant_users_role_valid CHECK (role IN ('owner', 'administrator', 'agent')),
    CONSTRAINT tenant_users_status_valid CHECK (status IN (1, 2))
);

CREATE UNIQUE INDEX tenant_users_tenant_email_unique
ON tenant_users (tenant_id, LOWER(email));
CREATE UNIQUE INDEX tenant_users_identity_unique
ON tenant_users (identity_provider_subject)
WHERE identity_provider_subject IS NOT NULL;

CREATE TABLE tenant_api_keys (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    secret_hash TEXT NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT tenant_api_keys_name_not_empty CHECK (BTRIM(name) <> '')
);

CREATE INDEX tenant_api_keys_tenant_idx ON tenant_api_keys (tenant_id);
CREATE INDEX tenant_api_keys_active_hash_idx
ON tenant_api_keys (secret_hash)
WHERE revoked_at IS NULL;

COMMENT ON COLUMN tenant_api_keys.secret_hash IS
    'SHA-256 hash of the secret; the plaintext key is returned only at creation';
