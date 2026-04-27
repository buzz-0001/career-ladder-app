import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
} from 'chart.js';
import { Radar, Line } from 'react-chartjs-2';
import type { Category, Employee, EvaluationRecord, EvaluationRole, Score, User } from '../types';
import { apiLoadEvaluations } from '../utils/api';
import { calcCategoryScore, calcTotalScore, flattenCategoryItems } from '../utils/scoring';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend, CategoryScale, LinearScale);

interface DashboardProps {
  employeeId: string;
  employeeName: string;
  onEmployeeChange: (id: string) => void;
  categories: Category[];
  employees: Employee[];
  user: User;
}

const roles: { value: EvaluationRole; label: string }[] = [
  { value: 'self', label: '本人評価' },
  { value: 'admin', label: '管理者評価' },
];

const GROUP_METRICS = [
  { id: 'group_core', label: 'コア', catIds: ['kodo'] },
  { id: 'group_service', label: 'サービス対応', catIds: ['riyou', 'gyomu', 'pro', 'eisei'] },
  { id: 'group_org', label: '組織管理', catIds: ['team', 'chitsujo', 'jinzai'] },
  { id: 'group_self', label: '自己管理', catIds: ['jiko', 'kenko'] },
];

function formatMonthLabel(value: string) {
  const [year, month] = value.split('-');
  return `${year}年${month}月`;
}

function scoreLabel(score: Score | undefined): string {
  if (score === undefined) return '-';
  if (score === 'excluded') return '除外';
  return String(score);
}

function Dashboard({ employeeId, onEmployeeChange, categories, employees, user }: DashboardProps) {
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [role, setRole] = useState<EvaluationRole>('self');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [lineMetricId, setLineMetricId] = useState('total');
  const savedScrollY = useRef<number | null>(null);

  useEffect(() => {
    apiLoadEvaluations().then(setEvaluations).catch(console.error);
  }, []);

  // 対象者・評価種別が変わったら詳細を閉じる
  useEffect(() => {
    setSelectedCategoryId(null);
  }, [employeeId, role]);

  // 詳細トグル時にスクロール位置を保持する
  useEffect(() => {
    if (savedScrollY.current !== null) {
      window.scrollTo({ top: savedScrollY.current, behavior: 'instant' });
      savedScrollY.current = null;
    }
  }, [selectedCategoryId]);

  const handleToggleDetail = (catId: string) => {
    savedScrollY.current = window.scrollY;
    setSelectedCategoryId(selectedCategoryId === catId ? null : catId);
  };

  const filteredRecords = useMemo(
    () => evaluations.filter((r) => r.employeeId === employeeId && r.role === role),
    [evaluations, employeeId, role]
  );

  const sortedRecords = useMemo(
    () => [...filteredRecords].sort((a, b) => b.month.localeCompare(a.month)),
    [filteredRecords]
  );

  const latestRecord = sortedRecords[0] ?? null;
  const previousRecord = sortedRecords[1] ?? null;

  const months = useMemo(
    () => Array.from(new Set(sortedRecords.map((r) => r.month))).sort(),
    [sortedRecords]
  );

  const lineMetricOptions = useMemo(() => [
    { id: 'total', label: '総合得点' },
    ...GROUP_METRICS.map((g) => ({ id: g.id, label: g.label })),
    ...categories.map((c) => ({ id: c.id, label: c.title })),
  ], [categories]);

  const radarData = useMemo(() => {
    const labels = categories.map((c) => c.title);
    const datasets = [];
    if (latestRecord) {
      datasets.push({
        label: `今回 (${latestRecord.month})`,
        data: categories.map((cat) => calcCategoryScore(cat, latestRecord.level, latestRecord.scores).percent),
        backgroundColor: 'rgba(31, 100, 255, 0.18)',
        borderColor: '#1f64ff',
        borderWidth: 2,
        fill: true,
      });
    }
    if (previousRecord) {
      datasets.push({
        label: `前回 (${previousRecord.month})`,
        data: categories.map((cat) => calcCategoryScore(cat, previousRecord.level, previousRecord.scores).percent),
        backgroundColor: 'rgba(148, 163, 184, 0.18)',
        borderColor: '#94a3b8',
        borderWidth: 2,
        fill: true,
      });
    }
    return { labels, datasets };
  }, [categories, latestRecord, previousRecord]);

  const lineData = useMemo(() => {
    const selectedLabel = lineMetricOptions.find((o) => o.id === lineMetricId)?.label ?? '';

    const calcMetric = (record: EvaluationRecord): number => {
      if (lineMetricId === 'total') {
        return calcTotalScore(categories, record.level, record.scores).percent;
      }
      const group = GROUP_METRICS.find((g) => g.id === lineMetricId);
      if (group) {
        const cats = categories.filter((c) => group.catIds.includes(c.id));
        return calcTotalScore(cats, record.level, record.scores).percent;
      }
      const cat = categories.find((c) => c.id === lineMetricId);
      return cat ? calcCategoryScore(cat, record.level, record.scores).percent : 0;
    };

    const data = months.map((m) => {
      const record = sortedRecords.find((r) => r.month === m);
      return record ? calcMetric(record) : null;
    });

    return {
      labels: months.map(formatMonthLabel),
      datasets: [{
        label: `${selectedLabel} (%)`,
        data,
        borderColor: '#1f64ff',
        backgroundColor: 'rgba(31, 100, 255, 0.08)',
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 4,
        fill: false,
        spanGaps: true,
      }],
    };
  }, [months, sortedRecords, lineMetricId, lineMetricOptions, categories]);

  const latestSelfRecord = useMemo(
    () => evaluations
      .filter((r) => r.employeeId === employeeId && r.role === 'self')
      .sort((a, b) => b.month.localeCompare(a.month))[0] ?? null,
    [evaluations, employeeId]
  );

  const latestAdminRecord = useMemo(
    () => evaluations
      .filter((r) => r.employeeId === employeeId && r.role === 'admin')
      .sort((a, b) => b.month.localeCompare(a.month))[0] ?? null,
    [evaluations, employeeId]
  );

  const hasCommentData = !!(
    latestSelfRecord?.challenge ||
    latestAdminRecord?.adminChallenge ||
    latestAdminRecord?.teamOpinion ||
    latestAdminRecord?.feedback
  );

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;

  // 詳細表示: 直近4回 × flattenしたアイテム
  const detailRecords = useMemo(() => sortedRecords.slice(0, 4).reverse(), [sortedRecords]);

  const detailItems = useMemo(() => {
    if (!selectedCategory || !latestRecord) return [];
    const levelCat = {
      ...selectedCategory,
      subItems: selectedCategory.subItems.filter((s) => s.level === latestRecord.level),
    };
    return flattenCategoryItems(levelCat);
  }, [selectedCategory, latestRecord]);

  return (
    <section className="card">
      <div className="label-row">
        <div className="badge">ダッシュボード</div>
        <div className="small-text">対象者の最新評価と履歴を確認できます。</div>
      </div>

      <div className="input-row">
        <div className="field">
          <label>対象者</label>
          <select value={employeeId} onChange={(e) => onEmployeeChange(e.target.value)} disabled={user.role === 'self'}>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
          {user.role === 'self' && <p className="small-text">ご自身の評価のみ閲覧できます。</p>}
        </div>
        <div className="field">
          <label>評価種別</label>
          <div className="role-options">
            {roles.map((r) => (
              <label key={r.value}>
                <input type="radio" name="dashboard-role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {latestRecord ? (
        <>
          {previousRecord?.goal && (
            <div className="goal-display">
              <div className="goal-display-label">前回 ({previousRecord.month}) の3か月後の目標</div>
              <p className="goal-display-text">{previousRecord.goal}</p>
            </div>
          )}

          <div className="data-grid">
            <section className="category-card">
              <h3>前回・今回 比較レーダーチャート</h3>
              <div className="chart-box-radar">
                <Radar
                  data={radarData}
                  options={{
                    maintainAspectRatio: false,
                    scales: {
                      r: {
                        suggestedMin: 0,
                        suggestedMax: 100,
                        ticks: { callback: (v) => `${v}%` },
                      },
                    },
                    plugins: { legend: { position: 'top' } },
                  }}
                />
              </div>
            </section>

            <section className="category-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>得点推移</h3>
                <select value={lineMetricId} onChange={(e) => setLineMetricId(e.target.value)} style={{ fontSize: '0.875rem' }}>
                  {lineMetricOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div className="chart-box-line">
                <Line
                  data={lineData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } },
                    scales: {
                      y: {
                        min: 0,
                        max: 100,
                        ticks: { callback: (v) => `${v}%` },
                        grid: { color: 'rgba(148, 163, 184, 0.2)' },
                      },
                      x: { grid: { color: 'rgba(148, 163, 184, 0.16)' } },
                    },
                  }}
                />
              </div>
            </section>

            <section className="category-card">
              <h3>詳細分析</h3>
              <div className="data-grid">
                {categories.map((cat) => (
                  <div key={cat.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <span>{cat.title}</span>
                      <button
                        type="button"
                        className={selectedCategoryId === cat.id ? 'primary-button' : ''}
                        onClick={() => handleToggleDetail(cat.id)}
                      >
                        {selectedCategoryId === cat.id ? '閉じる' : '詳細'}
                      </button>
                    </div>
                    {selectedCategoryId === cat.id && detailItems.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div className="admin-table-wrapper">
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th>小項目</th>
                                {detailRecords.map((r) => (
                                  <th key={r.month}>{formatMonthLabel(r.month)}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {detailItems.map((item) => (
                                <tr key={item.id}>
                                  <td style={{ maxWidth: 200, whiteSpace: 'normal', fontSize: '0.8rem' }}>{item.title}</td>
                                  {detailRecords.map((r) => (
                                    <td key={r.month} style={{ textAlign: 'center', fontWeight: 600 }}>
                                      {scoreLabel(r.scores[item.id])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                          <button
                            type="button"
                            className="detail-collapse-btn"
                            onClick={() => handleToggleDetail(cat.id)}
                            title="閉じる"
                          >
                            ⌃
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedCategoryId === cat.id && detailItems.length === 0 && (
                      <p className="small-text" style={{ marginTop: 8 }}>現在のレベルに表示できる項目がありません。</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="category-card">
          <p>この対象者・評価種別にはまだ記録がありません。評価入力タブからデータを追加してください。</p>
        </div>
      )}

      {hasCommentData && (
        <section className="category-card">
          <div className="comment-section-header">今後挑戦したいこと / 挑戦してほしいこと</div>
          <div className="comment-two-col">
            <div className="comment-cell">
              <div className="comment-cell-label">本人</div>
              <div className="comment-cell-text">
                {latestSelfRecord?.challenge || <span className="comment-cell-empty">まだ記入されていません</span>}
              </div>
            </div>
            <div className="comment-cell">
              <div className="comment-cell-label">管理者</div>
              <div className="comment-cell-text">
                {latestAdminRecord?.adminChallenge || <span className="comment-cell-empty">まだ記入されていません</span>}
              </div>
            </div>
          </div>
          <div className="comment-section-header">チーム・会社への意見や相談</div>
          <div className="comment-cell-text">
            {latestAdminRecord?.teamOpinion || <span className="comment-cell-empty">まだ記入されていません</span>}
          </div>
          <div className="comment-section-header">フィードバック内容</div>
          <div className="comment-cell-text">
            {latestAdminRecord?.feedback || <span className="comment-cell-empty">まだ記入されていません</span>}
          </div>
        </section>
      )}
    </section>
  );
}

export default Dashboard;
