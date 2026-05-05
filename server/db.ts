import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Railway は MYSQL_URL / DATABASE_URL 形式で接続情報を提供する
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

export const pool = dbUrl
  ? mysql.createPool(dbUrl + '?charset=utf8mb4&timezone=+00:00')
  : mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'career_ladder',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
      timezone: '+00:00',
    });

export async function initializeDatabase(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        password_hash VARCHAR(200) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'self',
        employee_id VARCHAR(100)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS employees (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(200) NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS evaluations (
        id VARCHAR(200) PRIMARY KEY,
        employee_id VARCHAR(100) NOT NULL,
        employee_name VARCHAR(200) NOT NULL,
        month VARCHAR(10) NOT NULL,
        level INT NOT NULL,
        role VARCHAR(20) NOT NULL,
        locked TINYINT NOT NULL DEFAULT 0,
        goal TEXT,
        updated_at VARCHAR(50) NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS evaluation_scores (
        evaluation_id VARCHAR(200) NOT NULL,
        item_id VARCHAR(200) NOT NULL,
        score VARCHAR(20) NOT NULL,
        PRIMARY KEY (evaluation_id, item_id),
        FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // マイグレーション: テキスト記入欄の追加（列が既に存在する場合はスキップ）
    for (const col of ['challenge TEXT', 'admin_challenge TEXT', 'team_opinion TEXT', 'feedback TEXT', 'review_period TEXT']) {
      try {
        await conn.execute(`ALTER TABLE evaluations ADD COLUMN ${col}`);
      } catch (err: any) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      }
    }

    // マイグレーション: users テーブルに部署列を追加
    try {
      await conn.execute(`ALTER TABLE users ADD COLUMN department VARCHAR(200)`);
    } catch (err: any) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    const [userCount] = await conn.execute('SELECT COUNT(*) as count FROM users') as any;
    if (userCount[0].count === 0) {
      const seedUsers = [
        { username: 'yamada', displayName: '山田太郎', password: 'yamada', role: 'self', employeeId: 'emp-01' },
        { username: 'sato', displayName: '佐藤花子', password: 'sato', role: 'self', employeeId: 'emp-02' },
        { username: 'sunoki', displayName: '鈴木一郎', password: 'sunoki', role: 'self', employeeId: 'emp-03' },
        { username: 'admin', displayName: 'システム管理者', password: 'admin', role: 'admin', employeeId: null },
      ];
      for (const u of seedUsers) {
        await conn.execute(
          'INSERT INTO users (username, display_name, password_hash, role, employee_id) VALUES (?, ?, ?, ?, ?)',
          [u.username, u.displayName, await bcrypt.hash(u.password, 10), u.role, u.employeeId]
        );
      }
    }

    const [empCount] = await conn.execute('SELECT COUNT(*) as count FROM employees') as any;
    if (empCount[0].count === 0) {
      const seedEmployees: [string, string][] = [
        ['emp-01', '山田太郎'],
        ['emp-02', '佐藤花子'],
        ['emp-03', '鈴木一郎'],
      ];
      for (const [id, name] of seedEmployees) {
        await conn.execute('INSERT INTO employees (id, name) VALUES (?, ?)', [id, name]);
      }
    }

    console.log('データベース初期化完了');
  } finally {
    conn.release();
  }
}
