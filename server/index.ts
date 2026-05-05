import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import path from 'path';
import XLSX from 'xlsx';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, initializeDatabase } from './db.js';
import type { Category, EvaluationRecord, LadderLevel, Score } from '../src/types';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

app.use(cors());
app.use(express.json());
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const MASTER_FILES = ['1_beginner.xlsx', '2_execution.xlsx', '3_leader.xlsx', '4_manage.xlsx'];
const MANUAL_FILES = ['5_beginner_manual.xlsx', '6_execution_manual.xlsx', '7_leader_manual.xlsx', '8_manage_manual.xlsx'];

// ─── 型定義 ───────────────────────────────────────────────────────────────

type ManualCriteria = { 0: string; 1: string; 2: string };

interface JwtPayload {
  id: number;
  username: string;
  displayName: string;
  role: string;
  employeeId: string | null;
}

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// ─── 認証ミドルウェア ─────────────────────────────────────────────────────

function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: '認証が必要です' });
    return;
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET) as JwtPayload;
    next();
  } catch {
    res.status(401).json({ error: 'トークンが無効または期限切れです' });
  }
}

// ─── 認証ルート ───────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]) as any;
    const row = rows[0];
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません。' });
      return;
    }
    const payload: JwtPayload = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      employeeId: row.employee_id,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        employeeId: row.employee_id ?? undefined,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ─── 社員ルート ───────────────────────────────────────────────────────────

app.get('/api/employees', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.execute(
      'SELECT e.id, e.name FROM employees e INNER JOIN users u ON u.employee_id = e.id ORDER BY e.id'
    ) as any;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ─── 評価ルート ───────────────────────────────────────────────────────────

app.get('/api/evaluations', authenticate, async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const [rows] = (user.role === 'admin'
      ? await pool.execute('SELECT * FROM evaluations ORDER BY updated_at DESC')
      : await pool.execute('SELECT * FROM evaluations WHERE employee_id = ? ORDER BY updated_at DESC', [user.employeeId])
    ) as any;

    const records: EvaluationRecord[] = await Promise.all(
      (rows as any[]).map(async (row) => {
        const [scoreRows] = await pool.execute(
          'SELECT item_id, score FROM evaluation_scores WHERE evaluation_id = ?',
          [row.id]
        ) as any;

        const scores: Record<string, Score> = {};
        for (const s of scoreRows as any[]) {
          scores[s.item_id] = (s.score === 'excluded' ? 'excluded' : Number(s.score)) as Score;
        }

        return {
          id: row.id,
          employeeId: row.employee_id,
          employeeName: row.employee_name,
          month: row.month,
          level: row.level as LadderLevel,
          role: row.role,
          locked: row.locked === 1,
          goal: row.goal ?? '',
          challenge: row.challenge ?? '',
          reviewPeriod: row.review_period ?? '',
          adminChallenge: row.admin_challenge ?? '',
          teamOpinion: row.team_opinion ?? '',
          feedback: row.feedback ?? '',
          scores,
          updatedAt: row.updated_at,
        };
      })
    );

    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/evaluations', authenticate, async (req: AuthRequest, res: Response) => {
  const record = req.body as EvaluationRecord;
  const user = req.user!;

  if (user.role === 'self' && record.employeeId !== user.employeeId) {
    res.status(403).json({ error: '他の社員の評価を保存する権限がありません' });
    return;
  }

  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.execute(
      'SELECT locked FROM evaluations WHERE id = ?',
      [record.id]
    ) as any;
    if (existing[0]?.locked === 1 && user.role !== 'admin') {
      res.status(403).json({ error: 'この評価は確定済みのため編集できません' });
      return;
    }

    await conn.beginTransaction();

    await conn.execute(`
      INSERT INTO evaluations (id, employee_id, employee_name, month, level, role, locked, goal, challenge, review_period, admin_challenge, team_opinion, feedback, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        employee_name   = VALUES(employee_name),
        month           = VALUES(month),
        level           = VALUES(level),
        role            = VALUES(role),
        goal            = VALUES(goal),
        challenge       = VALUES(challenge),
        review_period   = VALUES(review_period),
        admin_challenge = VALUES(admin_challenge),
        team_opinion    = VALUES(team_opinion),
        feedback        = VALUES(feedback),
        updated_at      = VALUES(updated_at)
    `, [record.id, record.employeeId, record.employeeName, record.month, record.level, record.role, record.goal ?? null, record.challenge ?? null, record.reviewPeriod ?? null, record.adminChallenge ?? null, record.teamOpinion ?? null, record.feedback ?? null, record.updatedAt]);

    await conn.execute('DELETE FROM evaluation_scores WHERE evaluation_id = ?', [record.id]);

    for (const [itemId, score] of Object.entries(record.scores)) {
      await conn.execute(
        'INSERT INTO evaluation_scores (evaluation_id, item_id, score) VALUES (?, ?, ?)',
        [record.id, itemId, String(score)]
      );
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    conn.release();
  }
});

app.put('/api/evaluations/:id/lock', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者のみロック操作が可能です' });
    return;
  }
  const { locked } = req.body as { locked: boolean };
  try {
    const [result] = await pool.execute(
      'UPDATE evaluations SET locked = ? WHERE id = ?',
      [locked ? 1 : 0, req.params.id]
    ) as any;
    if (result.affectedRows === 0) {
      res.status(404).json({ error: '評価レコードが見つかりません' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ─── ユーザー管理（管理者専用） ───────────────────────────────────────────

app.get('/api/admin/users', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  try {
    const [rows] = await pool.execute('SELECT id, username, display_name, role, employee_id, department FROM users ORDER BY id') as any;
    res.json(rows.map((u: any) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      employeeId: u.employee_id,
      department: u.department ?? '',
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/admin/users', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  const { username, displayName, password, role, department } = req.body as {
    username: string; displayName: string; password: string; role: string; department?: string;
  };
  if (!username || !displayName || !password || !role) { res.status(400).json({ error: '必須項目が不足しています' }); return; }
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.execute(
      'INSERT INTO users (username, display_name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)',
      [username, displayName, bcrypt.hashSync(password, 10), role, department || null]
    ) as any;

    // self ロールのユーザーには社員IDを自動採番し employees テーブルにも同期
    let employeeId: string | null = null;
    if (role === 'self') {
      employeeId = `emp-${result.insertId}`;
      await conn.execute('UPDATE users SET employee_id = ? WHERE id = ?', [employeeId, result.insertId]);
      await conn.execute(
        'INSERT INTO employees (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
        [employeeId, displayName]
      );
    }

    res.json({ id: result.insertId, username, displayName, role, employeeId, department: department || null });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'そのユーザー名は既に使用されています' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'ユーザーの作成に失敗しました' });
    }
  } finally {
    conn.release();
  }
});

app.put('/api/admin/users/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  const { displayName, role, department, password } = req.body as {
    displayName: string; role: string; department?: string; password?: string;
  };
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT employee_id FROM users WHERE id = ?', [req.params.id]) as any;
    const currentEmpId: string | null = rows[0]?.employee_id ?? null;

    if (password) {
      await conn.execute(
        'UPDATE users SET display_name = ?, role = ?, department = ?, password_hash = ? WHERE id = ?',
        [displayName, role, department || null, bcrypt.hashSync(password, 10), req.params.id]
      );
    } else {
      await conn.execute(
        'UPDATE users SET display_name = ?, role = ?, department = ? WHERE id = ?',
        [displayName, role, department || null, req.params.id]
      );
    }

    if (role === 'self') {
      if (currentEmpId) {
        // 表示名が変わった場合に employees テーブルも更新
        await conn.execute('UPDATE employees SET name = ? WHERE id = ?', [displayName, currentEmpId]);
      } else {
        // admin → self へのロール変更時に社員IDを新規採番
        const empId = `emp-${req.params.id}`;
        await conn.execute('UPDATE users SET employee_id = ? WHERE id = ?', [empId, req.params.id]);
        await conn.execute(
          'INSERT INTO employees (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
          [empId, displayName]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    conn.release();
  }
});

app.delete('/api/admin/users/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  if (String(req.params.id) === String(req.user!.id)) { res.status(400).json({ error: '自分自身は削除できません' }); return; }
  try {
    const [rows] = await pool.execute('SELECT employee_id FROM users WHERE id = ?', [req.params.id]) as any;
    const employeeId = rows[0]?.employee_id ?? null;
    await pool.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    if (employeeId) {
      await pool.execute('DELETE FROM employees WHERE id = ?', [employeeId]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ─── 社員管理（管理者専用） ───────────────────────────────────────────────

app.post('/api/admin/employees', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  const { id, name } = req.body as { id: string; name: string };
  if (!id || !name) { res.status(400).json({ error: '社員IDと名前は必須です' }); return; }
  try {
    await pool.execute('INSERT INTO employees (id, name) VALUES (?, ?)', [id, name]);
    res.json({ id, name });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'その社員IDは既に存在します' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
  }
});

app.put('/api/admin/employees/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  const { name } = req.body as { name: string };
  try {
    await pool.execute('UPDATE employees SET name = ? WHERE id = ?', [name, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.delete('/api/admin/employees/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  try {
    await pool.execute('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ─── Excelインポート ──────────────────────────────────────────────────────

function normalizeSheetId(value: string) {
  return value.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '').toLowerCase();
}

function normalizeManualKey(value: string) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseExcelSheet(level: number, sheetName: string, rawRows: unknown[][], manualCriteriaMap: Record<string, ManualCriteria>): Category | null {
  const rows = rawRows.filter((row) => Array.isArray(row) && row.some((cell) => cell != null && String(cell).trim() !== '')) as unknown[][];
  if (rows.length < 2) return null;

  const header = rows[0].map((value) => String(value ?? '').trim());
  const findIndexOrDefault = (pattern: RegExp, fallback: number) => {
    const idx = header.findIndex((col) => pattern.test(col));
    return idx >= 0 ? idx : fallback;
  };
  const titleColumn = findIndexOrDefault(/小項目|項目名|項目/, 1);
  const criteria0Column = findIndexOrDefault(/0点/, 2);
  const criteria1Column = findIndexOrDefault(/1点/, 3);
  const criteria2Column = findIndexOrDefault(/2点/, 4);

  const subItems = rows.slice(1).reduce((acc: Category['subItems'], row) => {
    const title = String(row[titleColumn] ?? row[0] ?? '').trim();
    if (!title) return acc;

    const manualKey = normalizeManualKey(title);
    const manualCriteria = manualCriteriaMap[manualKey];
    const criteria0 = manualCriteria ? manualCriteria[0] : String(row[criteria0Column] ?? '').trim() || '0点の基準が設定されていません。';
    const criteria1 = manualCriteria ? manualCriteria[1] : String(row[criteria1Column] ?? '').trim() || '1点の基準が設定されていません。';
    const criteria2 = manualCriteria ? manualCriteria[2] : String(row[criteria2Column] ?? '').trim() || '2点の基準が設定されていません。';
    const itemId = normalizeSheetId(`${sheetName}-${acc.length + 1}`);

    acc.push({ id: itemId, title, level: level as LadderLevel, criteria: { 0: criteria0, 1: criteria1, 2: criteria2 } });
    return acc;
  }, [] as Category['subItems']);

  if (!subItems.length) return null;
  return { id: normalizeSheetId(sheetName), title: sheetName, subItems };
}

async function loadMasterFromExcel(manualCriteriaMap: Record<string, ManualCriteria>): Promise<Category[]> {
  const categories: Category[] = [];
  for (const fileName of MASTER_FILES) {
    try {
      const filePath = path.join(PROJECT_ROOT, fileName);
      const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
      const level = Number(fileName[0]) as number;
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false }) as unknown[][];
        const category = parseExcelSheet(level, sheetName, rows, manualCriteriaMap);
        if (category) categories.push(category);
      }
    } catch (error) {
      console.warn(`Failed to parse Excel file ${fileName}:`, error);
    }
  }
  return categories;
}

async function loadManualCriteria(): Promise<Record<string, ManualCriteria>> {
  const criteriaMap: Record<string, ManualCriteria> = {};
  for (const fileName of MANUAL_FILES) {
    try {
      const filePath = path.join(PROJECT_ROOT, fileName);
      const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false }) as unknown[][];
        if (rows.length < 2) continue;

        const header = rows[0].map((value) => String(value ?? '').trim());
        const findIndexOrDefault = (pattern: RegExp, fallback: number) => {
          const idx = header.findIndex((col) => pattern.test(col));
          return idx >= 0 ? idx : fallback;
        };
        const titleColumn = findIndexOrDefault(/項目|Item/, 1);
        const criteria2Column = findIndexOrDefault(/2点|2点/, 2);
        const criteria1Column = findIndexOrDefault(/1点|1点/, 3);
        const criteria0Column = findIndexOrDefault(/0点|0点/, 4);

        for (const row of rows.slice(1)) {
          const title = normalizeManualKey(String(row[titleColumn] ?? ''));
          if (!title) continue;
          criteriaMap[title] = {
            0: String(row[criteria0Column] ?? '').trim() || '0点の基準が設定されていません。',
            1: String(row[criteria1Column] ?? '').trim() || '1点の基準が設定されていません。',
            2: String(row[criteria2Column] ?? '').trim() || '2点の基準が設定されていません。',
          };
        }
      }
    } catch (error) {
      console.warn(`Failed to parse manual Excel file ${fileName}:`, error);
    }
  }
  return criteriaMap;
}

app.get('/api/master/import', async (_req: Request, res: Response) => {
  const manualCriteriaMap = await loadManualCriteria();
  const categories = await loadMasterFromExcel(manualCriteriaMap);
  return res.json({ categories, manualLoaded: Object.keys(manualCriteriaMap).length > 0, sourceFiles: [...MASTER_FILES, ...MANUAL_FILES] });
});

// ─── AI要約 ───────────────────────────────────────────────────────────────

app.post('/api/summary', async (req: Request, res: Response) => {
  const { employeeName, role, latestRecord, trend } = req.body as {
    employeeName: string;
    role: string;
    latestRecord: EvaluationRecord;
    trend: EvaluationRecord[];
  };

  if (!openai) {
    return res.json({ summary: 'AI要約APIキーが構成されていません。`.env` に OPENAI_API_KEY を設定してから再度お試しください。' });
  }

  const promptLines = [
    `対象者名: ${employeeName}`,
    `評価種別: ${role === 'self' ? '本人評価' : '管理者評価'}`,
    `最新評価年月: ${latestRecord.month}`,
    `最新評価レベル: ${latestRecord.level}`,
    '最新評価スコア:',
    ...Object.entries(latestRecord.scores).map(([key, value]) => `- ${key}: ${value}`),
    '過去の推移:',
    ...trend.map((record) => `- ${record.month}: ${Object.entries(record.scores).map(([id, s]) => `${id}:${s}`).join(', ')}`),
    '',
    'このデータをもとに、以下を日本語で整理してください。',
    '1. 直近の成長ポイント',
    '2. 今後の課題と改善提案',
    '3. 成長軌跡として注目すべき推移',
  ];

  try {
    const response = await openai.responses.create({ model: 'gpt-4.1-mini', input: promptLines.join('\n') });
    const outputBlocks = (response.output as any) || [];
    const summary = outputBlocks
      .flatMap((block: any) => Array.isArray(block.content) ? block.content : [])
      .filter((item: any) => item.type === 'output_text')
      .map((item: any) => item.text)
      .join('');
    return res.json({ summary: summary || 'AIからの要約を取得できませんでした。' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ summary: 'AI要約の生成中にエラーが発生しました。' });
  }
});

// ─── 本番環境: フロントエンド静的ファイル配信 ────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(PROJECT_ROOT, 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── 起動 ────────────────────────────────────────────────────────────────

initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`サーバーが http://localhost:${port} で起動しました`);
    });
  })
  .catch((err) => {
    console.error('データベース初期化に失敗しました:', err);
    process.exit(1);
  });
