export interface LoginCredentialHistoryItem {
  username: string;
  password: string;
  savedAt: string;
}

const LOGIN_CREDENTIAL_HISTORY_KEY = 'career-ladder-login-credential-history';
const MAX_HISTORY_ITEMS = 5;

function isLoginCredentialHistoryItem(value: unknown): value is LoginCredentialHistoryItem {
  if (!value || typeof value !== 'object') return false;

  const item = value as Record<string, unknown>;
  return (
    typeof item.username === 'string' &&
    typeof item.password === 'string' &&
    typeof item.savedAt === 'string'
  );
}

export function loadLoginCredentialHistory(): LoginCredentialHistoryItem[] {
  const raw = localStorage.getItem(LOGIN_CREDENTIAL_HISTORY_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isLoginCredentialHistoryItem).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export function saveLoginCredentialHistoryItem(username: string, password: string): LoginCredentialHistoryItem[] {
  const trimmedUsername = username.trim();
  if (!trimmedUsername || !password) return loadLoginCredentialHistory();

  const normalizedUsername = trimmedUsername.toLocaleLowerCase();
  const nextHistory = [
    {
      username: trimmedUsername,
      password,
      savedAt: new Date().toISOString(),
    },
    ...loadLoginCredentialHistory().filter(
      (item) => item.username.trim().toLocaleLowerCase() !== normalizedUsername,
    ),
  ].slice(0, MAX_HISTORY_ITEMS);

  localStorage.setItem(LOGIN_CREDENTIAL_HISTORY_KEY, JSON.stringify(nextHistory));
  return nextHistory;
}

export function findLoginCredentialSuggestions(
  query: string,
  history: LoginCredentialHistoryItem[],
): LoginCredentialHistoryItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  return history.filter((item) => item.username.trim().toLocaleLowerCase().startsWith(normalizedQuery));
}
