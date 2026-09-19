CREATE TABLE widget_visitors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    site_id BIGINT NOT NULL REFERENCES tenant_sites(id) ON DELETE CASCADE,
    external_user_id TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX widget_visitors_site_external_user_unique
ON widget_visitors (site_id, external_user_id)
WHERE external_user_id IS NOT NULL;

CREATE TABLE widget_visitor_sessions (
    token_hash TEXT PRIMARY KEY,
    visitor_id BIGINT NOT NULL REFERENCES widget_visitors(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX widget_visitor_sessions_visitor_idx
ON widget_visitor_sessions (visitor_id);

ALTER TABLE tenant_chat_rooms
ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE tenant_chat_rooms
ADD COLUMN visitor_id BIGINT REFERENCES widget_visitors(id) ON DELETE RESTRICT;

CREATE INDEX tenant_chat_rooms_visitor_idx
ON tenant_chat_rooms (visitor_id, updated_at DESC)
WHERE visitor_id IS NOT NULL;

ALTER TABLE tenant_chat_rooms
ADD CONSTRAINT tenant_chat_rooms_creator_valid
CHECK (
    (room_kind = 'internal' AND created_by IS NOT NULL AND visitor_id IS NULL)
    OR
    (room_kind = 'visitor' AND created_by IS NULL AND visitor_id IS NOT NULL)
);

ALTER TABLE tenant_chat_messages
ALTER COLUMN sender_id DROP NOT NULL;

ALTER TABLE tenant_chat_messages
ADD COLUMN visitor_id BIGINT REFERENCES widget_visitors(id) ON DELETE RESTRICT;

ALTER TABLE tenant_chat_messages
ADD CONSTRAINT tenant_chat_messages_sender_valid
CHECK (NUM_NONNULLS(sender_id, visitor_id) = 1);

COMMENT ON COLUMN widget_visitors.external_user_id IS
    'Stable customer identifier supplied only by the tenant backend through the identify endpoint';
