import { useEffect, useMemo, useState } from 'react';
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
import type { Category, Employee, EvaluationRecord, EvaluationRole, User } from '../types';
import { apiLoadEvaluations } from '../utils/api';
import { calcCategoryScore, calcTotalScore } from '../utils/scoring';

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

function Dashboard({ employeeId, employeeName, onEmployeeChange, categories, employees, user }: DashboardProps) {
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [role, setRole] = useState<EvaluationRole>('self');
  const [summaryText, setSummaryText] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [lineMetricId, setLineMetricId] = useState('total');

  useEffect(() => {
    apiLoadEvaluations().then(setEvaluations).catch(console.error);
  }, []);

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

  const handleFetchSummary = async () => {
    if (!latestRecord) return;
    setFetching(true);
    setSummaryText('AI要約を生成中です...');
    try {
      const response = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeName, role, latestRecord, trend: sortedRecords.slice(0, 6) }),
      });
      const result = await response.json();
      setSummaryText(result.summary ?? '要約の取得に失敗しました。');
    } catch {
      setSummaryText('AI要約の取得中にエラーが発生しました。');
    } finally {
      setFetching(false);
    }
  };

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;

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
          <div className="score-options">
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
              <div className="chart-box">
                <Radar
                  data={radarData}
                  options={{
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
              <div className="chart-box">
                <Line
                  data={lineData}
                  options={{
                    responsive: true,
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
              <h3>AI要約</h3>
              <button type="button" onClick={handleFetchSummary} disabled={fetching} style={{ marginBottom: 16 }}>
                {fetching ? '生成中...' : 'AI要約を取得する'}
              </button>
              <div className="summary-text">{summaryText || '最新評価と推移をもとに成長ポイントと課題を表示します。'}</div>
            </section>

            <section className="category-card">
              <h3>詳細分析</h3>
              <div className="data-grid">
                {categories.map((cat) => (
                  <div key={cat.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{cat.title}</span>
                    <button type="button" onClick={() => setSelectedCategoryId(cat.id)}>詳細</button>
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

      {selectedCategory && (
        <section className="category-card">
          <h3>{selectedCategory.title} の小項目履歴</h3>
          {months.length === 0 ? (
            <p>履歴がありません。</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0' }}>年月</th>
                  {selectedCategory.subItems
                    .filter((item) => item.level === latestRecord?.level)
                    .map((sub) => (
                      <th key={sub.id} style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0' }}>
                        {sub.title}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const record = sortedRecords.find((r) => r.month === m);
                  return (
                    <tr key={m}>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>{formatMonthLabel(m)}</td>
                      {selectedCategory.subItems
                        .filter((item) => item.level === latestRecord?.level)
                        .map((sub) => (
                          <td key={sub.id} style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>
                            {record ? (record.scores[sub.id] ?? '-') : '-'}
                          </td>
                        ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </section>
  );
}

export default Dashboard;
