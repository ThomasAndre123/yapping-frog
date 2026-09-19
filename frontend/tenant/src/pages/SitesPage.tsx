import { useState } from 'react';
import type { Site } from '../types';

export function SitesPage({ sites, canManage, onCreate, onEdit }: { sites: Site[]; canManage: boolean; onCreate: () => void; onEdit: (site: Site) => void }) {
  const [search,setSearch]=useState(''); const filtered=sites.filter(site=>`${site.name} ${site.allowed_domains.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="card"><div className="title-row"><div><h2>Sites</h2><p>Manage widget installations and allowed domains.</p></div>{canManage&&<button onClick={onCreate}>Add site</button>}</div>
    <input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search sites…" aria-label="Search sites"/>
    <div className="list"><div className="list-header resource-header" aria-hidden="true"><span>Site / domains</span><span>Widget key</span><span>Status</span>{canManage&&<span>Action</span>}</div>{filtered.map(site=><div className="resource-line" key={site.public_id}><div><strong>{site.name}</strong><small>{site.allowed_domains.join(', ')}</small></div><code>{site.widget_key}</code><span>{site.status===1?'Active':'Disabled'}</span>{canManage&&<button onClick={()=>onEdit(site)}>Edit</button>}</div>)}{filtered.length===0&&<p className="empty">No matching sites.</p>}</div></section>;
}
