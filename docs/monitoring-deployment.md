# 管理画面の本番導入と切り戻し

この手順は導入候補をローカルで検証し、本番反映を別工程として行う。ローカルAPIは認証代替を含むため、本番へ配置しない。`server/admin-api` の production イメージを使用し、既存の Cloudflare Access と管理ブローカーを維持する。

## 導入対象

| 対象 | 配置先・役割 |
| --- | --- |
| 画面 | Intel の既存 web 配信ディレクトリ。検証済み dist のみ |
| 管理API | 既存 admin-api。監視設定を読み取り専用で追加し、監視用 SQLite だけ書き込み可能 |
| ホスト収集 | 両ホストの `/home/natuki/services/monitoring/code`。標準Pythonでディスク・VM・サービス・限定ログ・既存バックアップ記録を読む |
| 内部受信 | Intel `192.168.1.10:18443` の TLS。ホスト別HMACで受信。管理APIの閲覧・操作パスは転送しない |
| GitHubイベント | 公開Apacheの `/hooks/github/actions` のみ管理APIへ転送。既存 `/hooks/` デプロイ経路の前に置く |
| 監視データ | `/home/natuki/services/monitoring/state`。公開ディレクトリ外。ログ7日・最大50,000件、容量90日 |

収集周期は30秒、バックアップ全世代一覧・サイズは5分、CI照合は60秒。Webhookで開始・終了を受信し、API照合で取りこぼしを補う。実行中・待機中のワークフローは直近15件に含まれなくても追跡する。100件の取得上限を超えた一覧は正常扱いせず、取得エラーとして表示する。

本番候補には実測時点のrunner名と登録runner数を収める。これはホスト全体の資源上限ではなく、登録済みrunner枠数である。runnerを追加・削除した場合は割り当て設定を更新する。未稼働VMと登録済みrunnerは別に表示する。

## ローカルの復旧・検証

```powershell
./scripts/start-local-monitoring.ps1 -Node <node.exeの絶対パス>
npm test
npm run build
docker build -f server/Dockerfile.monitoring-test -t mu-monitoring-test server
docker run --rm --network none mu-monitoring-test
```

起動スクリプトは既存のポートを強制終了せず、APIの応答・local-live・読み取り専用を確認する。APIとViteは非表示の別プロセスとして起動する。PC再起動後は再実行する。ログは `.local/monitoring-runtime`。

`prepare-monitoring.py` は実データ用設定と、本番から読み取り取得したApache設定を入力し、Git管理外の新規出力先へ候補を作る。秘密鍵・証明書もその出力先だけに保存する。既存出力先へ上書きしない。

```powershell
.local/venv/Scripts/python scripts/prepare-monitoring.py --live-config .local/live-monitoring.json --routing-baseline .local/production-readiness/production-routing-baseline.jsonl --output .local/production-readiness/release
.local/venv/Scripts/python scripts/check-monitoring-release.py .local/production-readiness/release
.local/venv/Scripts/python scripts/probe-monitoring.py --candidate .local/production-readiness/release --output .local/production-readiness/probe
.local/venv/Scripts/python scripts/rehearse-monitoring.py --candidate .local/production-readiness/release --work .local/production-readiness/rehearsal-final
```

probe はSSH標準入力でコードを実行するだけで、リモートへファイルを設置しない。通常のサービス、バックアップ世代、設定を変更しない。rehearse はローカルDockerだけを使用する。APIとテストJWKSは内部ネットワーク内、テスト入口はループバックのみ。テスト用の署名鍵で本番のJWT検証を通し、認証省略モードは使わない。

## 反映前に用意するもの

### GitHubトークンのローカル登録

Fine-grained PATのResource ownerを `natuki53`、対象を `VRCosme-Web`、Repository permissionsを `Actions: Read-only` と `Administration: Read-only` にする。Metadataは基本の読み取り権限を使用する。有効期限は運用方針に合わせて `No expiration` を選ぶ。

PowerShellで次を実行し、`GitHub token` のマスク入力へ貼り付ける。値をコマンド引数、チャット、環境変数に書かない。

```powershell
./scripts/set-monitoring-github-token.ps1
```

スクリプトは現在のWindowsユーザーとSYSTEMだけがアクセスできる一時ファイルを作り、そこへ入力を保存する。そのトークンを使ってGitHubのCI一覧・ジョブ一覧・runner一覧をGETで確認し、成功した場合だけ `release/intel/secrets/github-read-token` として保存してmanifestを更新する。既存トークンは上書きしない。公開・CI起動・Webhook登録・サーバー転送は行わない。

結果はGit管理外の `.local/production-readiness/github-token-validation.json` に保存する。値やHTTP Authorizationヘッダーは記録しない。APIから有効期限が返され、無期限の指定と矛盾する場合は受け付けない。期限ヘッダーがない場合は「APIから報告なし」と記録し、それだけで無期限を証明したとは扱わない。

保存済みの値を表示せず再検証するには `./scripts/set-monitoring-github-token.ps1 -VerifyOnly` を使う。補助処理の単体テストは `.local/venv/Scripts/python -B tests/test_github_token_setup.py -v` で実行できる。

### 本番反映時の確認

- GitHubの対象リポジトリ限定トークン：Actions read、runner一覧を読む Administration read。PCの既存 `gh` 資格情報は書き出さない。値は `intel/secrets/github-read-token` に安全な方法で保存し、表示・コミットしない。トークン追加後に manifest を更新し、`check-monitoring-release.py --require-credentials` を実行する。
- 既存 `.admin.env`、管理APIとブローカーの秘密値は変更せず維持する。Compose overlayで `APP_ENV=production`、`ADMIN_TEST_AUTH_EMAIL` 空欄を固定する。
- `/admin/*` と `/api/admin/*` のAccess保護を維持する。Webhookは専用パスだけ。管理API全体へのBypassは設けない。
- 生成したTLS証明書の期限は `readiness.json` に記録する。期限30日前までにCA・サーバー証明書を再発行し、両CollectorのCAとIntelの証明書を交換する。CA秘密鍵は生成後に保存しない。
- `wpstg-db` / `wpstg-wp` は現環境で見つからず警告になる。期待稼働リストから消して警告を隠すことはしていない。廃止対象なら、その判断に基づいて監視設定だけを修正する。

## 承認後の導入順序

1. Gitの変更範囲を確定し、検証済みソースをコミットする。PR検証成功後に反映する。既存dist発行ワークフローには検証の依存関係があるため、mainへのpushは公開につながる操作として扱う。候補manifestとテスト結果を保存する。
2. 本番の `apache/httpd.conf` と `server-status/apache-status-cache.conf` を `baseline.json` と比較する。差異があれば停止し、現行設定から候補を再作成する。現在の `web`、管理APIイメージID、admin-apiソース、Compose、Apache設定を非公開の切り戻し用ディレクトリへ保存する。`.admin.env` とブローカーは置き換えない。
3. 両ホストへ候補の `code` / `config` / `secrets` を配置する。所有者UID/GID 1000、ディレクトリ0700、設定・秘密0600を適用する。IntelのTLS、stateも同様に配置する。stateはUID1000で作り、APIから書き込めることを確認する。秘密を含む候補は公開webへコピーしない。
4. 管理APIコードだけを `server-status/admin-api` に配置する。検証時に保存した `admin-api-image.tar` をロードし、`image.json` のSHA-256・イメージIDと照合する。依存関係を本番で再解決せず、検証済みイメージを使用する。overlayを既存Composeに追加し、`docker compose ... config --quiet` で検査する。`config` 全文は環境変数の秘密値を展開するため表示・保存しない。APIへのDockerソケット追加は不要。
5. digest固定のnginxイメージを取得し、admin-api と monitoring-ingest のみを `up -d --no-build --pull never` で起動する。収集先のTLS証明書は配置済みCAで検証し、`curl -k` を使わない。18443番の到達性を確認し、必要な場合だけRyzen→Intelの通信を許可する。インターネット向けのポート転送やTunnelルートは追加しない。
6. 両ホストで Collector を `--once` 実行して署名付き受信を確認する。systemd unitを配置し、構文確認・daemon-reload・enable/startを行う。unitのユーザーは既存のnatuki。`NoNewPrivileges=false` は `crontab -l` のsetgid読み取りに必要で、trueだと両ホストで次回予定を取得できないことを確認済み。読み取り専用ファイルシステム・CPU/メモリ制限は維持する。Ryzenの既存user timer参照には既存のuser busを使用する。
7. Apacheの候補設定と追加Includeを配置し、`httpd -t` 成功後にApacheだけ再読み込みする。既存 `/hooks/` の転送を維持する。`/internal/` は公開Apacheで403、署名なしWebhookは403を確認する。
8. GitHubで専用Webhookを登録する。URLは `https://mu-natuki.com/hooks/github/actions`、Content-Type application/json、SSL検証有効、workflow_run / workflow_jobのみ。候補のWebhook秘密を安全に設定する。既存のデプロイWebhookは変更しない。
9. 画面を反映し、未認証拒否、管理者ログイン、2ホスト・全ディスク・3保存先・次回予定・CI・ログを確認する。既存の勤怠表示・CSV・操作履歴も確認する。実勤怠の訂正やサービス再起動を動作確認目的で実行しない。
10. 収集を一時停止する場合は新規Collectorだけを対象とし、古い情報・復帰表示を確認する。バックアップtimer、復元試験、既存サービスは止めない。受信が継続してから導入完了とする。

## 切り戻し

1. 新規Collectorを両ホストで停止し、今回追加したWebhookだけを無効にする。
2. 旧webと管理APIソース／イメージを復元する。旧Compose構成・Apache設定へ戻し、構文確認後に admin-api と Apache だけを更新する。
3. monitoring-ingestだけ停止する。既存Composeプロジェクト全体の `down` は実行しない。
4. 監視SQLite・設定・秘密・テスト記録は保管し、切り戻し中に削除しない。バックアップリポジトリや世代、既存ブローカー／Timecard DBは変更しない。
5. 既存管理画面、勤怠、公開ページ、既存デプロイ経路を確認する。

## 検証の境界

ローカルの署名検証・Apacheルーティング・TLS受信・SQLite再起動保持・合成Timecardテストと、実サーバーでの読み取り収集を検証する。本番Cloudflareログイン、実Webhook配送、新規サービスの本番起動・再起動、配信後の表示は反映時に確認する。ローカル成功を本番導入済みとは扱わない。

認証の根拠は [CloudflareのJWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、転送の指定は [Apache ProxyPassMatch](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxypassmatch) を参照する。
