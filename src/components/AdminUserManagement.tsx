import { useEffect, useState } from 'react';
import type { AdminUser, Employee, User } from '../types';
import {
  apiGetUsers, apiCreateUser, apiUpdateUser, apiDeleteUser,
  apiCreateEmployee, apiUpdateEmployee, apiDeleteEmployee,
} from '../utils/api';

interface AdminUserManagementProps {
  employees: Employee[];
  onEmployeesChange: () => void;
  user: User;
}

const MASTER_KEY = '2019_0703_masteradmin_MIERU';

// ─── 社員管理セクションの表示フラグ ───────────────────────────────────────
// true に戻すことで社員管理セクションを再表示できます
const SHOW_EMP_MANAGEMENT = false;

type PwModalTarget =
  | { type: 'new' }
  | { type: 'edit'; user: AdminUser };

const emptyUserForm = { username: '', displayName: '', password: '', role: 'self', department: '' };
const emptyEmpForm = { id: '', name: '' };

function AdminUserManagement({ employees, onEmployeesChange, user }: AdminUserManagementProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');

  const [showAddUser, setShowAddUser] = useState(false);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editUserForm, setEditUserForm] = useState({ displayName: '', role: 'self', department: '' });

  const [showAddEmp, setShowAddEmp] = useState(false);
  const [empForm, setEmpForm] = useState(emptyEmpForm);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [editEmpName, setEditEmpName] = useState('');

  // パスワードモーダル
  const [pwModal, setPwModal] = useState<PwModalTarget | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyVerified, setKeyVerified] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    apiGetUsers().then(setUsers).catch(console.error);
  }, []);

  if (user.role !== 'admin') return null;

  const handleError = (err: unknown) => setError(err instanceof Error ? err.message : '操作に失敗しました');
  const clearError = () => setError('');

  // ─── パスワードモーダル操作 ────────────────────────────────────────────

  const openPwModal = (target: PwModalTarget) => {
    setPwModal(target);
    setKeyInput('');
    setKeyVerified(false);
    setKeyError('');
    setNewPassword('');
  };

  const closePwModal = () => {
    setPwModal(null);
    setKeyInput('');
    setKeyVerified(false);
    setKeyError('');
    setNewPassword('');
  };

  const handleKeyVerify = () => {
    if (keyInput === MASTER_KEY) {
      setKeyVerified(true);
      setKeyError('');
    } else {
      setKeyError('キーが正しくありません');
    }
  };

  const handlePasswordSave = async () => {
    if (!pwModal || !newPassword) return;
    setPwSaving(true);
    try {
      if (pwModal.type === 'new') {
        setUserForm((prev) => ({ ...prev, password: newPassword }));
        closePwModal();
      } else {
        await apiUpdateUser(pwModal.user.id, {
          displayName: pwModal.user.displayName,
          role: pwModal.user.role,
          department: pwModal.user.department,
          password: newPassword,
        });
        closePwModal();
      }
    } catch (err) {
      handleError(err);
    } finally {
      setPwSaving(false);
    }
  };

  // ─── ユーザー操作 ────────────────────────────────────────────────────────

  const handleCreateUser = async () => {
    if (!userForm.password) {
      setError('パスワードを設定してください');
      return;
    }
    clearError();
    try {
      const created = await apiCreateUser({
        username: userForm.username,
        displayName: userForm.displayName,
        password: userForm.password,
        role: userForm.role,
        department: userForm.department || undefined,
      });
      setUsers((prev) => [...prev, created]);
      setUserForm(emptyUserForm);
      setShowAddUser(false);
    } catch (err) { handleError(err); }
  };

  const startEditUser = (u: AdminUser) => {
    setEditingUser(u);
    setEditUserForm({ displayName: u.displayName, role: u.role, department: u.department ?? '' });
    clearError();
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    clearError();
    try {
      await apiUpdateUser(editingUser.id, {
        displayName: editUserForm.displayName,
        role: editUserForm.role,
        department: editUserForm.department || undefined,
      });
      setUsers((prev) => prev.map((u) => u.id === editingUser.id
        ? { ...u, displayName: editUserForm.displayName, role: editUserForm.role as AdminUser['role'], department: editUserForm.department }
        : u
      ));
      setEditingUser(null);
    } catch (err) { handleError(err); }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm('このユーザーを削除しますか？')) return;
    clearError();
    try {
      await apiDeleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) { handleError(err); }
  };

  // ─── 社員操作（社員管理セクション用・非表示中も保持） ─────────────────

  const handleCreateEmployee = async () => {
    clearError();
    try {
      await apiCreateEmployee(empForm);
      onEmployeesChange();
      setEmpForm(emptyEmpForm);
      setShowAddEmp(false);
    } catch (err) { handleError(err); }
  };

  const handleUpdateEmployee = async () => {
    if (!editingEmp) return;
    clearError();
    try {
      await apiUpdateEmployee(editingEmp.id, editEmpName);
      onEmployeesChange();
      setEditingEmp(null);
    } catch (err) { handleError(err); }
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm('この社員を削除しますか？関連する評価データは残ります。')) return;
    clearError();
    try {
      await apiDeleteEmployee(id);
      onEmployeesChange();
    } catch (err) { handleError(err); }
  };

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

      {/* ─── ユーザー管理 ─── */}
      <section className="card">
        <div className="label-row">
          <div className="badge">ユーザー管理</div>
          <button type="button" className="primary-button" onClick={() => { setShowAddUser((v) => !v); clearError(); }}>
            {showAddUser ? 'キャンセル' : '＋ 追加'}
          </button>
        </div>

        {showAddUser && (
          <div className="admin-form">
            <div className="input-row">
              <div className="field">
                <label>ユーザー名</label>
                <input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
              </div>
              <div className="field">
                <label>表示名</label>
                <input value={userForm.displayName} onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })} />
              </div>
              <div className="field">
                <label>役割</label>
                <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                  <option value="self">本人</option>
                  <option value="admin">管理者</option>
                </select>
              </div>
              <div className="field">
                <label>部署</label>
                <input value={userForm.department} onChange={(e) => setUserForm({ ...userForm, department: e.target.value })} placeholder="例：健康予防事業部" />
              </div>
              <div className="field">
                <label>パスワード</label>
                {userForm.password ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '0.88rem' }}>✓ 設定済み</span>
                    <button type="button" className="secondary-button" style={{ fontSize: '0.78rem', padding: '3px 8px' }} onClick={() => openPwModal({ type: 'new' })}>変更</button>
                  </div>
                ) : (
                  <button type="button" className="secondary-button" onClick={() => openPwModal({ type: 'new' })}>
                    パスワードを発行する
                  </button>
                )}
              </div>
            </div>
            <button type="button" className="primary-button" onClick={handleCreateUser}>保存</button>
          </div>
        )}

        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr><th>ユーザー名</th><th>表示名</th><th>役割</th><th>社員ID</th><th>部署</th><th>操作</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                editingUser?.id === u.id ? (
                  <tr key={u.id} className="row-editing">
                    <td className="small-text">{u.username}</td>
                    <td><input className="table-input" value={editUserForm.displayName} onChange={(e) => setEditUserForm({ ...editUserForm, displayName: e.target.value })} /></td>
                    <td>
                      <select className="table-input" value={editUserForm.role} onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value })}>
                        <option value="self">本人</option>
                        <option value="admin">管理者</option>
                      </select>
                    </td>
                    <td className="small-text">{u.employeeId ?? '-'}</td>
                    <td><input className="table-input" value={editUserForm.department} onChange={(e) => setEditUserForm({ ...editUserForm, department: e.target.value })} placeholder="部署名" /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button type="button" className="primary-button" onClick={handleUpdateUser}>保存</button>
                        <button type="button" className="secondary-button" onClick={() => openPwModal({ type: 'edit', user: u })}>PW変更</button>
                        <button type="button" className="secondary-button" onClick={() => setEditingUser(null)}>戻る</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.displayName}</td>
                    <td>{u.role === 'admin' ? '管理者' : '本人'}</td>
                    <td className="small-text">{u.employeeId ?? '-'}</td>
                    <td>{u.department || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button type="button" className="secondary-button" onClick={() => startEditUser(u)}>編集</button>
                        <button type="button" className="secondary-button" onClick={() => openPwModal({ type: 'edit', user: u })}>PW変更</button>
                        <button type="button" className="secondary-button" onClick={() => handleDeleteUser(u.id)}>削除</button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── 社員管理（SHOW_EMP_MANAGEMENT = true で再表示可能） ─── */}
      {SHOW_EMP_MANAGEMENT && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="label-row">
            <div className="badge">社員管理</div>
            <button type="button" className="primary-button" onClick={() => { setShowAddEmp((v) => !v); clearError(); }}>
              {showAddEmp ? 'キャンセル' : '＋ 追加'}
            </button>
          </div>

          {showAddEmp && (
            <div className="admin-form">
              <div className="input-row">
                <div className="field">
                  <label>社員ID（例: emp-04）</label>
                  <input value={empForm.id} onChange={(e) => setEmpForm({ ...empForm, id: e.target.value })} />
                </div>
                <div className="field">
                  <label>氏名</label>
                  <input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} />
                </div>
              </div>
              <button type="button" className="primary-button" onClick={handleCreateEmployee}>保存</button>
            </div>
          )}

          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr><th>社員ID</th><th>氏名</th><th>操作</th></tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  editingEmp?.id === emp.id ? (
                    <tr key={emp.id} className="row-editing">
                      <td className="small-text">{emp.id}</td>
                      <td><input className="table-input" value={editEmpName} onChange={(e) => setEditEmpName(e.target.value)} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="primary-button" onClick={handleUpdateEmployee}>保存</button>
                          <button type="button" className="secondary-button" onClick={() => setEditingEmp(null)}>戻る</button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={emp.id}>
                      <td className="small-text">{emp.id}</td>
                      <td>{emp.name}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="secondary-button" onClick={() => { setEditingEmp(emp); setEditEmpName(emp.name); clearError(); }}>編集</button>
                          <button type="button" className="secondary-button" onClick={() => handleDeleteEmployee(emp.id)}>削除</button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── パスワードモーダル ─── */}
      {pwModal && (
        <div className="modal-overlay" onClick={closePwModal}>
          <div className="modal-content" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{keyVerified ? 'パスワードを設定' : 'key?'}</h3>
              <button type="button" className="close-button" onClick={closePwModal}>×</button>
            </div>
            <div style={{ padding: '8px 0 16px' }}>
              {!keyVerified ? (
                <>
                  <p className="small-text" style={{ marginBottom: 12 }}>マスターキーを入力してください</p>
                  <input
                    className="table-input"
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleKeyVerify()}
                    placeholder="マスターキーを入力"
                    style={{ width: '100%', marginBottom: 8 }}
                    autoFocus
                  />
                  {keyError && (
                    <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>{keyError}</p>
                  )}
                  <button type="button" className="primary-button" onClick={handleKeyVerify}>確認</button>
                </>
              ) : (
                <>
                  {pwModal.type === 'edit' && (
                    <p className="small-text" style={{ marginBottom: 12 }}>
                      対象ユーザー：<strong>{pwModal.user.username}</strong>（{pwModal.user.displayName}）
                    </p>
                  )}
                  <label style={{ fontWeight: 700, fontSize: '0.9rem', display: 'block', marginBottom: 6 }}>
                    新しいパスワード
                  </label>
                  <input
                    className="table-input"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !pwSaving && handlePasswordSave()}
                    placeholder="新しいパスワードを入力"
                    style={{ width: '100%', marginBottom: 12 }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handlePasswordSave}
                    disabled={!newPassword || pwSaving}
                  >
                    {pwSaving ? '保存中...' : pwModal.type === 'new' ? '設定する' : '変更する'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminUserManagement;
