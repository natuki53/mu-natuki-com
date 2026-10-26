# 自宅サーバー管理画面

`/admin/` は、サーバー・サービス・ログ・バックアップ・GitHub Actionsを確認する管理画面。
既存の勤怠管理、固定サービスの保守操作、操作履歴を同じ画面から利用する。

## ローカル確認

ローカル確認用APIは `127.0.0.1:18765` のみにbindし、毎回メモリ上にサンプルデータを生成する。
本番の設定、DB、SSH、Dockerソケット、GitHubのトークンを読み込まない。
画面には常に「ローカル検証 / SAMPLE DATA」と表示する。
正常、バックアップ失敗、HDD未接続、容量不足、監視通信停止、サービス異常、CI失敗、CI待機中、CI未稼働を選択できる。
サービス操作と勤怠訂正は拒否する。ローカルの認証省略は専用起動スクリプトのみに設定し、本番起動には流用しない。

リポジトリのルートで実行する。Python 3.12以降を使う。

```powershell
python -m venv .local/venv
.local/venv/Scripts/python -m pip install -r server/admin-api/requirements.txt -r server/admin-api/requirements-test.txt -r server/requirements-monitoring.txt
npm ci
.local/venv/Scripts/python server/local-monitoring.py
```

別のターミナルで起動する。

```powershell
npm run dev:monitoring
```

`http://127.0.0.1:4178/admin/` を開く。停止は各ターミナルでCtrl+C。
このVite設定は `/api/admin/` と公開ステータスJSONの接続先をloopbackへ固定する。
通常の `npm run dev` の公開ステータス取得先とは異なる。

## ローカルで実データを読む

`local_live_monitoring.py` は、本番へCollectorを配置せず、ローカルPCからSSHの読み取りとGitHub APIのGETを行う。
既存のSSH鍵・known_hostsと、`gh auth login` の資格情報保管を利用する。トークンを取り出したり設定ファイルへ保存したりしない。
`server/local-live.example.json` をGit管理外の `.local/live-monitoring.json` にコピーし、確認済みのホスト・runnerラベル・対象リポジトリを指定する。
`directRunnerNames` はホスト上で確認できた直接稼働runner、`machineRunners` はVM名とGitHub runner名の対応を表す。

サンプルAPIを停止してから、次のコマンドで実データ用APIを起動する。Viteは同じポートのまま利用できる。

```powershell
.local/venv/Scripts/python server/local_live_monitoring.py --config .local/live-monitoring.json
```

- APIは `127.0.0.1:18765` に限定し、許可したlocalhostのHost/Origin以外と、GET/HEAD/OPTIONS以外を拒否する。
- ディスク・CPU・メモリ・VM状態とサービス・ログ・バックアップ処理状態を約30秒間隔、GitHubのrun/job/runnerを約60秒間隔で読む。世代一覧とディレクトリ使用量は5分間隔。画面取得は5秒、ログ画面は2秒間隔。
- CIは直近15件に加えて、実行中・待機中の各状態を100件まで照合する。前回実行中だったrunは履歴の範囲外へ移っても完了まで追跡する。取得上限を超えた場合は完全な一覧として扱わず取得不能を示す。
- SSHでは `remote_host_probe.py` を標準入力で `python3 -B -` へ渡す。サーバーへのファイル配置・パッケージ導入・サービスやVMの変更は行わない。
- GitHubの接続ツールに継続ポーリング用runner一覧がないため、このローカルプロセスでは既存の `gh` セッションから固定の読み取りAPIを呼ぶ。
- 上限表示は「登録runner枠」。GitHubの実登録数をホストラベル・確認済み対応から数え、CPU数や存在するVM数から推測しない。未登録のVMは枠に含めない。
- サーバー全体の追加制限は別項目で未確認とする。専用runnerは用途を明示し、空き枠があっても全ジョブを実行できるとは限らない。
- `workflowConstraints` は既定ブランチの取得時刻・ファイルSHA・concurrency groupの確認記録。実行コミットや現在の設定と一致する保証はなく、runner枠とは分けて表示する。
- ホスト設定に `operations` を追加するとサービス・バックアップ・ログを接続できる。勤怠・操作履歴は未接続として無効にし、サンプル値と混ぜない。
- 観測値はプロセスのメモリに保存し、SSH断では前回値と警告、120秒以上経過したホスト情報は更新停止として表示する。runner取得不能時は状態不明とする。

停止はCtrl+C。常駐サービスや自動起動設定を本番へ作成しない。
実データ用APIの起動中は `node tests/admin-live-monitoring.browser.mjs` で表示・定期取得・通信断からの復帰を検証する。
サンプル用のシナリオ切替テストはサンプルAPIへ戻してから実行する。

`operations` は次の読み取り範囲を指定する。設定・実測記録は `.local/` 内に置き、実サーバーの認証情報はそこへコピーしない。

| 設定 | 意味 |
| --- | --- |
| `expectedRunning` | 常時稼働を期待するコンテナ名。停止・削除時に警告する |
| `logTargets` | ログ収集を許可するコンテナ名。環境変数やDocker設定全体は読まない |
| `systemdServices` | 明示したunitの状態とログ。`user: true` はユーザーunit、`logs: true` はjournal収集 |
| `backups` | 既存Collectorと同じバックアップ対象。主保存先は既存configのstorage_root、コピー先は指定rootを読む |

Dockerは停止済みも含めて列挙し、指定外の停止済み検証用コンテナを自動的に故障扱いしない。
ログは指定対象の直近5分・各30行まで、各メッセージ2,000文字、1回最大1,000行・応答約1.8MBに制限する。
サーバー側で既知の認証情報・Cookie・鍵ブロックを伏せてからSSHへ出力し、ローカル保存時にも再処理する。
完全な秘密検出ではないため、元のサービスが機密値を出力しないことが前提。取得失敗と行数上限はログ画面に表示する。
ログはこのローカルプロセスの起動後に収集した範囲のみ。再起動で消え、サーバー上の全履歴や長期保管の代用にはならない。

バックアップ読み取りは `restic --no-lock --no-cache snapshots --json` と `du` のみ。
パスワードはサーバー内の既存ファイルをresticが参照し、内容をローカルへ返さない。
既存のjob/pullロックと、存在する主保存先のrepositoryロックを非待機の共有ロックで確認する。
バックアップ更新・整備と競合した場合は読み取りを諦め、以前の世代と観測時刻を保持する。
世代一覧を読み終えたらロックを解放し、サイズ計測でバックアップ処理を長時間待たせない。
正常世代とpending/未完了は別に数え、未完了世代があることを表示する。監視のためのbackup/check/restore/forget/pruneは実行しない。
コピー側の検証成功は既存success記録を読むものであり、監視画面が新たに全データ検査したことを意味しない。

## 情報の流れ

1. 各Linuxホストの `monitoring_collector.py` が、登録したサービス・保存先と、ホストのディスク一覧を読み取る。
2. 観測データをホスト別HMAC鍵で署名し、管理APIの機械向け受信口へ送る。
3. 管理APIが検証後、専用SQLiteへ現在値・ログ・容量履歴を保存する。
4. 認証されたブラウザは管理APIの保存済み情報を読む。画面表示を契機にrestic検査やSSHを実行しない。

管理画面は5秒、ログ表示中は2秒で取得し、非表示タブでは停止する。
CIのWebhookは受信時に保存され、その次の画面更新で反映する。
SSEによるログ全文のストリーミングではない。

全体状況のCI警告は、ジョブログのエラーにrunner切断・停止、ディスク容量不足／入出力障害、Docker接続失敗の根拠がある場合だけ表示する。テスト・ビルド失敗、一般的な終了コード、時間超過だけではサーバー異常と判定しない。原因を確認できない失敗もCI画面の「失敗」として残す。ログ取得不能・取得範囲外の原因は判定できない。1回の定期照合で最大3ジョブを調査し、取得済み結果をキャッシュする。

サービス警告を押すと対象サーバー・サービスのログを開く。検索文字列と重要度の以前の条件を解除し、7日分の保存ログを表示する。停止・異常のある収集対象は、停止前を含む7日以内の末尾ログを既存の行数上限で取得する。対象未検出、ログ収集未設定、保持期間内にログがない場合は理由と現在の監視結果を表示する。CIのサーバー異常警告からは該当実行を展開し、該当ジョブのログを開く。

接続ディスクはSSD（NVMeを含む）、HDD、USB、光学ドライブの順に表示する。横並びではSSDが左側、狭い画面では上側になる。
ホストの観測が45秒以上古い場合は「更新停止」とし、API自体の通信断も前回値として表示する。

## 収集と保存

| 対象 | 取得元・更新 | 保持・制限 |
| --- | --- | --- |
| ホスト | psutil、findmnt。標準10秒 | 最終観測。温度・SMARTは取得できる場合のみ |
| 全ディスク | lsblkの明示したJSON列。標準10秒 | SSD・HDD・NVMe・USB・光学ドライブ、最大64台・各128領域。シリアル番号は送信しない |
| サービス | 固定対象のDocker State、RestartCount、systemd show | Docker環境変数・設定全体は取得しない |
| ログ | 登録対象で `logs: true` の場合だけ、直近5分・各100行 | 7日、全体最大50,000行、API最大500行/回 |
| バックアップ状態 | success state、systemdのResult・次回timer、Intelのsuccess/failure記録 | 保存成功と直近失敗を併記 |
| 世代と使用容量 | restic snapshotsとdu。標準5分 | 最大5,000世代/リポジトリ。超過は取得不能として明示 |
| 容量予測 | リポジトリの実測使用量を毎時記録 | 90日。最低7日・24観測が必要 |
| GitHub Actions | workflow_run / workflow_jobイベント、標準60秒のAPI照合 | 各リポジトリ最大200 run / job。照合は直近15 run、各100 jobまで |
| CI稼働枠 | runner APIのonline/offline・busy、標準60秒 | 明示したサーバー割り当てと同時実行上限。取得が5分以上古い場合は状態不明 |

ログは既知のトークン、Authorization、password、Cookie、URL内資格情報等を収集時・保存時に除去し、
HTMLとして実行せず文字列として表示する。任意形式の秘密や個人情報を完全に判別できる仕組みではない。
機密情報を出力するサービスではログ取得を無効にするか、元の出力を修正してから有効にする。
高頻度ログは直近100行の範囲を超えると欠落するため、この機能は完全な監査ログ保管の代用ではない。

## ディスク表示

`discoverDisks` は標準で有効。Linuxホスト上の `lsblk --json --bytes --tree` から全ブロックディスクを列挙する。
loop・RAM・zramは一覧から除外し、パーティション・LVM・暗号化・RAIDの論理領域は親ディスクの中に表示する。
共有する論理領域は明示し、物理ディスク間で容量を合算しない。仮想マシン内ではゲストから見えるディスクが対象になる。

本体容量とファイルシステムの使用量・空きを分けて表示する。
未マウントのディスクも表示するが、使用量は「未取得」とする。マウント・フォーマット・ディスクへの書き込みは行わない。
必要なlsblk列が利用できない場合や取得に失敗した場合は、ディスクが0台とはせず取得不能を表示する。
指定保存先のUUID・SMART確認は、全ディスク一覧とは別に表示する。

## バックアップの意味

- `complete` を持ち `pending` を持たない世代だけを正常世代として数える。
- DB・全体の保持設定と実数は別々に表示する。日次・週次・月次は和集合であり単純加算しない。
- DBは毎時、全体は日次・週次・月次の保持枠を表示する。保持設定は30秒間隔の軽量取得でも更新し、世代一覧の観測時刻とは分ける。
- 保存成功、構造検査、全データ読込検査、復元試験は別の記録。
- 主保存先の次回予定は有効なsystemd timerから取得し、月次の全データ検査も独立した行で表示する。停止中・処理完了待ち・取得不能を日時に置き換えない。
- 最新2世代コピーの整合性検査は「新しい世代のコピー時」、手動の復元試験と固定退避保管庫の検証は「手動実行（予定なし）」と表示する。予定のない処理に日時を推測して補わない。
- `verificationScript` と `verificationConfigFile` が設定されている対象は、インストール済み検証スクリプトの読み取り専用 `status` から、実際のcron設定と検証記録に基づく次回日時を取得する。週次・月次の定期処理、取りこぼし後の日次再試行、停止中を区別する。
- 検証スクリプトが返すリポジトリと対象が一致しない場合や読み取り失敗時は、古い予定を表示し続けず「予定を取得できません」とする。前回成功と直近失敗は別々に保持する。
- 復元試験の対象IDを表示する。古い世代の成功を最新世代の復元成功に読み替えない。
- Intelの最新世代は、主保存先のIDとコピーの元IDを照合する。日時が同じだけでは一致扱いにしない。
- 主保存先は `configFile` の `storage_root` を読むため、保存先の移行に追従できる。
- HDDを必須にする場合、`disk.mountpoint` と `disk.expectedUuid` を設定する。不一致ならresticを読まず異常とする。
- restic参照時は既存のバックアップ排他ファイルを共有ロックする。整備中は正常と決めつけず取得不能として表示する。
- Collectorは `init`、`backup`、`forget`、`prune`、`restore` を実行しない。HDDへの移行やIntelの保持変更も実行しない。

Intel側の設定例は次の通り。保持設定は**実際に導入したルール**に合わせる。
現在の追記コピーのままなら `retention` を空にし、最新1世代方式へ移行した後に `{"full":1,"db":1}` を設定する。

```json
{
  "id": "vrnavi",
  "name": "ぶいなび 独立コピー",
  "role": "secondary",
  "root": "/home/backup/vrnavi-backup-secondary",
  "resticBinary": "/home/backup/vrnavi-backup-secondary/bin/restic",
  "retention": {}
}
```

容量の推定は増加量の平均に基づく参考値。ほかのサービスによるディスク消費や、将来の世代整理による減少は予測しない。
保存先を変更した場合は新しい容量履歴として扱う。

## 認証とAPI

| パス | 認証 |
| --- | --- |
| `/api/admin/v1/monitoring` | 既存のCloudflare Access JWTを検証 |
| `/api/admin/v1/monitoring/logs` | 同上。host/service/level/since/q、ページカーソル対応 |
| `/api/admin/v1/monitoring/ci/logs` | 同上。登録リポジトリだけを読み取り |
| `/internal/monitoring/v1/hosts/{hostId}` | ホスト別HMAC署名、時刻5分以内、hostId照合、古い観測の拒否 |
| `/monitoring-hooks/github/actions` (API内部 `/hooks/github/actions`) | GitHubのHMAC-SHA256署名、対象リポジトリ、イベント種別、delivery ID重複排除 |

機械向け受信口は管理者用JWTを流用しない。Collector受信口はLAN内のTLS終端など、管理ネットワークからだけ到達させる。
GitHubのWebhook受信口は専用パスへ転送し、署名検証を必須にする。管理API全体のAccess保護を外して通してはいけない。
受信上限は2MB。GETレスポンスを共有キャッシュや公開ステータスJSONへ混ぜない。
データベースと鍵は公開ディレクトリ外に置き、専用UID、ディレクトリ0700・鍵0600を設定する。

## GitHub接続

`monitoring.example.json` の `github.repositories` に対象を明示する。
`tokenFile` は対象リポジトリのActions読み取り権限を持つfine-grained token、または外部で更新するGitHub App installation tokenのファイル。
ブラウザへトークンや署名付きダウンロードURLを返さない。API照合は直列化し、ETagとレート制限待機に対応する。
`includeRunners: true` には別途repository Administrationのread権限が必要。
サーバーごとの `github.runnerHosts.<hostId>` に、実際の `runnerNames` と `maxJobs` を設定する。
`maxJobs` はそのサーバーに導入済みの同時実行上限を表す。画面の設定だけでGitHubの実行数を制限する機能ではない。
未確認の上限は `null` のままにし、runner数やCPU数から推測しない。サンプル画面のRyzen 2枠・Intel 1枠は検証用。

| 表示 | 判定 |
| --- | --- |
| 稼働中 | 最新のrunner情報がonlineかつbusy |
| 上限まで稼働 | 稼働数が設定上限以上。上限超過時は注意も表示 |
| 未稼働（待機中） | onlineかつbusyではない。新しいジョブを受け付け可能 |
| 未稼働（オフライン） | offlineを取得。ジョブを受け付けられない |
| 状態不明 | 未受信、権限不足、通信失敗、5分以上前の情報、runner名の識別が曖昧な場合 |
| 上限・runner未設定 | 対象runner名または有効な上限が未設定 |

空き枠は「待機runner数」と「上限から稼働数を引いた値」の小さい方（下限0）。
オフラインのrunnerは空き枠に数えない。どれかのrunnerの状態が不明な場合や上限が未設定の場合は「—」とする。
GitHub APIの同一runner IDが複数リポジトリに現れても重複集計しない。同名でIDが異なる場合は状態不明として設定確認を促す。
runner名は監視するリポジトリを通じて取得可能な名前を使い、複数サーバーに重複割り当てしない。
画面はサーバー別稼働枠、実行中、実行待ち・保留、完了履歴の順に表示し、履歴の開閉は自動更新後も維持する。
待機枠は特定ジョブの実行保証ではなく、ジョブのラベル・実行条件・ワークフローのconcurrency制限も別途適用される。

ジョブ本文はGitHubのダウンロードAPIで取得可能な場合だけ表示し、8,000文字で表示を制限する。
完全なライブログ配信は保証せず、取得不能時はGitHubの実行ページへ移動できる。

## 導入手順

具体的な配置・ローカル再現検証・切り戻しは [本番導入手順](monitoring-deployment.md) を参照する。

この手順はローカル検証後の別工程であり、ローカル起動だけでは本番へ導入されない。

1. 既存管理画面・Timecard移設の変更を含めたコードの基準を確定する。
2. 各ホストのサービスID、実コンテナ・unit、ログ対象、バックアップ設定、HDD UUIDを読み取り確認する。
3. `monitoring.example.json` と `monitoring-collector.example.json` を非公開の運用ディレクトリへ配置し、鍵・URL・パスを設定する。
4. 管理APIへ `ADMIN_MONITOR_CONFIG` を渡す。設定と鍵の読み取り専用マウント、SQLite用の専用書き込み可能マウントを追加する。Dockerソケットは管理APIへ追加しない。
5. Collectorはサービス状態・指定ログ・バックアップを読む権限だけを持つホストプロセスとして起動する。Dockerグループ権限は強いため、利用者と対象ホストを限定する。
6. 初回は単発収集を確認してから常駐させる。systemdの自動起動、再起動、監視期限を設定する。既存バックアップtimerとは独立させる。
7. 管理パスの未認証拒否、Collectorのホスト偽装拒否、GitHubの署名検証、ログ除去、データ更新停止の表示を確認する。
8. Webhookを登録し、実CIの開始・ステップ・終了が反映されることを確認する。
9. サービス・Collector・HDDの停止ケース、既存勤怠・保守操作の回帰確認後に運用へ移す。

本番用ComposeやCloudflare設定は自動変更しない。導入前に反映対象と切り戻し手順を確認する。
管理基盤のIntel機が停止すると管理画面も停止する。ホスト自体の停止検知には別の外部監視が必要。

## 検証

```powershell
npm test
npm run build
.local/venv/Scripts/python server/run-tests.py
docker build -f server/Dockerfile.monitoring-test -t mu-home-monitor:local-test server
docker run --rm --network none mu-home-monitor:local-test
```

WindowsではUnixソケットを使う既存ブローカー／Timecard中継テストを上記Pythonコマンドから除外し、Linuxコンテナで実行する。
ローカル確認用APIとViteを起動した状態で `npm run test:monitoring:browser` を実行すると、
320〜3840pxの10画面幅×8タブ、右余白、ディスク一覧、CIの稼働・待機・オフライン・不明、
異常シナリオ、世代ページ、ログ除去、通信断と復帰、テーマ・言語切り替えをブラウザで検証する。
WindowsではChromeを使用する。Linuxでは事前に `npx playwright install --with-deps chromium` を実行する。
スクリーンショットと結果はGit管理外の `.local/browser-verification/` に保存する。

Linuxテストはネットワークなしのコンテナ内に合成resticリポジトリを作成し、正常／pending世代の取得と、
参照前後の暗号化リポジトリファイルのSHA-256一致を確認する。
元のバックアップや既存Dockerサービスはマウントしない。
APIテストはJWT拒否、署名、重複・時系列逆転、ログ除去、容量、期限、復元対象ID、GitHub再実行を確認する。
ローカル実データ接続は対象ホストとGitHubへの読み取りを確認する。本番へのCollector配置・常駐権限・SMART取得・Cloudflare経由通信は別途導入時の確認項目。

## 公式資料

- [GitHub Webhook署名](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [GitHub Actions job API](https://docs.github.com/en/rest/actions/workflow-jobs)
- [GitHub runner API](https://docs.github.com/en/rest/actions/self-hosted-runners)
- [lsblkの列とツリー構造](https://man7.org/linux/man-pages/man8/lsblk.8.html)
- [GitHub APIの利用方法](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [Cloudflare Access JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

静かなサービスの以前のログも確認する場合は、収集設定の `collectRetainedLogs` を有効にして7日以内の末尾ログを取得する。行数・文字数上限と機密値の除去は維持する。`logStatus` で取得失敗・出力なし・未収集を区別する。`transientContainers` に指定した一時実行用コンテナは終了後だけ一覧から除外し、実行中は表示する。
