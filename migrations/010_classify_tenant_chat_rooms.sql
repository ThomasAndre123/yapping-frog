ALTER TABLE tenant_chat_rooms
ADD COLUMN room_kind TEXT NOT NULL DEFAULT 'internal';

ALTER TABLE tenant_chat_rooms
ADD CONSTRAINT tenant_chat_rooms_kind_valid
CHECK (room_kind IN ('internal', 'visitor'));

COMMENT ON COLUMN tenant_chat_rooms.room_kind IS
    'internal rooms may be deleted by tenant managers; visitor rooms must be retained through their conversation lifecycle';
