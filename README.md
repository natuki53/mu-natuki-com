# mu-natuki-com

雨苺なつきの活動とプロジェクトを紹介するポートフォリオサイトです。ViteとVanilla JavaScriptで構築し、生成した静的ファイルを自宅サーバーから配信します。

## ローカル開発

```bash
npm ci
npm run dev
```

本番ビルドを確認する場合:

```bash
npm run build
npm run preview
```

## ブランチと配信

- `main`: 本番へ配信するソースコードの基準
- `feat/*`: 機能追加やデザイン変更
- `fix/*`: 不具合修正
- `docs/*`、`chore/*`: 必要に応じて使用

作業ブランチから`main`へPull Requestを作成し、マージ後にGitHub Actionsが`dist`を生成します。自宅サーバーは生成物を公開ディレクトリへ同期します。

`dist`は生成物のため直接編集しません。

## プロジェクト詳細ページ

プロジェクトの本文、実績、画像、リンクは`src/data/projects.js`にまとめています。英語表示は`src/data/english.js`に追加します。

詳細ページは`projects/<project-id>/index.html`、共通の描画処理は`src/scripts/project-detail.js`にあります。プロジェクトを増減した場合は`vite.config.js`のエントリーも更新してください。

## サーバー稼働状況

トップページは、同一オリジンの`/api/server-status.json`から次の固定項目だけを取得します。

- CPU使用率
- メモリ使用率
- ディスク使用率
- 連続稼働時間
- 計測日時と取得状態

NetdataのAPIやダッシュボードをブラウザへ直接公開しません。`server/status-collector.py`がサーバー内部のNetdataから必要な値だけを取得し、約10秒ごとに固定スキーマのJSONへ書き出します。

サーバー側の構成例とテストは`server/`にあります。公開データにはホスト名、コンテナ名、チャート一覧、アラーム、ログなどを含めないでください。
