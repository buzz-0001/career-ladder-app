import { EvaluationRecord } from '../types';

const STORAGE_KEY = 'career-ladder-evaluations';

export function loadEvaluations(): EvaluationRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as EvaluationRecord[];
  } catch {
    return [];
  }
}

export function saveEvaluations(records: EvaluationRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function mergeEvaluation(record: EvaluationRecord) {
  const existing = loadEvaluations();
  const updated = existing.filter((item) => item.id !== record.id);
  updated.push(record);
  saveEvaluations(updated);
}
