const script = document.currentScript as HTMLScriptElement | null;
const siteKey = script?.dataset.siteKey;

if (script && siteKey) {
    const widgetOrigin = new URL(script.src).origin;
    const storageKey = `yapping-frog:${siteKey}:visitor-token`;
    const visitorToken = window.localStorage.getItem(storageKey);
    const frame = document.createElement('iframe');
    const url = new URL('/widget/', widgetOrigin);

    url.searchParams.set('siteKey', siteKey);
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

    const yappingFrog = {
        getVisitorToken: () => window.localStorage.getItem(storageKey),
    };

    Object.assign(window, { YappingFrog: yappingFrog });

    window.addEventListener('message', (event) => {
        if (event.origin !== widgetOrigin || event.source !== frame.contentWindow) {
            return;
        }

        if (
            event.data?.type === 'yapping-frog.visitor-token' &&
            event.data.siteKey === siteKey
        ) {
            window.localStorage.setItem(storageKey, event.data.visitorToken);
        }
    });
}
