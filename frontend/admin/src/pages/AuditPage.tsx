import type { AuditEntry } from '../types';

export function AuditPage({ entries, cursor, onRefresh, onMore }: {
  entries: AuditEntry[];
  cursor: string | null;
  onRefresh: () => void;
  onMore: () => void;
}) {
  return <section className="panel active" aria-labelledby="audit-title">
    <div className="toolbar"><div><h2 id="audit-title">Administrator audit log</h2>
      <p>Recent security and tenant-management activity.</p></div>
      <button type="button" className="secondary" onClick={onRefresh}>Refresh</button></div>
    <div className="card table-wrap"><table>
      <thead><tr><th>Time</th><th>Administrator</th><th>Action</th><th>Target</th><th>IP address</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.id}>
        <td>{new Date(entry.created_at).toLocaleString()}</td>
        <td>{entry.administrator_name ?? entry.administrator_email ?? 'Deleted administrator'}</td>
        <td>{entry.action}</td><td>{entry.tenant_name ?? entry.target_id ?? entry.target_type}</td>
        <td>{entry.ip_address ?? '—'}</td>
      </tr>)}</tbody>
    </table>{cursor && <button type="button" className="secondary more-audit" onClick={onMore}>
      Load older entries
    </button>}</div>
  </section>;
}
