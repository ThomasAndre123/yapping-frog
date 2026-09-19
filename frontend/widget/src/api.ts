export interface WidgetMessage {
    public_id: string;
    content: string;
    created_at: string;
    sender_type: 'visitor' | 'agent';
    sender_name: string;
}

async function request<T>(path: string, options: RequestInit = {}) {
    const parentOrigin = new URLSearchParams(window.location.search).get('parentOrigin');
    const headers = new Headers(options.headers);

    if (parentOrigin) {
        headers.set('x-widget-origin', parentOrigin);
    }

    const response = await fetch(path, { ...options, headers });
    const body = response.status === 204 ? undefined : await response.json();

    if (!response.ok) {
        throw new Error(body?.error ?? 'Widget request failed');
    }

    return body as T;
}

export const widgetApi = {
    config: () => request<{ siteKey: string }>('/api/widget/v1/config'),

    session: (siteKey: string, visitorToken?: string) =>
        request<{ visitorToken: string; site: { publicId: string; name: string } }>(
            '/api/widget/v1/session',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ siteKey, visitorToken }),
            },
        ),

    messages: (visitorToken: string) =>
        request<{ messages: WidgetMessage[] }>('/api/widget/v1/messages', {
            headers: { authorization: `Bearer ${visitorToken}` },
        }),

    send: (visitorToken: string, content: string) =>
        request<{ message: WidgetMessage }>('/api/widget/v1/messages', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${visitorToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ content }),
        }),
};
