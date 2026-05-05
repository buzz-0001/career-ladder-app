export type LadderLevel = 1 | 2 | 3 | 4;

export interface Employee {
  id: string;
  name: string;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  employeeId: string | null;
  department?: string;
}
export type EvaluationRole = 'self' | 'admin';
export type Score = 0 | 1 | 2 | 'excluded';
export type UserRole = 'self' | 'admin';

export interface User {
  username: string;
  displayName: string;
  role: UserRole;
  employeeId?: string;
}

export interface Criteria {
  0: string;
  1: string;
  2: string;
}

export interface DetailedSubItem {
  id: string;
  title: string;
  criteria: Criteria;
}

export interface SubItem {
  id: string;
  title: string;
  level: LadderLevel;
  criteria?: Criteria;
  details?: DetailedSubItem[];
}

export interface Category {
  id: string;
  title: string;
  subItems: SubItem[];
}

export interface EvaluationRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  month: string;
  level: LadderLevel;
  role: EvaluationRole;
  locked: boolean;
  goal?: string;
  challenge?: string;
  reviewPeriod?: string;
  adminChallenge?: string;
  teamOpinion?: string;
  feedback?: string;
  scores: Record<string, Score>;
  updatedAt: string;
}
