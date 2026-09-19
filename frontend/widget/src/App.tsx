import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { widgetApi, type WidgetMessage } from './api';

const params = new URLSearchParams(window.location.search);
const requestedSiteKey = params.get('siteKey') ?? undefined;
const savedVisitorToken = params.get('visitorToken') ?? undefined;
const parentOrigin = params.get('parentOrigin') ?? '*';

export function App() {
    const [open, setOpen] = useState(false);
    const [siteName, setSiteName] = useState('Support');
    const [visitorToken, setVisitorToken] = useState<string>();
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
            const result = await widgetApi.session(siteKey, savedVisitorToken);

            return { ...result, siteKey };
        };

        start()
            .then(async (result) => {
                setVisitorToken(result.visitorToken);
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
        if (!open || !visitorToken) {
            return;
        }

        const timer = window.setInterval(() => {
            loadMessages(visitorToken).catch(() => {});
        }, 3000);

        return () => window.clearInterval(timer);
    }, [open, visitorToken, loadMessages]);

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
