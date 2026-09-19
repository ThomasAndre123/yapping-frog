import {
    FormEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { tenantApi } from '../api';
import type { Message, Room, Session } from '../types';

export function ChatRoomsPage({
    rooms,
    session,
    canManage,
    messageVersion,
    onCreate,
    onEdit,
    onRead,
}: {
    rooms: Room[];
    session: Session;
    canManage: boolean;
    messageVersion: number;
    onCreate: () => void;
    onEdit: (room: Room) => void;
    onRead: () => Promise<void>;
}) {
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Room>();
    const [messages, setMessages] = useState<Message[]>([]);
    const messageViewport = useRef<HTMLDivElement>(null);
    const stickToBottom = useRef(true);

    const filtered = rooms.filter((room) =>
        room.title.toLowerCase().includes(search.toLowerCase()),
    );

    const fetchMessages = useCallback(async (room: Room) => {
        const result = await tenantApi.messages(room.public_id);
        setMessages(result.messages);
    }, []);

    useEffect(() => {
        if (!selected) {
            return;
        }

        const refresh = async () => {
            await fetchMessages(selected);
            await tenantApi.markRoomRead(session.csrfToken, selected.public_id);
            await onRead();
        };

        refresh().catch(() => {});
    }, [selected, messageVersion, fetchMessages, onRead, session.csrfToken]);

    useLayoutEffect(() => {
        const viewport = messageViewport.current;

        if (viewport && stickToBottom.current && windowIsActive()) {
            viewport.scrollTo({
                top: viewport.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, [messages]);

    useEffect(() => {
        function catchUp() {
            const viewport = messageViewport.current;

            if (viewport && stickToBottom.current && windowIsActive()) {
                viewport.scrollTo({
                    top: viewport.scrollHeight,
                    behavior: 'smooth',
                });
            }
        }

        window.addEventListener('focus', catchUp);
        document.addEventListener('visibilitychange', catchUp);

        return () => {
            window.removeEventListener('focus', catchUp);
            document.removeEventListener('visibilitychange', catchUp);
        };
    }, []);

    function selectRoom(room: Room) {
        stickToBottom.current = true;
        setMessages([]);
        setSelected(room);
    }

    function showRoomList() {
        setSelected(undefined);
        setMessages([]);
    }

    return (
        <div className={`chat-layout ${selected ? 'has-selection' : ''}`}>
            <section className="card rooms">
                <div className="title-row">
                    <h2>Rooms</h2>
                    <button onClick={onCreate}>Create room</button>
                </div>

                <input
                    className="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search rooms…"
                    aria-label="Search rooms"
                />

                <div className="room-list">
                    {filtered.map((room) => (
                        <button
                            className={
                                selected?.public_id === room.public_id ? 'selected' : ''
                            }
                            key={room.public_id}
                            onClick={() => selectRoom(room)}
                        >
                            <span>
                                {room.pinned ? '📌 ' : ''}
                                {room.title}
                                {room.unread_count > 0 && (
                                    <b className="badge">{room.unread_count}</b>
                                )}
                            </span>
                            <small>
                                {room.visibility} · {room.last_message ?? 'No messages'}
                            </small>
                        </button>
                    ))}

                    {filtered.length === 0 && (
                        <p className="empty">No matching rooms.</p>
                    )}
                </div>
            </section>

            <section className="card conversation">
                {!selected ? (
                    <div className="empty">Select a room to start chatting.</div>
                ) : (
                    <>
                        <button className="chat-back muted" onClick={showRoomList}>
                            ← Back to rooms
                        </button>

                        <div className="title-row conversation-title">
                            <div>
                                <h2>{selected.title}</h2>
                                <p>{selected.visibility} room</p>
                            </div>
                            {canManage && (
                                <button
                                    className="muted"
                                    onClick={() => onEdit(selected)}
                                >
                                    Edit room
                                </button>
                            )}
                        </div>

                        <div
                            className="messages"
                            ref={messageViewport}
                            onScroll={(event) => {
                                const viewport = event.currentTarget;
                                stickToBottom.current =
                                    viewport.scrollHeight -
                                        viewport.scrollTop -
                                        viewport.clientHeight <
                                    48;
                            }}
                        >
                            {messages.map((message) => (
                                <div
                                    className={
                                        message.sender_public_id === session.user.publicId
                                            ? 'message mine'
                                            : 'message'
                                    }
                                    key={message.public_id}
                                >
                                    <strong>{message.sender_name}</strong>
                                    <p>{message.content}</p>
                                    <small>
                                        {new Date(message.created_at).toLocaleString()}
                                    </small>
                                </div>
                            ))}
                        </div>

                        <Composer
                            onSend={async (content) => {
                                await tenantApi.sendMessage(
                                    session.csrfToken,
                                    selected.public_id,
                                    content,
                                );
                                await fetchMessages(selected);
                            }}
                        />
                    </>
                )}
            </section>
        </div>
    );
}

function Composer({ onSend }: { onSend: (content: string) => Promise<void> }) {
    return (
        <form
            className="composer"
            onSubmit={async (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();

                const form = event.currentTarget;
                const data = new FormData(form);

                await onSend(String(data.get('content')));
                form.reset();
            }}
        >
            <input
                name="content"
                required
                maxLength={10000}
                placeholder="Write a message…"
            />
            <button>Send</button>
        </form>
    );
}

function windowIsActive() {
    return document.visibilityState === 'visible' && document.hasFocus();
}
