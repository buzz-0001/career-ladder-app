import type { AdminUser, Employee, EvaluationRecord, User } from '../types';

const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('career-ladder-token');
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem('career-ladder-token', token);
  } else {
    localStorage.removeItem('career-ladder-token');
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiLogin(username: string, password: string): Promise<User> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await handleResponse<{ token: string; user: User }>(res);
  setToken(data.token);
  return data.user;
}

export function apiLogout(): void {
  setToken(null);
}

export async function apiGetEmployees(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${API_BASE}/employees`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function apiLoadEvaluations(): Promise<EvaluationRecord[]> {
  const res = await fetch(`${API_BASE}/evaluations`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function apiSaveEvaluation(record: EvaluationRecord): Promise<void> {
  const res = await fetch(`${API_BASE}/evaluations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(record),
  });
  await handleResponse(res);
}

export async function apiLockEvaluation(id: string, locked: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/evaluations/${id}/lock`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ locked }),
  });
  await handleResponse(res);
}

// ─── ユーザー管理 ─────────────────────────────────────────────────────────

export async function apiGetUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function apiCreateUser(data: { username: string; displayName: string; password: string; role: string; department?: string }): Promise<AdminUser> {
  const res = await fetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function apiUpdateUser(id: number, data: { displayName: string; role: string; department?: string; password?: string }): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  await handleResponse(res);
}

export async function apiDeleteUser(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await handleResponse(res);
}

// ─── 社員管理 ─────────────────────────────────────────────────────────────

export async function apiCreateEmployee(data: Employee): Promise<Employee> {
  const res = await fetch(`${API_BASE}/admin/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function apiUpdateEmployee(id: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/employees/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
}

export async function apiDeleteEmployee(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/employees/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await handleResponse(res);
}
