# Visitor chat widget

Embed the widget on an allowed tenant site:

```html
<script
  src="https://chat.example.com/widget/embed.js"
  data-site-key="site_pk_replace_with_the_site_widget_key"
  defer
></script>
```

The loader stores an opaque visitor token in the host site's `localStorage` and
renders the chat UI in an iframe, keeping widget styles isolated from the host.
The current token is available as `window.YappingFrog.getVisitorToken()` so the
host can send it to its own backend during the post-login identify flow.

## Linking a visitor after login

The host backend should call the identify endpoint after it authenticates its
user. Never call this endpoint from browser JavaScript because its tenant API
key is secret.

```http
POST /api/widget/v1/identify
Authorization: Bearer yf_sk_your_tenant_api_key
Content-Type: application/json

{
  "siteKey": "site_pk_...",
  "visitorToken": "opaque token received from the widget",
  "externalUserId": "customer-123",
  "displayName": "Amina"
}
```

The API key requires the `widget.identify` scope. If that external user was
previously identified under another browser token, conversations from the
current anonymous visitor are reassigned to the existing customer identity.
