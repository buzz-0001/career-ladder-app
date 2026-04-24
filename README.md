# キャリアラダー進捗可視化アプリ

## 概要

このアプリは、従業員のキャリアラダー評価を入力・保存し、レーダーチャート・折れ線グラフで可視化し、AI要約を生成するWebアプリです。

## 構成

- `src/`: React + TypeScript フロントエンド
- `server/`: AI要約用のExpressバックエンド
- `requirements.md`: 要件定義

## 実行方法

1. 依存関係をインストール

```bash
npm install
```

2. 環境変数を設定

`.env.example` をコピーして `./.env` を作成し、`OPENAI_API_KEY` を設定します。

3. 開発サーバーを起動

```bash
npm run dev
```

4. ブラウザで `http://localhost:5173` を開きます

## APIについて

`/api/summary` に評価データを送信して要約を生成します。OpenAI APIキーが設定されていない場合は、プレースホルダーのメッセージを返します。
