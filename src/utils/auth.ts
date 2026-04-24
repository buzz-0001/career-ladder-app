import type { User } from '../types';
import { setToken } from './api';

const USER_KEY = 'career-ladder-user';

export function loadAuthUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function saveAuthUser(user: User | null): void {
  if (!user) {
    localStorage.removeItem(USER_KEY);
    setToken(null);
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
