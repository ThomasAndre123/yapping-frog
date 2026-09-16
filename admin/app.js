const elements = {
  account: document.querySelector('#account'),
  identity: document.querySelector('#identity'),
  loginCard: document.querySelector('#login-card'),
  loginForm: document.querySelector('#login-form'),
  dashboard: document.querySelector('#dashboard'),
  notice: document.querySelector('#notice'),
  tenantForm: document.querySelector('#tenant-form'),
  tenants: document.querySelector('#tenants'),
  empty: document.querySelector('#empty'),
  administratorsSection: document.querySelector('#administrators-section'),
  administrators: document.querySelector('#administrators'),
  passwordForm: document.querySelector('#password-form'),
  auditSection: document.querySelector('#audit-section'),
  auditEntries: document.querySelector('#audit-entries'),
  moreAudit: document.querySelector('#more-audit')
};

let csrfToken;
let administrator;
let auditCursor;

function showNotice(message, success = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle('success', success);
  elements.notice.classList.remove('hidden');
}

function clearNotice() {
  elements.notice.classList.add('hidden');
}

async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers['content-type'] = 'application/json';
  if (csrfToken && options.method && options.method !== 'GET') {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(url, { ...options, headers });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}

function setAuthenticated(authenticated) {
  elements.loginCard.classList.toggle('hidden', authenticated);
  elements.dashboard.classList.toggle('hidden', !authenticated);
  elements.account.classList.toggle('hidden', !authenticated);
}

async function loadTenants() {
  const { tenants } = await api('/api/admin/v1/tenants');
  elements.tenants.replaceChildren();
  elements.empty.classList.toggle('hidden', tenants.length > 0);

  for (const tenant of tenants) {
    const row = document.createElement('tr');
    const values = [tenant.name, tenant.slug];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = `status ${tenant.status === 2 ? 'suspended' : ''}`;
    status.textContent = tenant.status === 1 ? 'Active' : 'Suspended';
    statusCell.append(status);
    row.append(statusCell);

    const created = document.createElement('td');
    created.textContent = new Date(tenant.created_at).toLocaleString();
    row.append(created);

    const actionCell = document.createElement('td');
    const action = document.createElement('button');
    action.className = 'secondary';
    action.textContent = tenant.status === 1 ? 'Suspend' : 'Activate';
    action.disabled = administrator.role === 'support';
    action.addEventListener('click', async () => {
      try {
        await api(`/api/admin/v1/tenants/${tenant.public_id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: tenant.status === 1 ? 2 : 1 })
        });
        await loadTenants();
      } catch (error) { showNotice(error.message); }
    });
    actionCell.append(action);
    row.append(actionCell);
    elements.tenants.append(row);
  }
}

async function loadAdministrators() {
  if (administrator.role !== 'super_admin') return;
  const { administrators } = await api('/api/admin/v1/administrators');
  elements.administrators.replaceChildren();
  for (const item of administrators) {
    const row = document.createElement('div');
    row.className = 'admin-row';
    for (const value of [item.display_name, item.email, item.role, item.status === 1 ? 'Active' : 'Disabled']) {
      const cell = document.createElement('span');
      cell.textContent = value;
      row.append(cell);
    }
    elements.administrators.append(row);
  }
  elements.administratorsSection.classList.remove('hidden');
}

async function loadAuditLog({ append = false } = {}) {
  if (administrator.role !== 'super_admin') return;
  const query = append && auditCursor ? `?before=${encodeURIComponent(auditCursor)}` : '';
  const { entries, nextBefore } = await api(`/api/admin/v1/audit-log${query}`);

  if (!append) elements.auditEntries.replaceChildren();

  for (const entry of entries) {
    const row = document.createElement('tr');
    const target = entry.tenant_name ?? entry.target_id ?? entry.target_type;
    const values = [
      new Date(entry.created_at).toLocaleString(),
      entry.administrator_name ?? entry.administrator_email ?? 'Deleted administrator',
      entry.action,
      target,
      entry.ip_address ?? '—'
    ];

    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    elements.auditEntries.append(row);
  }

  auditCursor = nextBefore;
  elements.moreAudit.classList.toggle('hidden', !nextBefore);
  elements.auditSection.classList.remove('hidden');
}

async function initialize() {
  try {
    const session = await api('/api/admin/v1/session');
    csrfToken = session.csrfToken;
    administrator = session.administrator;
    elements.identity.textContent = `${administrator.displayName} · ${administrator.role}`;
    elements.tenantForm.classList.toggle('hidden', administrator.role === 'support');
    setAuthenticated(true);
    await Promise.all([loadTenants(), loadAdministrators(), loadAuditLog()]);
  } catch {
    setAuthenticated(false);
  }
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    const body = await api('/api/admin/v1/session', {
      method: 'POST',
      body: JSON.stringify({
        email: event.currentTarget.email.value,
        password: event.currentTarget.password.value
      })
    });
    csrfToken = body.csrfToken;
    await initialize();
  } catch (error) { showNotice(error.message); }
});

elements.tenantForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    await api('/api/admin/v1/tenants', {
      method: 'POST',
      body: JSON.stringify({
        slug: document.querySelector('#tenant-slug').value,
        name: document.querySelector('#tenant-name').value
      })
    });
    event.currentTarget.reset();
    showNotice('Tenant created.', true);
    await loadTenants();
  } catch (error) { showNotice(error.message); }
});

elements.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice();
  const currentPassword = document.querySelector('#current-password').value;
  const newPassword = document.querySelector('#new-password').value;
  const confirmation = document.querySelector('#confirm-password').value;

  if (newPassword !== confirmation) {
    showNotice('New password and confirmation do not match.');
    return;
  }

  try {
    const result = await api('/api/admin/v1/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    event.currentTarget.reset();
    showNotice(result.message, true);
    if (administrator.role === 'super_admin') await loadAuditLog();
  } catch (error) { showNotice(error.message); }
});

document.querySelector('#refresh').addEventListener('click', () => loadTenants().catch((error) => showNotice(error.message)));
document.querySelector('#refresh-audit').addEventListener('click', () => loadAuditLog().catch((error) => showNotice(error.message)));
elements.moreAudit.addEventListener('click', () => loadAuditLog({ append: true }).catch((error) => showNotice(error.message)));
document.querySelector('#logout').addEventListener('click', async () => {
  await api('/api/admin/v1/session', { method: 'DELETE' });
  csrfToken = undefined;
  setAuthenticated(false);
});

initialize();
