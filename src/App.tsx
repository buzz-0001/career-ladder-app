import { useCallback, useEffect, useMemo, useState } from 'react';
import Login from './components/Login';
import EvaluationForm from './components/EvaluationForm';
import Dashboard from './components/Dashboard';
import AdminEvaluationList from './components/AdminEvaluationList';
import AdminUserManagement from './components/AdminUserManagement';
import { baseCategories } from './data/master';
import { loadAuthUser, saveAuthUser } from './utils/auth';
import { apiGetEmployees } from './utils/api';
import type { Category, Employee, User } from './types';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState<'input' | 'dashboard' | 'admin' | 'users'>('input');
  const [employeeId, setEmployeeId] = useState('');
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [user, setUser] = useState<User | null>(() => loadAuthUser());
  const [categories] = useState<Category[]>(baseCategories);

  const loadEmployees = useCallback(() => {
    apiGetEmployees().then((emps) => {
      setEmployeesList(emps);
      setEmployeeId((prev) => {
        if (prev && emps.some((e) => e.id === prev)) return prev;
        if (user?.role === 'self' && user.employeeId) return user.employeeId;
        return emps[0]?.id ?? '';
      });
    }).catch(console.error);
  }, [user]);

  useEffect(() => {
    saveAuthUser(user);
    if (user) loadEmployees();
  }, [user]);

  const handleLogin = useCallback((nextUser: User) => {
    setUser(nextUser);
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    setEmployeeId('');
    setEmployeesList([]);
  }, []);

  const employeeName = useMemo(
    () => employeesList.find((e) => e.id === employeeId)?.name ?? '',
    [employeesList, employeeId]
  );

  if (!user) {
    return (
      <div className="app-shell">
        <Login onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>ラダーミエル</h1>
          <p>{user.role === 'admin' ? '管理者ダッシュボード' : `${user.displayName} さんの自己評価画面`}</p>
          <span className="user-chip">{user.displayName} ({user.role === 'admin' ? '管理者' : '本人'})</span>
        </div>
        <div className="tabs">
          <button type="button" className="secondary-button" onClick={handleLogout}>
            ログアウト
          </button>
          <button type="button" className={activeTab === 'input' ? 'active' : ''} onClick={() => setActiveTab('input')}>
            評価入力
          </button>
          <button type="button" className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => setActiveTab('dashboard')}>
            ダッシュボード
          </button>
          {user.role === 'admin' && (
            <>
              <button type="button" className={activeTab === 'admin' ? 'active' : ''} onClick={() => setActiveTab('admin')}>
                評価一覧
              </button>
              <button type="button" className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>
                ユーザー管理
              </button>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'input' ? (
          <EvaluationForm
            employeeId={employeeId}
            employeeName={employeeName}
            onEmployeeChange={setEmployeeId}
            categories={categories}
            employees={employeesList}
            user={user}
          />
        ) : activeTab === 'dashboard' ? (
          <Dashboard
            employeeId={employeeId}
            employeeName={employeeName}
            onEmployeeChange={setEmployeeId}
            categories={categories}
            employees={employeesList}
            user={user}
          />
        ) : activeTab === 'admin' ? (
          <AdminEvaluationList employees={employeesList} categories={categories} user={user} />
        ) : (
          <AdminUserManagement employees={employeesList} onEmployeesChange={loadEmployees} user={user} />
        )}
      </main>
    </div>
  );
}

export default App;
