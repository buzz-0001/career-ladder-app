import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, initializeDatabase, isUniqueViolation, isRowLocked } from './db.js';
import type { EvaluationRecord, LadderLevel, Score } from '../src/types';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET === 'dev-secret-change-in-production' ||
    process.env.JWT_SECRET === 'local-dev-secret-change-in-production')
) {
  throw new Error('本番環境では強力な JWT_SECRET を設定してください');
}

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

function toLadderLevel(value: unknown): LadderLevel {
  return Number(value) as LadderLevel;
}

// ─── 認証ルート ───────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const row = result.rows[0];
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
    const result = await pool.query(
      'SELECT e.id, e.name FROM employees e INNER JOIN users u ON u.employee_id = e.id ORDER BY e.id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ─── 評価ルート ───────────────────────────────────────────────────────────

app.get('/api/evaluations', authenticate, async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const result = user.role === 'admin'
      ? await pool.query('SELECT * FROM evaluations ORDER BY updated_at DESC')
      : await pool.query('SELECT * FROM evaluations WHERE employee_id = $1 ORDER BY updated_at DESC', [user.employeeId]);

    const evaluationIds = result.rows.map((row) => row.id);
    const scoresByEvaluationId = new Map<string, Record<string, Score>>();

    if (evaluationIds.length > 0) {
      const scoreResult = await pool.query(
        'SELECT evaluation_id, item_id, score FROM evaluation_scores WHERE evaluation_id = ANY($1::varchar[])',
        [evaluationIds]
      );

      for (const s of scoreResult.rows) {
        const scores = scoresByEvaluationId.get(s.evaluation_id) ?? {};
        scores[s.item_id] = (s.score === 'excluded' ? 'excluded' : Number(s.score)) as Score;
        scoresByEvaluationId.set(s.evaluation_id, scores);
      }
    }

    const records: EvaluationRecord[] = result.rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      month: row.month,
      level: toLadderLevel(row.level),
      role: row.role,
      locked: isRowLocked(row.locked),
      goal: row.goal ?? '',
      challenge: row.challenge ?? '',
      reviewPeriod: row.review_period ?? '',
      adminChallenge: row.admin_challenge ?? '',
      teamOpinion: row.team_opinion ?? '',
      feedback: row.feedback ?? '',
      scores: scoresByEvaluationId.get(row.id) ?? {},
      updatedAt: row.updated_at,
    }));

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

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT locked FROM evaluations WHERE id = $1', [record.id]);
    if (isRowLocked(existing.rows[0]?.locked) && user.role !== 'admin') {
      res.status(403).json({ error: 'この評価は確定済みのため編集できません' });
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO evaluations (
        id, employee_id, employee_name, month, level, role, locked,
        goal, challenge, review_period, admin_challenge, team_opinion, feedback, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        employee_name   = EXCLUDED.employee_name,
        month           = EXCLUDED.month,
        level           = EXCLUDED.level,
        role            = EXCLUDED.role,
        goal            = EXCLUDED.goal,
        challenge       = EXCLUDED.challenge,
        review_period   = EXCLUDED.review_period,
        admin_challenge = EXCLUDED.admin_challenge,
        team_opinion    = EXCLUDED.team_opinion,
        feedback        = EXCLUDED.feedback,
        updated_at      = EXCLUDED.updated_at`,
      [
        record.id,
        record.employeeId,
        record.employeeName,
        record.month,
        record.level,
        record.role,
        record.goal ?? null,
        record.challenge ?? null,
        record.reviewPeriod ?? null,
        record.adminChallenge ?? null,
        record.teamOpinion ?? null,
        record.feedback ?? null,
        record.updatedAt,
      ]
    );

    // 全削除→再挿入だと同時保存が主キー衝突で失敗しデータが失われるため、項目ごとの UPSERT にする
    for (const [itemId, score] of Object.entries(record.scores ?? {})) {
      await client.query(
        `INSERT INTO evaluation_scores (evaluation_id, item_id, score) VALUES ($1, $2, $3)
         ON CONFLICT (evaluation_id, item_id) DO UPDATE SET score = EXCLUDED.score`,
        [record.id, itemId, String(score)]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    client.release();
  }
});

app.put('/api/evaluations/:id/lock', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者のみロック操作が可能です' });
    return;
  }
  const { locked } = req.body as { locked: boolean };
  try {
    const result = await pool.query(
      'UPDATE evaluations SET locked = $1 WHERE id = $2',
      [locked, req.params.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: '評価レコードが見つかりません' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.delete('/api/evaluations/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者のみ評価データを削除できます' });
    return;
  }
  try {
    const result = await pool.query('DELETE FROM evaluations WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
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
    const result = await pool.query(
      'SELECT id, username, display_name, role, employee_id, department FROM users ORDER BY id'
    );
    res.json(result.rows.map((u) => ({
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
  const client = await pool.connect();
  try {
    const insertResult = await client.query(
      'INSERT INTO users (username, display_name, password_hash, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, displayName, bcrypt.hashSync(password, 10), role, department || null]
    );
    const userId = insertResult.rows[0].id as number;

    let employeeId: string | null = null;
    if (role === 'self') {
      employeeId = `emp-${userId}`;
      await client.query('UPDATE users SET employee_id = $1 WHERE id = $2', [employeeId, userId]);
      await client.query(
        `INSERT INTO employees (id, name) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [employeeId, displayName]
      );
    }

    res.json({ id: userId, username, displayName, role, employeeId, department: department || null });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'そのユーザー名は既に使用されています' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'ユーザーの作成に失敗しました' });
    }
  } finally {
    client.release();
  }
});

app.put('/api/admin/users/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  const { displayName, role, department, password } = req.body as {
    displayName: string; role: string; department?: string; password?: string;
  };
  const client = await pool.connect();
  try {
    const rowsResult = await client.query('SELECT employee_id FROM users WHERE id = $1', [req.params.id]);
    const currentEmpId: string | null = rowsResult.rows[0]?.employee_id ?? null;

    if (password) {
      await client.query(
        'UPDATE users SET display_name = $1, role = $2, department = $3, password_hash = $4 WHERE id = $5',
        [displayName, role, department || null, bcrypt.hashSync(password, 10), req.params.id]
      );
    } else {
      await client.query(
        'UPDATE users SET display_name = $1, role = $2, department = $3 WHERE id = $4',
        [displayName, role, department || null, req.params.id]
      );
    }

    if (role === 'self') {
      if (currentEmpId) {
        await client.query('UPDATE employees SET name = $1 WHERE id = $2', [displayName, currentEmpId]);
      } else {
        const empId = `emp-${req.params.id}`;
        await client.query('UPDATE users SET employee_id = $1 WHERE id = $2', [empId, req.params.id]);
        await client.query(
          `INSERT INTO employees (id, name) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
          [empId, displayName]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/users/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  if (String(req.params.id) === String(req.user!.id)) { res.status(400).json({ error: '自分自身は削除できません' }); return; }
  try {
    const rowsResult = await pool.query('SELECT employee_id FROM users WHERE id = $1', [req.params.id]);
    const employeeId = rowsResult.rows[0]?.employee_id ?? null;
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    if (employeeId) {
      await pool.query('DELETE FROM employees WHERE id = $1', [employeeId]);
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
    await pool.query('INSERT INTO employees (id, name) VALUES ($1, $2)', [id, name]);
    res.json({ id, name });
  } catch (err) {
    if (isUniqueViolation(err)) {
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
    await pool.query('UPDATE employees SET name = $1 WHERE id = $2', [name, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.delete('/api/admin/employees/:id', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者のみアクセス可能です' }); return; }
  try {
    await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
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
