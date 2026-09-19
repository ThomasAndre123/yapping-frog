const script = document.currentScript as HTMLScriptElement | null;

if (script) {
    const configuredSiteKey = script.dataset.siteKey;
    const widgetOrigin = new URL(script.src).origin;
    const storageId = configuredSiteKey ?? 'default';
    const storageKey = `yapping-frog:${storageId}:visitor-token`;
    const visitorToken = window.localStorage.getItem(storageKey);
    const frame = document.createElement('iframe');
    const url = new URL('/widget/', widgetOrigin);

    if (configuredSiteKey) {
        url.searchParams.set('siteKey', configuredSiteKey);
    }

    url.searchParams.set('parentOrigin', window.location.origin);

    if (visitorToken) {
        url.searchParams.set('visitorToken', visitorToken);
    }

    frame.src = url.toString();
    frame.title = 'Customer support chat';
    frame.setAttribute('aria-label', 'Customer support chat');
    frame.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:16px',
        'width:min(390px,calc(100vw - 24px))',
        'height:min(620px,calc(100vh - 24px))',
        'border:0',
        'z-index:2147483647',
        'background:transparent',
    ].join(';');
    document.body.appendChild(frame);

    Object.assign(window, {
        YappingFrog: {
            getVisitorToken: () => window.localStorage.getItem(storageKey),
        },
    });

    window.addEventListener('message', (event) => {
        if (event.origin !== widgetOrigin || event.source !== frame.contentWindow) {
            return;
        }

        if (
            event.data?.type === 'yapping-frog.visitor-token' &&
            (!configuredSiteKey || event.data.siteKey === configuredSiteKey)
        ) {
            window.localStorage.setItem(storageKey, event.data.visitorToken);
        }
    });
}
