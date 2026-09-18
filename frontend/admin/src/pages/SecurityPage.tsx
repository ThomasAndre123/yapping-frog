import type { FormEvent } from 'react';

export function SecurityPage({ onSubmit }: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="panel active" aria-labelledby="security-title">
    <div className="toolbar"><div><h2 id="security-title">Security</h2>
      <p>Manage your administrator credentials.</p></div></div>
    <form className="card password-form" onSubmit={onSubmit}>
      <h3>Change password</h3><p>Changing your password does not sign out active admin sessions.</p>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={1} required /></label>
      <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={1} required /></label>
      <button type="submit">Change password</button>
    </form>
  </section>;
}
