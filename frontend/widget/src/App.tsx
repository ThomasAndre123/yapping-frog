import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { widgetApi, type WidgetMessage } from './api';

const params = new URLSearchParams(window.location.search);
const requestedSiteKey = params.get('siteKey') ?? undefined;
const savedVisitorToken = params.get('visitorToken') ?? undefined;
const configuredParentOrigin = params.get('parentOrigin');
const parentOrigin = configuredParentOrigin ?? '*';

export function App() {
    const [open, setOpen] = useState(false);
    const [siteName, setSiteName] = useState('Support');
    const [visitorToken, setVisitorToken] = useState<string>();
    const [displayName, setDisplayName] = useState<string>();
    const [messages, setMessages] = useState<WidgetMessage[]>([]);
    const [error, setError] = useState<string>();
    const [sending, setSending] = useState(false);
    const messageList = useRef<HTMLDivElement>(null);

    const loadMessages = useCallback(async (token: string) => {
        const result = await widgetApi.messages(token);
        setMessages(result.messages);
    }, []);

    useEffect(() => {
        const start = async () => {
            const siteKey = requestedSiteKey ?? (await widgetApi.config()).siteKey;
            const storageKey = `yapping-frog:${siteKey}:visitor-token`;
            const storedToken = window.localStorage.getItem(storageKey) ?? undefined;
            const result = await widgetApi.session(
                siteKey,
                savedVisitorToken ?? storedToken,
            );

            window.localStorage.setItem(storageKey, result.visitorToken);

            return { ...result, siteKey };
        };

        start()
            .then(async (result) => {
                setVisitorToken(result.visitorToken);
                setDisplayName(result.visitor.display_name ?? undefined);
                setSiteName(result.site.name);
                window.parent.postMessage(
                    {
                        type: 'yapping-frog.visitor-token',
                        siteKey: result.siteKey,
                        visitorToken: result.visitorToken,
                    },
                    parentOrigin,
                );
                await loadMessages(result.visitorToken);
            })
            .catch((reason) => setError(reason.message));
    }, [loadMessages]);

    useEffect(() => {
        if (!visitorToken) {
            return;
        }

        let socket: WebSocket | undefined;
        let reconnectTimer: number | undefined;
        let active = true;

        const connect = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const url = new URL(`${protocol}//${window.location.host}/ws`);

            url.searchParams.set('visitorToken', visitorToken);

            if (configuredParentOrigin) {
                url.searchParams.set('origin', configuredParentOrigin);
            }

            socket = new WebSocket(url);

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    if (
                        message.type === 'tenant.message.created' ||
                        message.type === 'tenant.room.updated'
                    ) {
                        loadMessages(visitorToken).catch(() => {});
                    }
                } catch {}
            };

            socket.onclose = () => {
                if (active) {
                    reconnectTimer = window.setTimeout(connect, 1500);
                }
            };
        };

        connect();

        return () => {
            active = false;

            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
            }

            socket?.close();
        };
    }, [visitorToken, loadMessages]);

    useEffect(() => {
        const list = messageList.current;

        if (open && list) {
            list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
        }
    }, [messages, open]);

    async function send(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!visitorToken) {
            return;
        }

        const form = event.currentTarget;
        const data = new FormData(form);
        const content = String(data.get('message') ?? '').trim();

        if (!content) {
            return;
        }

        setSending(true);
        setError(undefined);

        try {
            const result = await widgetApi.send(visitorToken, content);
            setMessages((current) => [...current, result.message]);
            form.reset();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not send message');
        } finally {
            setSending(false);
        }
    }

    async function saveName(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!visitorToken) {
            return;
        }

        const form = event.currentTarget;
        const data = new FormData(form);
        const name = String(data.get('displayName') ?? '').trim();

        if (!name) {
            return;
        }

        try {
            const result = await widgetApi.updateProfile(visitorToken, name);
            setDisplayName(result.visitor.display_name);
            setError(undefined);
            await loadMessages(visitorToken);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save name');
        }
    }

    return (
        <div className="widget">
            {open && (
                <section className="panel" aria-label={`${siteName} chat`}>
                    <header>
                        <div>
                            <strong>{siteName}</strong>
                            <span>How can we help?</span>
                        </div>
                        <button
                            className="icon-button"
                            onClick={() => setOpen(false)}
                            aria-label="Close chat"
                        >
                            ×
                        </button>
                    </header>

                    {!displayName && visitorToken && (
                        <form className="name-prompt" onSubmit={saveName}>
                            <label htmlFor="visitor-name">What should we call you?</label>
                            <div>
                                <input
                                    id="visitor-name"
                                    name="displayName"
                                    maxLength={200}
                                    placeholder="Your name"
                                    required
                                />
                                <button>Save name</button>
                            </div>
                        </form>
                    )}

                    <div className="messages" ref={messageList} aria-live="polite">
                        {messages.length === 0 && !error && (
                            <div className="welcome">
                                <strong>Start a conversation</strong>
                                <span>Send us a message and our team will reply here.</span>
                            </div>
                        )}

                        {messages.map((message) => (
                            <article className={message.sender_type} key={message.public_id}>
                                <small>{message.sender_name}</small>
                                <p>{message.content}</p>
                            </article>
                        ))}
                    </div>

                    {error && <div className="error">{error}</div>}

                    <form onSubmit={send}>
                        <textarea
                            name="message"
                            placeholder="Write a message…"
                            rows={2}
                            disabled={!visitorToken || sending}
                        />
                        <button disabled={!visitorToken || sending}>
                            {sending ? 'Sending…' : 'Send'}
                        </button>
                    </form>
                </section>
            )}

            <button
                className="launcher"
                onClick={() => setOpen((value) => !value)}
                aria-label="Open support chat"
            >
                {open ? '×' : 'Chat'}
            </button>
        </div>
    );
}
