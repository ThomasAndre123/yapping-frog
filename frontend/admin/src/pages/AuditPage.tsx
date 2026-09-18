import { useCallback, useState } from 'react';

import { Modal } from '../components/Modal';
import type { AuditEntry } from '../types';

export function AuditPage({ entries, cursor, onRefresh, onMore }: {
  entries: AuditEntry[];
  cursor: string | null;
  onRefresh: () => void;
  onMore: () => void;
}) {
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const closeDetails = useCallback(() => setSelectedEntry(null), []);

  return <section className="panel active" aria-labelledby="audit-title">
    <div className="toolbar"><div><h2 id="audit-title">Administrator audit log</h2>
      <p>Recent security and tenant-management activity.</p></div>
      <button type="button" className="secondary" onClick={onRefresh}>Refresh</button></div>
    <div className="card table-wrap"><table>
      <thead><tr><th>Time</th><th>Administrator</th><th>Action</th><th>Target</th><th>IP address</th><th>Details</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.id}>
        <td>{new Date(entry.created_at).toLocaleString()}</td>
        <td>{entry.administrator_name ?? entry.administrator_email ?? 'Deleted administrator'}</td>
        <td>{entry.action}</td><td>{entry.target_id ?? entry.target_type}</td>
        <td>{entry.ip_address ?? '—'}</td>
        <td><button type="button" className="secondary" onClick={() => setSelectedEntry(entry)}>View</button></td>
      </tr>)}</tbody>
    </table>{cursor && <button type="button" className="secondary more-audit" onClick={onMore}>
      Load older entries
    </button>}</div>
    {selectedEntry && <Modal title="Audit log details" onClose={closeDetails}>
      <dl className="detail-list">
        <Detail label="Log ID" value={selectedEntry.id} />
        <Detail label="Time" value={new Date(selectedEntry.created_at).toLocaleString()} />
        <Detail label="Action" value={selectedEntry.action} />
        <Detail label="Administrator" value={selectedEntry.administrator_name ?? 'Deleted administrator'} />
        <Detail label="Administrator email" value={selectedEntry.administrator_email} />
        <Detail label="Administrator ID" value={selectedEntry.administrator_public_id} code />
        <Detail label="Target type" value={selectedEntry.target_type} />
        <Detail label="Target ID" value={selectedEntry.target_id} code />
        <Detail label="IP address" value={selectedEntry.ip_address} code />
        <Detail label="Reason" value={selectedEntry.reason} />
      </dl>
      <div className="metadata-detail">
        <h3>Metadata</h3>
        {selectedEntry.metadata == null
          ? <p>None</p>
          : <pre>{JSON.stringify(selectedEntry.metadata, null, 2)}</pre>}
      </div>
    </Modal>}
  </section>;
}

function Detail({ label, value, code = false }: {
  label: string;
  value: string | null;
  code?: boolean;
}) {
  return <div><dt>{label}</dt><dd>{value == null || value === ''
    ? '—'
    : code ? <code>{value}</code> : value}</dd></div>;
}
