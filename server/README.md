# 公開サーバーステータス

NetdataのダッシュボードやAPIをポートフォリオから直接参照せず、必要な4項目だけを静的JSONとして公開します。

## 構成

- `status-collector.py`: localhost上のNetdataから固定したチャートだけを取得
- `test-status-collector.py`: 値の変換ロジックを検証
- `docker-compose.override.yml`: コレクターとApacheの読み取り専用マウント

公開されるキーは次の7つに固定しています。

```json
{
  "version": 1,
  "status": "ok",
  "cpuPct": 0,
  "memoryPct": 0,
  "diskPct": 0,
  "uptimeSeconds": 0,
  "measuredAt": "2026-01-01T00:00:00Z"
}
```

## 受け入れ条件

- `/api/server-status.json`が同一オリジンから取得できる
- CPU、メモリ、ディスクは`0`から`100`の範囲
- Netdata停止時もコレクターは`partial`または`unavailable`を出力する
- JSONにホスト名、コンテナ名、IPアドレス、アラーム、ログ、チャート一覧を含めない
- Netdataの公開URLをポートフォリオへ掲載しない

## ロールアウト

既存のComposeファイルと同じディレクトリへ、このoverrideとコレクターを配置します。Apacheの公開ディレクトリには`api`ディレクトリが必要です。

```bash
docker compose up -d status-collector apache
docker compose logs --tail=20 status-collector
curl -fsS http://127.0.0.1/api/server-status.json
```

## Netdata側の防御

公開JSONを追加しても、Netdata自体が公開されたままでは安全になりません。

1. Netdataの`bind to`を`127.0.0.1`と`::1`だけに限定する
2. Cloudflare Tunnelの公開ホスト名を削除するか、Cloudflare Accessで本人だけに限定する
3. ファイアウォールでTCP 19999への外部接続を拒否する

これらはroot権限またはCloudflare Zero Trustのポリシー変更が必要です。

## ロールバック

```bash
docker compose stop status-collector
```

Apacheから`./server-status/data:/usr/local/apache2/htdocs/api:ro`のマウントを外し、Apacheだけを再作成します。フロントエンドは取得失敗を「現在値を取得できませんでした」と表示するため、監視データがなくてもポートフォリオ本体は表示できます。
