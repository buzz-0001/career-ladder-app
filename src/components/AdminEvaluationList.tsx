import { useEffect, useMemo, useState } from 'react';
import { ladderLevels } from '../data/master';
import type { Category, Employee, EvaluationRecord, EvaluationRole, LadderLevel, User } from '../types';
import { apiLoadEvaluations, apiLockEvaluation } from '../utils/api';
import { calcCategoryScore, calcTotalScore } from '../utils/scoring';

interface AdminEvaluationListProps {
  employees: Employee[];
  categories: Category[];
  user: User;
}

type ViewMode = 'list' | 'status';
type CompletionStatus = 'none' | 'submitted' | 'locked';

function statusLabel(s: CompletionStatus) {
  if (s === 'locked') return <span className="status-locked">🟢 確定済み</span>;
  if (s === 'submitted') return <span className="status-submitted">🟡 提出済み</span>;
  return <span className="status-none">🔴 未提出</span>;
}

function AdminEvaluationList({ employees, categories, user }: AdminEvaluationListProps) {
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // 一覧フィルタ
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterLevel, setFilterLevel] = useState<'' | LadderLevel>('');
  const [filterRole, setFilterRole] = useState<'' | EvaluationRole>('');
  const [filterLocked, setFilterLocked] = useState<'' | 'locked' | 'unlocked'>('');

  // 完了状況フィルタ
  const [statusMonth, setStatusMonth] = useState('');
  const [statusLevel, setStatusLevel] = useState<LadderLevel>(1);

  useEffect(() => {
    apiLoadEvaluations().then(setEvaluations).catch(console.error);
  }, []);

  const allMonths = useMemo(
    () => Array.from(new Set(evaluations.map((r) => r.month))).sort().reverse(),
    [evaluations]
  );

  // ─── 一覧 ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => evaluations.filter((r) => {
    if (filterEmployee && r.employeeId !== filterEmployee) return false;
    if (filterMonth && r.month !== filterMonth) return false;
    if (filterLevel !== '' && r.level !== Number(filterLevel)) return false;
    if (filterRole && r.role !== filterRole) return false;
    if (filterLocked === 'locked' && !r.locked) return false;
    if (filterLocked === 'unlocked' && r.locked) return false;
    return true;
  }), [evaluations, filterEmployee, filterMonth, filterLevel, filterRole, filterLocked]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (a.month > b.month ? -1 : 1)),
    [filtered]
  );

  const handleToggleLock = async (record: EvaluationRecord) => {
    const nextLocked = !record.locked;
    await apiLockEvaluation(record.id, nextLocked).catch(console.error);
    setEvaluations((prev) => prev.map((r) => r.id === record.id ? { ...r, locked: nextLocked } : r));
  };

  // ─── 完了状況 ─────────────────────────────────────────────────────────────

  const getStatus = (empId: string, role: EvaluationRole): CompletionStatus => {
    const record = evaluations.find(
      (r) => r.employeeId === empId && r.month === statusMonth && r.level === statusLevel && r.role === role
    );
    if (!record) return 'none';
    return record.locked ? 'locked' : 'submitted';
  };

  const selfSubmitted = useMemo(
    () => employees.filter((e) => getStatus(e.id, 'self') !== 'none').length,
    [employees, evaluations, statusMonth, statusLevel]
  );
  const adminSubmitted = useMemo(
    () => employees.filter((e) => getStatus(e.id, 'admin') !== 'none').length,
    [employees, evaluations, statusMonth, statusLevel]
  );
  const selfLocked = useMemo(
    () => employees.filter((e) => getStatus(e.id, 'self') === 'locked').length,
    [employees, evaluations, statusMonth, statusLevel]
  );
  const adminLocked = useMemo(
    () => employees.filter((e) => getStatus(e.id, 'admin') === 'locked').length,
    [employees, evaluations, statusMonth, statusLevel]
  );

  // ─── CSVエクスポート ──────────────────────────────────────────────────────

  const handleExportCSV = () => {
    const BOM = '﻿';
    const categoryTitles = categories.map((c) => c.title);
    const headers = [
      '社員名', '評価月', 'レベル', '評価者', '合計点', '最高点', '得点率(%)', '確定状態',
      ...categoryTitles,
    ];

    const rows = sorted.map((record) => {
      const total = calcTotalScore(categories, record.level, record.scores);
      const catScores = categories.map((cat) => {
        const s = calcCategoryScore(cat, record.level, record.scores);
        return s.max > 0 ? `${s.total}/${s.max}(${s.percent}%)` : '―';
      });
      return [
        record.employeeName,
        record.month,
        record.level,
        record.role === 'self' ? '本人' : '管理者',
        total.total,
        total.max,
        total.percent,
        record.locked ? '確定済み' : '未確定',
        ...catScores,
      ].join(',');
    });

    const csv = BOM + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `評価データ_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (user.role !== 'admin') return null;

  return (
    <section className="card">
      <div className="label-row">
        <div className="badge">評価一覧（管理者）</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="view-tabs">
            <button type="button" className={viewMode === 'list' ? 'view-tab active' : 'view-tab'} onClick={() => setViewMode('list')}>一覧</button>
            <button type="button" className={viewMode === 'status' ? 'view-tab active' : 'view-tab'} onClick={() => setViewMode('status')}>完了状況</button>
          </div>
          <button type="button" className="secondary-button" onClick={handleExportCSV} disabled={sorted.length === 0}>
            CSVダウンロード
          </button>
        </div>
      </div>

      {/* ─── 一覧ビュー ─── */}
      {viewMode === 'list' && (
        <>
          <div className="input-row" style={{ flexWrap: 'wrap' }}>
            <div className="field">
              <label>社員</label>
              <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}>
                <option value="">全員</option>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>評価月</label>
              <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
                <option value="">全期間</option>
                {allMonths.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="field">
              <label>レベル</label>
              <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value as '' | LadderLevel)}>
                <option value="">全レベル</option>
                {ladderLevels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>評価者</label>
              <select value={filterRole} onChange={(e) => setFilterRole(e.target.value as '' | EvaluationRole)}>
                <option value="">両方</option>
                <option value="self">本人</option>
                <option value="admin">管理者</option>
              </select>
            </div>
            <div className="field">
              <label>確定状態</label>
              <select value={filterLocked} onChange={(e) => setFilterLocked(e.target.value as '' | 'locked' | 'unlocked')}>
                <option value="">全て</option>
                <option value="locked">確定済み</option>
                <option value="unlocked">未確定</option>
              </select>
            </div>
          </div>

          <div className="small-text" style={{ marginBottom: 8 }}>{sorted.length} 件表示 / 全 {evaluations.length} 件</div>

          {sorted.length === 0 ? (
            <div className="small-text">該当する評価データがありません。</div>
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr><th>社員名</th><th>評価月</th><th>レベル</th><th>評価者</th><th>状態</th><th>最終更新</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {sorted.map((record) => (
                    <tr key={record.id} className={record.locked ? 'row-locked' : ''}>
                      <td>{record.employeeName}</td>
                      <td>{record.month}</td>
                      <td>{ladderLevels.find((l) => l.value === record.level)?.label ?? record.level}</td>
                      <td>{record.role === 'self' ? '本人' : '管理者'}</td>
                      <td>{record.locked ? <span className="locked-badge">🔒 確定済み</span> : <span className="unlocked-badge">未確定</span>}</td>
                      <td className="small-text">{new Date(record.updatedAt).toLocaleString('ja-JP')}</td>
                      <td>
                        <button type="button" className={record.locked ? 'secondary-button' : 'primary-button'} onClick={() => handleToggleLock(record)}>
                          {record.locked ? '🔓 解除' : '🔒 確定'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── 完了状況ビュー ─── */}
      {viewMode === 'status' && (
        <>
          <div className="input-row">
            <div className="field">
              <label>評価月</label>
              <select value={statusMonth} onChange={(e) => setStatusMonth(e.target.value)}>
                <option value="">月を選択</option>
                {allMonths.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="field">
              <label>ラダーレベル</label>
              <select value={statusLevel} onChange={(e) => setStatusLevel(Number(e.target.value) as LadderLevel)}>
                {ladderLevels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>

          {!statusMonth ? (
            <div className="small-text">評価月を選択してください。</div>
          ) : (
            <>
              <div className="completion-summary">
                <div className="completion-stat">
                  <span className="completion-label">本人評価</span>
                  <span className="completion-value">{selfSubmitted} / {employees.length} 名提出</span>
                  <span className="completion-locked">（うち {selfLocked} 名確定済み）</span>
                </div>
                <div className="completion-stat">
                  <span className="completion-label">管理者評価</span>
                  <span className="completion-value">{adminSubmitted} / {employees.length} 名提出</span>
                  <span className="completion-locked">（うち {adminLocked} 名確定済み）</span>
                </div>
              </div>

              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr><th>社員名</th><th>本人評価</th><th>管理者評価</th></tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id}>
                        <td>{emp.name}</td>
                        <td>{statusLabel(getStatus(emp.id, 'self'))}</td>
                        <td>{statusLabel(getStatus(emp.id, 'admin'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default AdminEvaluationList;
