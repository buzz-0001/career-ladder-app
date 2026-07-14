import type { EvaluationRecord } from '../types';
import { apiSaveEvaluation } from './api';

/**
 * 評価レコードの保存マネージャ。
 *
 * 以前はクリック1回ごとに保存リクエストをキューに積んでいたため、
 * 多数の項目を採点すると送信待ちが数十秒分たまり、その間に
 * 画面遷移やリロードをすると未送信分が失われるバグがあった。
 *
 * ここではレコードIDごとに「最新の状態1件」だけを保持し、
 * 送信中でなければ即送信・送信中なら完了後に最新版を1回だけ送る
 * （＝待ちは常に最大1件）。モジュールスコープに置くことで、
 * 画面切替でフォームが作り直されても同じキューを共有する。
 */

export interface SaveQueueSnapshot {
  /** 未送信または送信中の保存があるか */
  saving: boolean;
  /** 直近の保存エラー（成功すると自動的にクリア） */
  errorMessage: string;
  /** 直近に保存が成功した時刻（表示用） */
  lastSavedAt: string;
}

const RETRY_DELAY_MS = 4000;

/** まだ送信していない最新レコード（レコードIDごとに1件） */
const pending = new Map<string, EvaluationRecord>();
/** このセッション中に保存操作されたレコードの最新版（取得結果とのマージ用） */
const latestByRecordId = new Map<string, EvaluationRecord>();
let inFlightRecord: EvaluationRecord | null = null;
let lastError: Error | null = null;
let lastSavedAt = '';
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();
let snapshot: SaveQueueSnapshot = { saving: false, errorMessage: '', lastSavedAt: '' };

function refreshSnapshot(): void {
  snapshot = {
    saving: pending.size > 0 || inFlightRecord !== null,
    errorMessage: lastError?.message ?? '',
    lastSavedAt,
  };
  listeners.forEach((listener) => listener());
}

export function subscribeSaveQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSaveQueueSnapshot(): SaveQueueSnapshot {
  return snapshot;
}

export function hasPendingSaves(): boolean {
  return pending.size > 0 || inFlightRecord !== null;
}

/**
 * サーバー取得結果に、ローカルの方が新しいレコードを上書きマージする。
 * 保存が完了しきる前に画面を戻って再取得した場合でも、
 * 採点済みの項目が「未採点」に見えることを防ぐ。
 */
export function mergeWithLocalRecords(fetched: EvaluationRecord[]): EvaluationRecord[] {
  const merged = [...fetched];
  latestByRecordId.forEach((local, id) => {
    const index = merged.findIndex((record) => record.id === id);
    if (index === -1) {
      merged.push(local);
    } else if ((merged[index].updatedAt ?? '') < (local.updatedAt ?? '')) {
      merged[index] = local;
    }
  });
  return merged;
}

export function enqueueSave(record: EvaluationRecord): void {
  pending.set(record.id, record);
  latestByRecordId.set(record.id, record);
  refreshSnapshot();
  drain();
}

function scheduleRetry(): void {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    drain();
  }, RETRY_DELAY_MS);
}

function drain(): void {
  if (inFlightRecord !== null) return;
  const first = pending.entries().next();
  if (first.done) return;
  const [id, record] = first.value;
  pending.delete(id);
  inFlightRecord = record;
  refreshSnapshot();

  apiSaveEvaluation(record)
    .then(() => {
      lastError = null;
      lastSavedAt = new Date().toLocaleString();
    })
    .catch((err) => {
      console.error(err);
      lastError = err instanceof Error ? err : new Error('保存に失敗しました。通信状態を確認してください。');
      // 失敗した保存は破棄せず後で再送する（より新しい版が積まれていればそちらを優先）
      if (!pending.has(id)) {
        pending.set(id, record);
      }
      scheduleRetry();
    })
    .finally(() => {
      inFlightRecord = null;
      refreshSnapshot();
      if (pending.size > 0 && retryTimer === null) {
        drain();
      }
    });
}

// 未保存データがある間はリロード・タブを閉じる操作に確認ダイアログを出す
window.addEventListener('beforeunload', (event) => {
  if (hasPendingSaves()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
