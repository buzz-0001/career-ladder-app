import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn('警告: DATABASE_URL が未設定です。Supabase の接続文字列を .env に設定してください。');
}

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes('localhost') || databaseUrl?.includes('127.0.0.1')
    ? undefined
    : { rejectUnauthorized: false },
  max: 5,
});

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export function isRowLocked(locked: unknown): boolean {
  return locked === true || locked === 1 || locked === '1';
}

async function runMigrations(client: pg.PoolClient): Promise<void> {
  const migrationPath = path.join(__dirname, 'migrations', '001_initial.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await client.query(sql);
}

export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await runMigrations(client);

    const userCount = await client.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM users');
    if (Number(userCount.rows[0]?.count) === 0) {
      const seedUsers = [
        { username: 'yamada', displayName: '山田太郎', password: 'yamada', role: 'self', employeeId: 'emp-01' },
        { username: 'sato', displayName: '佐藤花子', password: 'sato', role: 'self', employeeId: 'emp-02' },
        { username: 'sunoki', displayName: '鈴木一郎', password: 'sunoki', role: 'self', employeeId: 'emp-03' },
        { username: 'admin', displayName: 'システム管理者', password: 'admin', role: 'admin', employeeId: null },
      ];
      for (const u of seedUsers) {
        await client.query(
          'INSERT INTO users (username, display_name, password_hash, role, employee_id) VALUES ($1, $2, $3, $4, $5)',
          [u.username, u.displayName, await bcrypt.hash(u.password, 10), u.role, u.employeeId]
        );
      }
    }

    const empCount = await client.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM employees');
    if (Number(empCount.rows[0]?.count) === 0) {
      const seedEmployees: [string, string][] = [
        ['emp-01', '山田太郎'],
        ['emp-02', '佐藤花子'],
        ['emp-03', '鈴木一郎'],
      ];
      for (const [id, name] of seedEmployees) {
        await client.query('INSERT INTO employees (id, name) VALUES ($1, $2)', [id, name]);
      }
    }

    console.log('データベース初期化完了');
  } finally {
    client.release();
  }
}
