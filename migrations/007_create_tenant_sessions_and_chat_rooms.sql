CREATE TABLE tenant_sessions (
    token_hash TEXT PRIMARY KEY,
    tenant_user_id BIGINT NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX tenant_sessions_user_idx ON tenant_sessions (tenant_user_id);
CREATE INDEX tenant_sessions_expires_idx ON tenant_sessions (expires_at);

CREATE TABLE tenant_chat_rooms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'tenant',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_by BIGINT NOT NULL REFERENCES tenant_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_chat_rooms_title_not_empty CHECK (BTRIM(title) <> ''),
    CONSTRAINT tenant_chat_rooms_visibility_valid CHECK (visibility IN ('tenant', 'private'))
);

CREATE INDEX tenant_chat_rooms_tenant_idx
ON tenant_chat_rooms (tenant_id, pinned DESC, updated_at DESC);

CREATE TABLE tenant_chat_room_members (
    room_id BIGINT NOT NULL REFERENCES tenant_chat_rooms(id) ON DELETE CASCADE,
    tenant_user_id BIGINT NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, tenant_user_id)
);

CREATE TABLE tenant_chat_messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    room_id BIGINT NOT NULL REFERENCES tenant_chat_rooms(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES tenant_users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_chat_messages_content_not_empty CHECK (BTRIM(content) <> '')
);

CREATE INDEX tenant_chat_messages_room_idx
ON tenant_chat_messages (room_id, id DESC);
