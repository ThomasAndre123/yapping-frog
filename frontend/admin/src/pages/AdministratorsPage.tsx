import type { AdministratorRecord } from '../types';

export function AdministratorsPage({ administrators }: {
  administrators: AdministratorRecord[];
}) {
  return <section className="panel active" aria-labelledby="administrators-title">
    <div className="toolbar"><div><h2 id="administrators-title">Administrators</h2>
      <p>Review accounts with access to this administration area.</p></div></div>
    <div className="card">{administrators.map((item) => <div className="admin-row" key={item.public_id}>
      <span>{item.display_name}</span><span>{item.email}</span><span>{item.role}</span>
      <span>{item.status === 1 ? 'Active' : 'Disabled'}</span>
    </div>)}</div>
  </section>;
}
