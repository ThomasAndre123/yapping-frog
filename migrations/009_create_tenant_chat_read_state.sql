CREATE TABLE tenant_chat_room_reads (
    room_id BIGINT NOT NULL REFERENCES tenant_chat_rooms(id) ON DELETE CASCADE,
    tenant_user_id BIGINT NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    last_read_message_id BIGINT REFERENCES tenant_chat_messages(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, tenant_user_id)
);

CREATE INDEX tenant_chat_room_reads_user_idx
ON tenant_chat_room_reads (tenant_user_id, updated_at DESC);
