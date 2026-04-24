import { useState } from 'react';
import type { Category } from '../types';

interface Props {
  onImported: (categories: Category[]) => void;
}

function AdminMasterImport({ onImported }: Props) {
  const [status, setStatus] = useState<string>('Excelファイルからマスタを取り込みできます。');
  const [isLoading, setIsLoading] = useState(false);

  const handleImport = async () => {
    setIsLoading(true);
    setStatus('マスタを読み込み中です...');
    try {
      const response = await fetch('/api/master/import');
      const result = await response.json();
      if (result.categories) {
        onImported(result.categories);
        setStatus(`取り込み完了: ${result.categories.length}件のカテゴリ、マニュアル基準Excel ${result.manualLoaded ? '読み込み済み' : 'なし'}`);
      } else {
        setStatus('マスタの取り込みに失敗しました。');
      }
    } catch (error) {
      setStatus('サーバーとの通信に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="card import-card">
      <h3>管理者マスタ取り込み</h3>
      <p className="small-text">Excel 1〜4 のファイルとレベル別のマニュアルExcelからマスタ定義を自動生成します。</p>
      <button type="button" className="primary-button" onClick={handleImport} disabled={isLoading}>
        {isLoading ? '取込中...' : 'Excelから取り込む'}
      </button>
      <p className="small-text">{status}</p>
    </section>
  );
}

export default AdminMasterImport;
