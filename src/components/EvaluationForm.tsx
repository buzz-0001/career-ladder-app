import { useEffect, useMemo, useState, useRef } from 'react';
import { ladderLevels } from '../data/master';
import { EvaluationRecord, EvaluationRole, Employee, LadderLevel, Score, User, Category } from '../types';
import { apiLoadEvaluations, apiSaveEvaluation, apiLockEvaluation } from '../utils/api';

interface EvaluationFormProps {
  employeeId: string;
  employeeName: string;
  onEmployeeChange: (id: string) => void;
  categories: Category[];
  employees: Employee[];
  user: User;
}

const roles: { value: EvaluationRole; label: string }[] = [
  { value: 'self', label: '本人' },
  { value: 'admin', label: '管理者' }
];

const categoryGroups = [
  { label: 'コア', ids: ['kodo'] },
  { label: 'サービス対応', ids: ['riyou', 'gyomu', 'pro', 'eisei'] },
  { label: '組織管理', ids: ['team', 'chitsujo', 'jinzai'] },
  { label: '自己管理', ids: ['jiko', 'kenko'] },
];

function EvaluationForm({ employeeId, employeeName, onEmployeeChange, categories, employees, user }: EvaluationFormProps) {
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [month, setMonth] = useState('2025-01');
  const [level, setLevel] = useState<LadderLevel>(1);
  const [role, setRole] = useState<EvaluationRole>('self');
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [goal, setGoal] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const effectiveRole = user.role === 'self' ? 'self' as const : role;
  const currentRecordId = useMemo(
    () => `${employeeId}-${month}-${level}-${effectiveRole}`,
    [employeeId, month, level, effectiveRole]
  );

  useEffect(() => {
    apiLoadEvaluations().then(setEvaluations).catch(console.error);
  }, []);

  useEffect(() => {
    const existing = evaluations.find((record) => record.id === currentRecordId);
    if (existing) {
      setScores(existing.scores);
      setGoal(existing.goal ?? '');
    } else {
      setScores({});
      setGoal('');
    }
  }, [currentRecordId, evaluations]);

  useEffect(() => {
    if (modalOpen && modalContentRef.current) {
      modalContentRef.current.scrollTop = 0;
    }
  }, [currentCategoryIndex, modalOpen]);

  const visibleCategories = useMemo(
    () => categories.map((category) => ({
      ...category,
      subItems: category.subItems.filter((item) => item.level === level)
    })),
    [categories, level]
  );

  type DisplayItem = {
    id: string;
    title: string;
    criteria: Record<0 | 1 | 2, string>;
  };

  const flattenCategoryItems = (category: Category): DisplayItem[] => {
    const items: DisplayItem[] = [];
    category.subItems.forEach((subItem) => {
      if (subItem.details && subItem.details.length > 0) {
        subItem.details.forEach((detail) => {
          items.push({
            id: detail.id,
            title: detail.title,
            criteria: detail.criteria
          });
        });
      } else if (subItem.criteria) {
        items.push({
          id: subItem.id,
          title: subItem.title,
          criteria: subItem.criteria
        });
      }
    });
    return items;
  };

  const getCategoryScore = (category: Category) => {
    const items = flattenCategoryItems(category);
    const excluded = items.filter((item) => scores[item.id] === 'excluded').length;
    const active = Math.max(0, items.length - excluded);
    const total = items.reduce((sum, item) => {
      const score = scores[item.id];
      return sum + (typeof score === 'number' ? score : 0);
    }, 0);
    const max = active * 2;
    const percent = max > 0 ? Math.round((total / max) * 100) : 0;
    return { total, max, percent, active, excluded, itemCount: items.length };
  };

  const getGroupScore = (ids: string[]) => {
    const cats = visibleCategories.filter((c) => ids.includes(c.id));
    let total = 0, max = 0, excluded = 0;
    cats.forEach((cat) => {
      const s = getCategoryScore(cat);
      total += s.total;
      max += s.max;
      excluded += s.excluded;
    });
    const percent = max > 0 ? Math.round((total / max) * 100) : 0;
    return { total, max, percent, excluded };
  };

  const allRatableItems = useMemo(() => {
    const items: DisplayItem[] = [];
    visibleCategories.forEach((category) => {
      items.push(...flattenCategoryItems(category));
    });
    return items;
  }, [visibleCategories]);

  const openModal = (categoryIndex: number) => {
    setCurrentCategoryIndex(categoryIndex);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const saveAndNavigate = (direction: 'prev' | 'next') => {
    const nextIndex = direction === 'prev' 
      ? (currentCategoryIndex - 1 + visibleCategories.length) % visibleCategories.length
      : (currentCategoryIndex + 1) % visibleCategories.length;
    setCurrentCategoryIndex(nextIndex);
  };

  const currentRecord = evaluations.find((r) => r.id === currentRecordId) ?? null;
  const isLocked = currentRecord?.locked ?? false;

  const handleToggleLock = async () => {
    if (!currentRecord) return;
    const nextLocked = !isLocked;
    await apiLockEvaluation(currentRecord.id, nextLocked).catch(console.error);
    setEvaluations((prev) =>
      prev.map((r) => r.id === currentRecord.id ? { ...r, locked: nextLocked } : r)
    );
  };

  const saveRecord = (nextScores: Record<string, Score>) => {
    if (isLocked && user.role !== 'admin') return;
    const record: EvaluationRecord = {
      id: currentRecordId,
      employeeId,
      employeeName,
      month,
      level,
      role: effectiveRole,
      locked: isLocked,
      goal,
      scores: nextScores,
      updatedAt: new Date().toISOString()
    };

    setEvaluations((prev) => [...prev.filter((item) => item.id !== record.id), record]);
    setSavedAt(new Date().toLocaleString());
    apiSaveEvaluation(record).catch(console.error);
  };

  const handleScoreChange = (subItemId: string, value: Score) => {
    const nextScores = {
      ...scores,
      [subItemId]: value
    };
    setScores(nextScores);
    saveRecord(nextScores);
  };

  const excludedCount = Object.values(scores).filter((score) => score === 'excluded').length;
  const expectedCount = allRatableItems.length;
  const activeCount = Math.max(0, expectedCount - excludedCount);

  const totalScore = Object.values(scores).reduce<number>((sum, score) => sum + (typeof score === 'number' ? score : 0), 0);
  const maxScore = activeCount * 2;
  const scorePercentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const currentCategoryDetails = useMemo(() => {
    if (currentCategoryIndex >= visibleCategories.length) return [];
    const category = visibleCategories[currentCategoryIndex];
    return flattenCategoryItems(category);
  }, [currentCategoryIndex, visibleCategories]);

  return (
    <section className="card">
      <div className="label-row">
        <div className="badge">評価入力画面</div>
        <div className="small-text">選択した評価対象者、時期、レベル、評価者別に保存されます。</div>
      </div>

      <div className="input-row">
        <div className="field">
          <label>評価対象者</label>
          <select
            value={employeeId}
            onChange={(event) => onEmployeeChange(event.target.value)}
            disabled={user.role === 'self'}
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
          {user.role === 'self' ? <p className="small-text">ログインユーザーの本人評価のみ可能です。</p> : null}
        </div>

        <div className="field">
          <label>評価実施月</label>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </div>

        <div className="field">
          <label>ラダーレベル</label>
          <select value={level} onChange={(event) => setLevel(Number(event.target.value) as LadderLevel)}>
            {ladderLevels.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>評価者</label>
          <div className="role-options">
            {roles.map((item) => (
              <label key={item.value}>
                <input
                  type="radio"
                  name="evaluation-role"
                  value={item.value}
                  checked={effectiveRole === item.value}
                  onChange={() => setRole(item.value)}
                  disabled={user.role === 'self'}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <strong>対象者</strong>
          {employeeName}
        </div>
        <div className="stat-card">
          <strong>合計点数</strong>
          <div className="score-display">{totalScore} / {maxScore}点</div>
          {excludedCount > 0 && <div className="small-text">除外 {excludedCount}項目</div>}
        </div>
        <div className="stat-card">
          <strong>得点割合</strong>
          <div className="percentage-display">
            <div className="percentage-bar">
              <div className="percentage-fill" style={{ width: `${scorePercentage}%` }}></div>
            </div>
            <span>{scorePercentage}%</span>
          </div>
        </div>
        <div className="stat-card">
          <strong>最終保存</strong>
          {savedAt || 'まだ保存されていません'}
          {isLocked && <div className="locked-badge">🔒 確定済み</div>}
          {user.role === 'admin' && currentRecord && (
            <button
              type="button"
              className={isLocked ? 'secondary-button' : 'primary-button'}
              style={{ marginTop: 8 }}
              onClick={handleToggleLock}
            >
              {isLocked ? '🔓 ロック解除' : '🔒 確定する'}
            </button>
          )}
        </div>
      </div>

      <div className="group-stats-row">
        {categoryGroups.map((group) => {
          const g = getGroupScore(group.ids);
          return (
            <div key={group.label} className="group-stat-card">
              <strong>{group.label}</strong>
              <div className="group-score">
                {g.total} / {g.max}点<span className="group-percent">（{g.percent}%）</span>
              </div>
              {g.excluded > 0 && <div className="small-text">除外 {g.excluded}項目</div>}
            </div>
          );
        })}
      </div>

      <div className="goal-input-section">
        <label className="goal-input-label">3か月後の目標</label>
        <textarea
          className="goal-textarea"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onBlur={() => saveRecord(scores)}
          placeholder="3か月後に達成したい目標を記入してください"
          disabled={isLocked && user.role !== 'admin'}
          rows={3}
        />
      </div>

      <div className="data-grid">
        {visibleCategories.map((category, index) => {
          const categoryScore = getCategoryScore(category);
          return (
            <section key={category.id} className="category-card">
              <div className="category-card-header">
                <h3>{category.title}</h3>
                <div className="category-actions">
                  <button type="button" className="primary-button" onClick={() => openModal(index)}>
                    採点する
                  </button>
                  <div className="category-score-summary">
                    <span>{categoryScore.total} / {categoryScore.max}点</span>
                    <span>{categoryScore.percent}%</span>
                  </div>
                </div>
              </div>

              <p className="small-text">項目数: {categoryScore.itemCount}{categoryScore.excluded > 0 ? ` ・除外 ${categoryScore.excluded}項目` : ''}</p>

              {categoryScore.itemCount === 0 && (
                <div className="small-text">現在のレベルに表示できる項目がありません。</div>
              )}
            </section>
          );
        })}
      </div>

      {modalOpen && currentCategoryIndex >= 0 && currentCategoryIndex < visibleCategories.length && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" ref={modalContentRef} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{visibleCategories[currentCategoryIndex]?.title} の採点</h3>
              <button type="button" className="close-button" onClick={closeModal}>×</button>
            </div>
            <div className="modal-items">
              {isLocked && (
                <div className="locked-banner">🔒 この評価は確定済みです。管理者のみ編集できます。</div>
              )}
              {currentCategoryDetails.length === 0 ? (
                <div className="small-text">このカテゴリには現在のレベルで採点できる項目がありません。</div>
              ) : currentCategoryDetails.map((detail) => (
                <div key={detail.id} className="modal-item">
                  <div className="item-title">{detail.title}</div>
                  <div className="modal-criteria">
                    {([0, 1, 2] as (0 | 1 | 2)[]).map((score) => (
                      <div key={score} className="modal-criteria-item">
                        <strong className="modal-criteria-score">{score}点</strong>
                        <span>{detail.criteria[score]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="score-options">
                    {[0, 1, 2, 'excluded'].map((value) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name={detail.id}
                          value={value}
                          checked={scores[detail.id] === value}
                          disabled={isLocked && user.role !== 'admin'}
                          onChange={() => handleScoreChange(detail.id, value as Score)}
                        />
                        {value === 'excluded' ? '除外' : `${value}点`}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <div className="score-summary">
                <div>採点項目数: {currentCategoryDetails.filter(item => scores[item.id] !== 'excluded').length}</div>
                <div>合計点数: {currentCategoryDetails.reduce((sum, item) => {
                  const score = scores[item.id];
                  return sum + (score !== 'excluded' && typeof score === 'number' ? score : 0);
                }, 0)} / {currentCategoryDetails.filter(item => scores[item.id] !== 'excluded').length * 2}点</div>
                <div>得点割合: {currentCategoryDetails.filter(item => scores[item.id] !== 'excluded').length > 0 
                  ? Math.round((currentCategoryDetails.reduce((sum, item) => {
                      const score = scores[item.id];
                      return sum + (score !== 'excluded' && typeof score === 'number' ? score : 0);
                    }, 0) / (currentCategoryDetails.filter(item => scores[item.id] !== 'excluded').length * 2)) * 100)
                  : 0}%</div>
              </div>
              <div className="modal-buttons">
                <button type="button" className="secondary-button" onClick={() => saveAndNavigate('prev')}>
                  保存して前に戻る
                </button>
                <button type="button" className="primary-button" onClick={() => saveAndNavigate('next')}>
                  保存して次に進む
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default EvaluationForm;
