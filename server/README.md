# 公開サーバーステータス

NetdataのダッシュボードやAPIをポートフォリオから直接参照せず、必要な4項目だけを静的JSONとして公開します。

## 構成

- `status-collector.py`: localhost上のNetdataから固定したチャートだけを取得
- `test-status-collector.py`: 値の変換ロジックを検証
- `apache-status-cache.conf`: ブラウザとCloudflareにキャッシュ禁止を明示
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
- 公開JSONに`Cache-Control: no-store`と`Cloudflare-CDN-Cache-Control: no-store`を付ける
- collectorは1秒ごとに更新し、画面側は表示中のサーバー欄だけを1秒ごとに取得する

## ロールアウト

既存のComposeファイルと同じディレクトリへ、このoverride、コレクター、Apache用設定を配置します。Apacheの公開ディレクトリには`api`ディレクトリが必要です。`httpd.conf`では`mod_headers`を読み込み、追加設定をIncludeします。

```apache
LoadModule headers_module modules/mod_headers.so
Include conf/extra/server-status-cache.conf
```

```bash
docker compose up -d status-collector apache
docker compose logs --tail=20 status-collector
curl -fsS http://127.0.0.1/api/server-status.json
curl -I http://127.0.0.1/api/server-status.json
```

1秒更新では、collectorがlocalhostのNetdataへ毎秒4リクエストを送り、約134バイトのJSONを毎秒1回置き換えます。成功ログは最大1分に1回、Netdata停止中は5秒間隔へ落とします。ブラウザ側はタブが表示中で、サーバー欄が画面付近にある間だけ取得します。

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

## Discord Botステータス

`bot-status-collector.py`は各Botの専用ディレクトリを読み取り、`/api/bot-status.json`へ公開用スナップショットを書き出します。コンテナにはネットワークとDockerソケットを渡しません。

### 初回準備

Botを起動する前に、ホスト上へ専用ディレクトリを作成します。

```bash
sudo install -d -o 1000 -g 1000 -m 0750 \
  /home/natuki/services/runtime-status/timecard \
  /home/natuki/services/runtime-status/voicevox-tts \
  /home/natuki/services/runtime-status/youtube
```

各BotのCompose設定は、自分のディレクトリだけを`/run/bot-status`へ書き込み可能でマウントします。Botを再作成してハートビートが生成されたことを確認してから、公開コレクターを起動します。

```bash
docker compose up -d bot-status-collector apache
docker compose logs --tail=20 bot-status-collector
curl -fsS http://127.0.0.1/api/bot-status.json
curl -I http://127.0.0.1/api/bot-status.json
```

ハートビートが35秒を超えると`offline`、Discord未接続またはVOICEVOX Engine停止時は`degraded`、入力欠損や不正スキーマは`unknown`になります。

### ロールバック

```bash
docker compose stop bot-status-collector
```

公開JSONが更新されなくても、フロントエンドは古いデータまたは取得不可として表示し、ポートフォリオ本体は継続して表示します。

## 将来の管理機能で守る境界

初期版の公開APIには操作機能を追加しません。管理機能を実装する段階では、
`/admin/*`と`/api/admin/*`をCloudflare Accessで保護し、API側でも
`Cf-Access-Jwt-Assertion`の署名、issuer、audience、有効期限、管理者メールを
検証します。

管理APIへDockerソケットはマウントしません。ホスト上のUnixソケット型ブローカーが
固定Bot IDに対する`start`、`restart`、`stop`だけを受け付ける構成とし、任意コマンド、
SSH、ファイル操作、ホスト再起動・停止は許可しません。変更操作には同一オリジン検証、
CSRF対策、リクエストID、Bot単位の排他制御、90日保持の監査ログを必須とします。

## 公開Webアプリの外形監視

`web-app-status-collector.py`は、固定した公開URLのHTTP応答を30秒ごとに確認し、
`/api/web-app-status.json`へ応答状態、HTTPステータス、応答時間、最終確認日時だけを
書き出します。現在の対象はNearEatsとYorimoです。

コレクターはDockerソケットやホストネットワークを持たず、通常のbridgeネットワークから
固定URLへアクセスします。管理画面、テスト環境、データベース、内部APIは監視対象や
公開JSONへ含めません。

```bash
docker compose up -d web-app-status-collector apache
docker compose logs --tail=20 web-app-status-collector
curl -fsS http://127.0.0.1/api/web-app-status.json
```

## 管理者向け管理基盤

### 構成

- `admin-api/`: Cloudflare Access JWT、CSRF、同一オリジンを検証する管理API
- `admin_broker.py`: 固定サービス操作とTimecardの参照・訂正だけを受け付けるホストサービス
- `admin-broker-config.example.json`: 本番Composeとコンテナを固定IDへ割り当てる設定
- `mu-admin-broker.service`: Dockerグループの一般ユーザーで起動するsystemdユニット

管理APIコンテナにはDockerソケットとTimecard DBを渡しません。ブローカーは署名付きの
Unixソケット要求だけを受け、設定に存在しないサービス、アクション、引数を拒否します。

### Cloudflare Access

同じSelf-hosted Accessアプリケーションへ次の2パスを登録します。

- `mu-natuki.com/admin/*`
- `mu-natuki.com/api/admin/*`

Allowポリシーは管理者メール1件だけとし、認証方式はOne-time PINを使用します。
Accessを有効にして未認証ブラウザが両パスへ到達できないことを確認してから
管理画面を公開してください。

API側では次の値を秘密設定として使用します。

- `ADMIN_CF_TEAM_DOMAIN`: `https://<team>.cloudflareaccess.com`
- `ADMIN_CF_POLICY_AUD`: AccessアプリケーションのAUDタグ
- `ADMIN_ALLOWED_EMAIL`: OTPを受け取る管理者メール
- `ADMIN_CSRF_SECRET`: 32文字以上のランダム値
- `ADMIN_BROKER_SHARED_SECRET`: APIとブローカーだけが持つ別のランダム値

### ホスト側の準備

サーバー上で設定例をコピーし、秘密値をGit管理外で作成します。

```bash
install -d -m 0750 /home/natuki/services/admin-runtime
cp server-status/admin-broker-config.example.json \
  /home/natuki/services/admin-runtime/broker.json
cp server-status/admin.env.example .admin.env
chmod 0600 .admin.env
```

`/home/natuki/services/admin-runtime/broker.env`には次の1行だけを保存します。

```dotenv
ADMIN_BROKER_SHARED_SECRET=<.admin.envと同じランダム値>
```

systemdユニットを配置して起動します。

```bash
sudo install -m 0644 server-status/mu-admin-broker.service \
  /etc/systemd/system/mu-admin-broker.service
sudo systemctl daemon-reload
sudo systemctl enable --now mu-admin-broker.service
```

最後に管理APIとApacheを起動します。

```bash
docker compose -f docker-compose.yml \
  -f server-status/docker-compose.override.yml \
  up -d --build admin-api apache
```

JWTヘッダーを持たないローカル通信が拒否されることを確認します。

```bash
curl -i http://127.0.0.1/api/admin/v1/session
```

期待結果は`403`です。`200`になる場合は公開しないでください。

### データと監査

Timecardの完了済み勤務を訂正すると、元の値と訂正後の値を
`db/admin_audit.db`へ同一SQLiteトランザクションで保存します。勤務時間はAPI入力を
信用せず、開始・終了・休憩からブローカーが再計算します。

サービス操作ログは90日保持します。勤怠訂正履歴は勤務データと同期間保持します。
公開JSONへ管理情報、Discord ID、氏名、コンテナ名、監査ログは追加しません。
