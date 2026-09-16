import pg from 'pg';

import { hashPassword } from '../src/security/password.js';

const { Pool } = pg;
const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, DATABASE_URL } = process.env;

if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD) {
  console.error(
    'DATABASE_URL, ADMIN_EMAIL, ADMIN_NAME, and ADMIN_PASSWORD are required.'
  );
  process.exit(1);
}

if (ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD must contain at least 12 characters.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });

try {
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const result = await pool.query(`
    INSERT INTO platform_administrators (
      email,
      display_name,
      role,
      password_hash
    )
    VALUES (LOWER($1), $2, 'super_admin', $3)
    RETURNING public_id, email, display_name, role
  `, [ADMIN_EMAIL.trim(), ADMIN_NAME.trim(), passwordHash]);

  console.log('Created administrator:', result.rows[0]);
} catch (error) {
  console.error(`Administrator creation failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
