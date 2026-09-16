CREATE TABLE tenants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenants_slug_not_empty CHECK (BTRIM(slug) <> ''),
    CONSTRAINT tenants_name_not_empty CHECK (BTRIM(name) <> ''),
    CONSTRAINT tenants_status_valid CHECK (status IN (1, 2))
);

CREATE UNIQUE INDEX tenants_slug_unique
ON tenants (LOWER(slug));

COMMENT ON COLUMN tenants.status IS '1 = active, 2 = suspended';

CREATE TABLE platform_administrators (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'support',
    status SMALLINT NOT NULL DEFAULT 1,
    password_hash TEXT,
    identity_provider_subject TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,

    CONSTRAINT platform_administrators_email_not_empty
        CHECK (BTRIM(email) <> ''),
    CONSTRAINT platform_administrators_display_name_not_empty
        CHECK (BTRIM(display_name) <> ''),
    CONSTRAINT platform_administrators_role_valid
        CHECK (role IN ('support', 'operator', 'super_admin')),
    CONSTRAINT platform_administrators_status_valid
        CHECK (status IN (1, 2))
);

CREATE UNIQUE INDEX platform_administrators_email_unique
ON platform_administrators (LOWER(email));

CREATE UNIQUE INDEX platform_administrators_identity_unique
ON platform_administrators (identity_provider_subject)
WHERE identity_provider_subject IS NOT NULL;

COMMENT ON TABLE platform_administrators IS
    'Internal SaaS operators; these are not tenant agents or tenant owners';

COMMENT ON COLUMN platform_administrators.status IS
    '1 = active, 2 = disabled';
