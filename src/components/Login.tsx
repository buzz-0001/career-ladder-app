import { useState, type FormEvent } from 'react';
import { apiLogin } from '../utils/api';
import { saveAuthUser } from '../utils/auth';
import type { User } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
}

function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await apiLogin(username, password);
      saveAuthUser(user);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-card card">
      <h2>ログイン</h2>
      <p className="small-text">本人／管理者でアクセスできます。管理者はマスタ取り込みと全社員の閲覧が可能です。</p>
      <form onSubmit={handleSubmit} className="login-form">
        <div className="field">
          <label>ユーザー名</label>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>パスワード</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? 'ログイン中...' : 'ログイン'}
        </button>
      </form>
      <div className="small-text">
        <p>デモアカウント:</p>
        <ul>
          <li>本人: yamada / yamada</li>
          <li>管理者: admin / admin</li>
        </ul>
      </div>
    </section>
  );
}

export default Login;
