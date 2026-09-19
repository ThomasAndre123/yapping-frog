import { useState } from 'react';
import type { Site } from '../types';

function embedScript(site: Site) {
    return `<script src="${window.location.origin}/widget/embed.js" data-site-key="${site.widget_key}" defer></script>`;
}

export function SitesPage({
    sites,
    canManage,
    onCreate,
    onEdit,
}: {
    sites: Site[];
    canManage: boolean;
    onCreate: () => void;
    onEdit: (site: Site) => void;
}) {
    const [search, setSearch] = useState('');
    const [copiedSiteId, setCopiedSiteId] = useState<string>();
    const [copyError, setCopyError] = useState<string>();

    const filtered = sites.filter((site) =>
        `${site.name} ${site.allowed_domains.join(' ')}`
            .toLowerCase()
            .includes(search.toLowerCase()),
    );

    async function copyEmbedScript(site: Site) {
        try {
            await navigator.clipboard.writeText(embedScript(site));
            setCopiedSiteId(site.public_id);
            setCopyError(undefined);
            window.setTimeout(() => setCopiedSiteId(undefined), 2500);
        } catch {
            setCopyError('Could not copy automatically. Copy the script from the box below.');
        }
    }

    return (
        <section className="card sites-page">
            <div className="title-row">
                <div>
                    <h2>Sites</h2>
                    <p>Manage widget installations and allowed domains.</p>
                </div>
                {canManage && <button onClick={onCreate}>Add site</button>}
            </div>

            <div className="embed-instructions">
                <strong>Install the chat widget</strong>
                <p>
                    Select the site below, copy its embed script, then paste it before
                    the closing <code>&lt;/body&gt;</code> tag on your website.
                </p>
                {copyError && <p className="copy-error">{copyError}</p>}
            </div>

            <input
                className="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search sites…"
                aria-label="Search sites"
            />

            <div className="list">
                <div className="list-header resource-header" aria-hidden="true">
                    <span>Site / domains</span>
                    <span>Widget key</span>
                    <span>Status</span>
                    <span>Actions</span>
                </div>

                {filtered.map((site) => (
                    <div className="resource-line" key={site.public_id}>
                        <div>
                            <strong>{site.name}</strong>
                            <small>{site.allowed_domains.join(', ')}</small>
                        </div>

                        <div className="site-field widget-key-field">
                            <span className="mobile-label">Widget key</span>
                            <code>{site.widget_key}</code>
                        </div>

                        <div className="site-field">
                            <span className="mobile-label">Status</span>
                            <span className={`site-status status-${site.status}`}>
                                {site.status === 1 ? 'Active' : 'Disabled'}
                            </span>
                        </div>

                        <div className="site-actions">
                            <button onClick={() => copyEmbedScript(site)}>
                                {copiedSiteId === site.public_id
                                    ? 'Copied!'
                                    : 'Copy embed script'}
                            </button>
                            {canManage && (
                                <button className="muted" onClick={() => onEdit(site)}>
                                    Edit
                                </button>
                            )}
                        </div>

                        {copyError && (
                            <code className="embed-code">{embedScript(site)}</code>
                        )}
                    </div>
                ))}

                {filtered.length === 0 && (
                    <p className="empty">No matching sites.</p>
                )}
            </div>
        </section>
    );
}
