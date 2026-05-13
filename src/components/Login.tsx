import { useMemo, useState, type FormEvent } from 'react';
import { apiLogin } from '../utils/api';
import { saveAuthUser } from '../utils/auth';
import {
  findLoginCredentialSuggestions,
  loadLoginCredentialHistory,
  saveLoginCredentialHistoryItem,
  type LoginCredentialHistoryItem,
} from '../utils/loginCredentialHistory';
import type { User } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
}

function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [credentialHistory, setCredentialHistory] = useState(() => loadLoginCredentialHistory());
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [rememberCredential, setRememberCredential] = useState(true);

  const credentialSuggestions = useMemo(
    () => findLoginCredentialSuggestions(username, credentialHistory),
    [credentialHistory, username],
  );
  const showCredentialSuggestions = usernameFocused && credentialSuggestions.length > 0;

  const handleSelectCredential = (credential: LoginCredentialHistoryItem) => {
    setUsername(credential.username);
    setPassword(credential.password);
    setUsernameFocused(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loginUsername = username.trim();
      const user = await apiLogin(loginUsername, password);
      if (rememberCredential) {
        setCredentialHistory(saveLoginCredentialHistoryItem(loginUsername, password));
      }
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
        <div className="field login-suggestion-field">
          <label>ユーザー名</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onFocus={() => setUsernameFocused(true)}
            onBlur={() => setUsernameFocused(false)}
            autoComplete="username"
            autoFocus
          />
          {showCredentialSuggestions ? (
            <div className="login-suggestion-list" role="listbox" aria-label="保存済みログイン候補">
              {credentialSuggestions.map((credential) => (
                <button
                  key={credential.username}
                  type="button"
                  className="login-suggestion-item"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSelectCredential(credential);
                  }}
                >
                  <span className="login-suggestion-username">{credential.username}</span>
                  <span className="login-suggestion-password">保存済みパスワード</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="field">
          <label>パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
        <label className="remember-login">
          <input
            type="checkbox"
            checked={rememberCredential}
            onChange={(event) => setRememberCredential(event.target.checked)}
          />
          この端末にログイン情報を保存する
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? 'ログイン中...' : 'ログイン'}
        </button>
      </form>

    </section>
  );
}

export default Login;
