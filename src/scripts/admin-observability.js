import { renderAdminIcons } from './admin-icons.js';
import { renderDiskInventory } from './admin-storage.js';
import { renderCIContent } from './admin-ci.js';
import { backupScheduleText, backupRetentionText } from './admin-backup.js';

const text = (ja, en) => document.documentElement.lang === 'en' ? en : ja;
const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export const formatBytes = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Math.max(0, Number(value));
  const i = n ? Math.min(4, Math.floor(Math.log(n) / Math.log(1024))) : 0;
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][i]}`;
};
export const safeGithubUrl = (repo, id) => /^[\w.-]+\/[\w.-]+$/.test(repo || '') && Number.isSafeInteger(Number(id)) && Number(id) > 0
  ? `https://github.com/${repo}/actions/runs/${id}` : null;
const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '—';
const pct = (value) => value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
const labels = {
  fresh: ['受信中', 'Live'], stale: ['更新停止', 'Stale'], unknown: ['未確認', 'Unknown'], unconfigured: ['未設定', 'Not configured'],
  running: ['稼働中', 'Running'], stopped: ['停止中', 'Stopped'], failed: ['失敗', 'Failed'], restarting: ['再起動中', 'Restarting'],
  healthy: ['正常', 'Healthy'], unhealthy: ['異常', 'Unhealthy'], starting: ['起動中', 'Starting'], error: ['異常', 'Error'], warning: ['要確認', 'Warning'],
  ok: ['正常', 'OK'], idle: ['待機', 'Idle'], queued: ['実行待ち', 'Queued'], in_progress: ['実行中', 'In progress'], waiting: ['待機中', 'Waiting'],
  success: ['成功', 'Success'], failure: ['失敗', 'Failure'], timed_out: ['時間超過', 'Timed out'], completed: ['完了', 'Completed'],
  cancelled: ['中止', 'Cancelled'], skipped: ['スキップ', 'Skipped'], action_required: ['対応待ち', 'Action required'],
  full: ['全体', 'Full'], db: ['DB', 'DB'], copy: ['独立コピー', 'Copy'], check: ['整合性検査', 'Integrity check'], restore: ['復元試験', 'Restore test'], retention: ['世代整理', 'Retention'],
  'deep-check': ['全データ検査', 'Full data check'],
};
const label = (value) => labels[value] ? text(...labels[value]) : String(value || '—');
const badge = (value) => `<span class="ops-badge" data-state="${esc(value)}"><span aria-hidden="true"></span>${esc(label(value))}</span>`;
const metric = (title, value, detail = '') => `<div class="ops-metric"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
const empty = (message = text('まだ情報がありません。接続設定と最終取得時刻を確認してください。', 'No observations yet. Check the connection and last update.')) => `<p class="ops-empty">${esc(message)}</p>`;
const heading = (eyebrow, title, subtitle = '') => `<div class="ops-section-heading"><div><p class="ops-eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button type="button" class="admin-button admin-button-secondary" data-ops-refresh><i data-lucide="refresh-cw" aria-hidden="true"></i>${text('更新', 'Refresh')}</button></div>`;
const tabs = ['overview', 'hosts', 'services', 'backups', 'logs', 'ci'];
const renderReplication = (backup) => !backup.replication ? '' : `<div class="ops-note"><strong>${text('Ryzenとの比較', 'Compared with Ryzen')}</strong>${backup.replication.map((r) => `<p>${esc(label(r.kind))}: ${r.state==='current' ? text('最新の保存元IDと一致', 'Matches the latest source snapshot ID') : r.state==='behind' ? text(`保存時点の差：約${Math.round(r.lagSeconds/60)}分`, `Capture time lag: approximately ${Math.round(r.lagSeconds/60)} min`) : text('同一世代か未確認', 'Snapshot correspondence unverified')} · <code>${esc(r.copiedSnapshotId?.slice(0,8)||'—')}</code></p>`).join('')}</div>`;

export function createObservability({ request, openTab }) {
  let data = null, active = 'overview', timer = null, pending = null, initialized = false, failed = false;
  let paused = false, cursor = null, nextCursor = null;
  const backupPages = new Map();
  const filters = { host: '', service: '', level: '', period: '60', q: '' };
  const serviceFilters = { host: '', state: '' };
  const byId = (id) => document.getElementById(id);
  const root = (tab) => byId(`ops-${tab}`);

  function setConnection() {
    const target = byId('ops-connection');
    if (!target) return;
    target.innerHTML = `${badge(failed ? 'stale' : data ? 'fresh' : 'unknown')}<span>${failed ? text('管理APIへ接続できません。表示は前回の取得値です。', 'API unavailable. Showing previous observations.') : `${text('画面更新', 'Updated')} ${date(data?.generatedAt)} JST`}</span>`;
  }

  function renderOverview() {
    const alerts = data.alerts;
    const serviceConnected = !data.collectionScope || data.collectionScope.includes('services');
    const backupConnected = !data.collectionScope || data.collectionScope.includes('backups');
    const services = data.hosts.flatMap((h) => h.services);
    const live = data.hosts.filter((h) => h.freshness === 'fresh').length;
    root('overview').innerHTML = heading('HOME OPERATIONS', text('自宅サーバーの全体状況', 'Home server overview'), text('異常から詳細へ。保存と検証の状況を、ここで確認できます。', 'Follow issues to their source. Check services, backups and verification.')) +
      `<div class="ops-hero-status" data-state="${alerts.length ? 'warning' : live === data.hosts.length && live ? 'ok' : 'unknown'}"><div><span class="ops-eyebrow">${text('いまの状態', 'CURRENT STATUS')}</span><h3>${alerts.length ? text(`${alerts.length}件の確認が必要です`, `${alerts.length} items need attention`) : live ? text('受信中の監視項目に異常はありません', 'No issues in current observations') : text('監視データの受信を待っています', 'Waiting for observations')}</h3><p>${text('情報が届かない場合は「未確認」「更新停止」として表示します。', 'Missing and stale observations remain explicitly marked.')}</p></div><div class="ops-live-count"><strong>${live}<small> / ${data.hosts.length}</small></strong><span>${text('接続中のサーバー', 'hosts reporting')}</span></div></div>` +
      `<div class="ops-metrics-grid">${metric(text('監視サービス', 'Monitored services'), serviceConnected ? services.length : '—', !serviceConnected ? text('未接続', 'Not connected') : text('登録した対象の状態を収集', 'Explicitly registered targets'))}${metric(text('バックアップ保存先', 'Backup repositories'), backupConnected ? data.backups.length : '—', !backupConnected ? text('未接続', 'Not connected') : text('RyzenとIntelを個別に確認', 'Primary and secondary independently'))}${metric(text('実行中・待機中のCI', 'Active / queued CI runs'), data.ci.state === 'fresh' ? data.ci.runs.filter((r) => r.status !== 'completed').length : '—', label(data.ci.state))}</div>` +
      `<div class="ops-card"><div class="ops-card-title"><h3>${text('対応が必要な項目', 'Needs attention')}</h3><span>${alerts.length}</span></div>${alerts.length ? `<div class="ops-alerts">${alerts.slice(0,30).map((a) => `<button type="button" class="ops-alert" data-ops-tab="${esc(a.tab)}" data-host="${esc(a.hostId || '')}" data-service="${esc(a.serviceId || '')}">${badge(a.severity)}<span>${esc(text(a.message,a.messageEn))}</span><i data-lucide="arrow-up-right" aria-hidden="true"></i></button>`).join('')}</div>` : empty(text('現在の収集範囲では、対応が必要な項目はありません。', 'No actionable items in the current collection scope.'))}</div>` +
      `<div class="ops-two-columns">${data.hosts.map((h) => `<button class="ops-card ops-host-shortcut" type="button" data-ops-tab="hosts"><div class="ops-card-title"><h3>${esc(h.name)}</h3>${badge(h.freshness)}</div><div class="ops-metrics-grid">${metric('CPU', pct(h.cpuPct))}${metric(text('メモリ', 'Memory'), pct(h.memoryPct))}</div><p class="ops-meta">${text('最終観測', 'Observed')} ${date(h.measuredAt)} JST</p></button>`).join('')}</div>`;
  }

  function renderHosts() {
    root('hosts').innerHTML = heading('INFRASTRUCTURE', text('サーバーとディスク', 'Hosts & disks'), text('SSD・HDD・USBと、それぞれの保存領域を確認できます。', 'Inspect SSDs, HDDs, USB devices and their filesystems.')) +
      `<div class="ops-host-list">${data.hosts.map((h) => `<article class="ops-card ops-host-card">
        <div class="ops-card-title"><div><span class="ops-eyebrow">${esc(h.hostId)}</span><h3>${esc(h.name)}</h3></div>${badge(h.freshness)}</div>
        <div class="ops-metrics-grid ops-host-metrics">${metric('CPU',pct(h.cpuPct))}${metric(text('メモリ', 'Memory'),pct(h.memoryPct))}${metric(text('温度', 'Temperature'),h.temperatureC == null ? '—' : `${h.temperatureC} °C`)}${metric(text('接続ディスク', 'Attached disks'),h.diskInventoryStatus==='ok' ? (h.physicalDisks||[]).length : '—')}</div>
        <p class="ops-meta">${text('稼働時間', 'Uptime')} ${h.uptimeSeconds == null ? '—' : `${Math.floor(h.uptimeSeconds/3600)} h`} · ${text('最終観測', 'Observed')} ${date(h.measuredAt)} JST</p>
        ${renderDiskInventory(h,{text,esc,formatBytes})}
        ${h.disks.length ? `<details class="ops-mount-checks" ${h.disks.some((d)=>d.mounted===false||d.uuidMatches===false)?'open':''}><summary>${text('指定保存先のマウント・健康状態', 'Configured mount and health checks')}</summary><div class="ops-disk-list">${h.disks.map((d) => `<div class="ops-disk"><div class="ops-card-title"><code>${esc(d.path)}</code>${badge(d.mounted === false || d.uuidMatches === false || d.smart === 'failed' ? 'error' : d.mounted == null ? 'unknown' : 'ok')}</div><p class="ops-meta">UUID: ${d.uuidMatches === true ? text('一致', 'matched') : d.uuidMatches === false ? text('不一致', 'mismatch') : text('未確認', 'unknown')} · SMART: ${d.smart === 'passed' ? text('正常', 'passed') : d.smart === 'failed' ? text('異常', 'failed') : text('未確認', 'unknown')}</p></div>`).join('')}</div></details>` : ''}
        ${(h.errors||[]).length ? `<p class="ops-inline-warning">${esc(h.errors.join(' / '))}</p>` : ''}
      </article>`).join('')}</div>`;
  }

  function renderServices() {
    const shown = data.hosts.filter((h) => !serviceFilters.host || h.hostId===serviceFilters.host);
    root('services').innerHTML = heading('SERVICES', text('動いているサービス', 'Service health'), text('コンテナの稼働と、アプリケーションの健康状態を分けて表示します。', 'Process state and application health are separate signals.')) +
      `<div class="ops-log-filters"><label>${text('サーバー', 'Host')}<select data-service-filter="host"><option value="">${text('すべて', 'All')}</option>${data.hosts.map((h)=>`<option value="${esc(h.hostId)}" ${h.hostId===serviceFilters.host?'selected':''}>${esc(h.name)}</option>`).join('')}</select></label><label>${text('状態', 'State')}<select data-service-filter="state"><option value="">${text('すべて', 'All')}</option>${['running','stopped','failed','unhealthy','unknown'].map((v)=>`<option value="${v}" ${v===serviceFilters.state?'selected':''}>${esc(label(v))}</option>`).join('')}</select></label></div>` +
      `<div class="ops-service-grid">${shown.flatMap((h) => h.services.filter((s)=>!serviceFilters.state || s.state===serviceFilters.state || s.health===serviceFilters.state).map((s) => `<article class="ops-card" data-service-id="${esc(s.id)}"><div class="ops-card-title"><div><span class="ops-eyebrow">${esc(h.name)} / ${esc(s.kind)}</span><h3>${esc(s.name)}</h3></div>${badge(h.freshness!=='fresh'?h.freshness:h.servicesFreshness&&h.servicesFreshness!=='fresh'?h.servicesFreshness:s.state)}</div><div class="ops-service-detail"><span>${text('ヘルスチェック', 'Health check')}</span>${badge(s.health || 'unknown')}<span>${text('再起動回数', 'Restarts')}</span><strong>${s.restarts ?? '—'}</strong></div><p class="ops-meta">${text('起動', 'Started')} ${date(s.startedAt)} JST<br>${text('最終確認', 'Observed')} ${date(h.servicesMeasuredAt||h.measuredAt)} JST${s.state==='stopped'&&s.expectedState==='unknown'?`<br>${text('停止状態。常時稼働の監視対象には指定されていません。', 'Stopped; not configured as an always-running service.')}`:''}</p>${s.logsEnabled||data.mode!=='local-live'?`<button class="admin-button admin-button-secondary" type="button" data-ops-tab="logs" data-host="${esc(h.hostId)}" data-service="${esc(s.id)}">${text('ログを開く', 'Open logs')} <i data-lucide="arrow-up-right" aria-hidden="true"></i></button>`:`<p class="ops-meta">${text('ログ収集は未設定', 'Log collection not enabled')}</p>`}</article>`)).join('') || empty()}</div>`;
  }

  function renderBackups() {
    const open = new Set([...root('backups').querySelectorAll('details[open]')].map((el) => el.dataset.key));
    root('backups').innerHTML = heading('BACKUP & RECOVERY', text('バックアップの保存と復旧', 'Backup & recovery'), text('保存成功・整合性検査・復元試験を、それぞれの証拠で確認します。', 'Capture, integrity checks and restore tests each have their own evidence.')) +
      `<div class="ops-backup-grid">${data.backups.map((b) => {
        const key = `${b.hostId}:${b.id}`;
        const page = Math.min(backupPages.get(key)||0, Math.max(0,Math.ceil(b.snapshots.length/20)-1));
        const complete = b.snapshots.filter((s) => s.complete);
        const latestFull = complete.find((s) => s.kind === 'full');
        return `<article class="ops-card ops-backup-card"><div class="ops-card-title"><div><span class="ops-eyebrow">${esc(b.hostId)} / ${b.role === 'primary' ? 'HISTORY' : b.role === 'archive' ? 'ARCHIVE' : 'SECONDARY'}</span><h3>${esc(b.name)}</h3></div>${badge(b.freshness !== 'fresh' ? 'stale' : b.issues.length ? 'warning' : 'ok')}</div><code class="ops-path">${esc(b.repository)}</code><p class="ops-meta">${text('世代一覧の観測', 'Inventory observed')} ${date(b.measuredAt)} JST</p>${b.issues.length ? `<div class="ops-inline-warning">${b.issues.map((issue) => `<p>${esc(issue)}</p>`).join('')}</div>` : ''}<div class="ops-metrics-grid">${metric(text('全体の正常世代', 'Complete full snapshots'),b.inventoryAvailable===false?'—':b.counts.full)}${metric(text('DBの正常世代', 'Complete DB snapshots'),b.inventoryAvailable===false?'—':b.counts.db)}${metric(text('未完了世代', 'Incomplete snapshots'),b.inventoryAvailable===false?'—':b.pendingCount)}</div><dl class="ops-definition"><dt>${text('保持設定', 'Retention policy')}</dt><dd>${esc(backupRetentionText(b,{text}))}</dd><dt>${text('保存範囲', 'Recovery range')}</dt><dd>${date(complete.at(-1)?.time)} → ${date(complete[0]?.time)} JST</dd><dt>${text('ディスク残容量', 'Disk free space')}</dt><dd>${formatBytes(b.disk.freeBytes)} / ${formatBytes(b.disk.totalBytes)}</dd><dt>${text('空き容量の停止基準', 'Free space guard')}</dt><dd>${b.role === 'archive' ? text('対象外（退避保管）', 'Not applicable (archive)') : formatBytes(b.minimumFreeBytes)}</dd></dl><div class="ops-metrics-grid ops-storage-metrics">${metric(text('保存データ', 'Repository'),formatBytes(b.repositoryBytes))}${metric(text('作業領域', 'Staging'),formatBytes(b.workBytes))}${metric(text('復元試験領域', 'Restore workspace'),formatBytes(b.restoreBytes))}</div><p class="ops-note">${b.role === 'archive' ? text('退避時点の世代を固定保管しています。定期的な追加・削除はありません。', 'Fixed archive of historical snapshots; no scheduled additions or deletions.') : b.forecast.status === 'estimated' ? text(`実測増加量からの目安：約${b.forecast.daysRemaining}日で空き容量の停止基準に到達。`, `Estimated ${b.forecast.daysRemaining} days until the free-space guard.`) : text('容量予測：推定準備中、または継続的な増加を観測していません。最低7日間の実測が必要です。', 'Capacity estimate: learning or no sustained growth. At least seven days of measurements are required.')}</p><div class="ops-table-wrap"><table class="ops-table"><caption>${text('実行と検証の記録', 'Execution & verification')}</caption><thead><tr><th>${text('処理', 'Job')}</th><th>${text('状態', 'State')}</th><th>${text('最終成功 / 対象', 'Last success / target')}</th><th>${text('次回予定', 'Next run')}</th></tr></thead><tbody>${b.jobs.map((j) => `<tr><th>${esc(label(j.kind))}</th><td>${badge(j.phase)}</td><td>${date(j.lastSuccessAt)}<small>${['check','deep-check'].includes(j.kind) ? j.readData===true ? text('全データ読込検査', 'Full data check') : text('構造検査／範囲未確認', 'Structural check / scope unknown') : j.kind==='restore' ? `${j.snapshotId?.slice(0,8)||'—'} · ${j.snapshotId && j.snapshotId===latestFull?.id ? text('最新全体が対象', 'Latest full tested') : text('最新全体の復元確認とは別', 'Does not verify latest full')}` : j.snapshotId?.slice(0,8)||''}</small>${j.lastFailureAt ? `<small class="ops-danger">${text('直近失敗', 'Last failure')} ${date(j.lastFailureAt)}</small>` : ''}</td><td data-backup-schedule="${esc(j.kind)}">${esc(backupScheduleText(j,{text,date}))}</td></tr>`).join('')}</tbody></table></div>${renderReplication(b)}<details class="ops-snapshots" data-key="${esc(key)}" ${open.has(key)?'open':''}><summary>${text('保存されている全世代を見る', 'Browse stored snapshots')} · ${b.snapshots.length}</summary><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>ID</th><th>${text('種類', 'Kind')}</th><th>${text('保存日時', 'Captured')}</th><th>${text('完了', 'Complete')}</th></tr></thead><tbody>${b.snapshots.slice(page*20,page*20+20).map((s) => `<tr><td><code title="${esc(s.id)}">${esc(s.id.slice(0,12))}</code></td><td>${esc(label(s.kind))}</td><td>${date(s.time)}</td><td>${s.complete ? text('正常', 'Complete') : text('未完了', 'Incomplete')}</td></tr>`).join('')}</tbody></table></div><div class="ops-pagination"><button type="button" data-backup-page="${esc(key)}" data-page="${page-1}" ${page===0?'disabled':''}>${text('前へ', 'Previous')}</button><span>${page+1} / ${Math.max(1,Math.ceil(b.snapshots.length/20))}</span><button type="button" data-backup-page="${esc(key)}" data-page="${page+1}" ${(page+1)*20>=b.snapshots.length?'disabled':''}>${text('次へ', 'Next')}</button></div></details></article>`;
      }).join('') || empty()}</div>`;
  }

  function renderCI() {
    const ci = data.ci;
    const open = new Set([...root('ci').querySelectorAll('details[open]')].map((el) => el.dataset.ciKey));
    root('ci').innerHTML = heading('GITHUB ACTIONS', text('CIの進行状況', 'Continuous integration'), data.mode==='local-live' ? text('GitHubを約60秒ごとに確認。画面は5秒ごとに更新します。ログ全文はGitHubで確認できます。', 'GitHub is checked about every 60 seconds; this page refreshes every 5 seconds. Full logs are available on GitHub.') : text('イベントと定期照合で更新。ログ本文は取得可能な範囲を表示します。', 'Updated by events and reconciliation. Log availability depends on GitHub.')) +
      `<div class="ops-ci-status">${badge(ci.state)}<span>${text('最終照合', 'Last reconciliation')} ${date(ci.lastSuccessAt)} JST${data.mode==='local-live'?'':` · ${text('最終イベント', 'Last event')} ${date(ci.lastEventAt)}`}</span></div><div class="ops-ci-status">${badge(failed?'stale':ci.runnerInventoryState)}<span>${text('runner最終確認', 'Runners checked')} ${date(ci.runnersMeasuredAt)} JST</span></div>${ci.error?`<p class="ops-inline-warning">${esc(ci.error)}</p>`:''}` +
      renderCIContent(ci, {text, esc, badge, date, empty, safeGithubUrl, open, disconnected: failed});
  }

  function renderLogFilters() {
    root('logs').innerHTML = heading('LOG EXPLORER', text('サービスのログ', 'Service logs'), data.mode==='local-live'?text('ローカル起動後に集めたログです。約30秒ごとに直近5分・各30行まで取得し、既知の資格情報を伏せます。', 'Logs collected since local startup. About every 30 seconds, up to 30 recent lines per source; known credentials are redacted.'):text('保存期間7日・最大50,000行。機密値は収集時と保存時に除去します。', 'Retained for 7 days, up to 50,000 lines. Known secrets are redacted.')) +
      `<div id="ops-log-collection" class="ops-note"></div>` +
      `<form class="ops-log-filters" id="ops-log-filters"><label>${text('サーバー', 'Host')}<select name="host"><option value="">${text('すべて', 'All')}</option>${data.hosts.map((h)=>`<option value="${esc(h.hostId)}" ${h.hostId===filters.host?'selected':''}>${esc(h.name)}</option>`).join('')}</select></label><label>${text('サービス', 'Service')}<select name="service"><option value="">${text('すべて', 'All')}</option>${[...new Set(data.hosts.filter((h)=>!filters.host||h.hostId===filters.host).flatMap((h)=>h.services.map((s)=>s.id)))].map((s)=>`<option ${s===filters.service?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>${text('重要度', 'Level')}<select name="level">${['','error','warning','info','debug'].map((v)=>`<option value="${v}" ${v===filters.level?'selected':''}>${v||text('すべて', 'All')}</option>`).join('')}</select></label><label>${text('期間', 'Period')}<select name="period">${[['15',text('15分', '15 min')],['60',text('1時間', '1 hour')],['1440',text('24時間', '24 hours')],['10080',text('7日', '7 days')]].map(([v,l])=>`<option value="${v}" ${v===filters.period?'selected':''}>${l}</option>`).join('')}</select></label><label class="ops-search">${text('本文検索', 'Search')}<input name="q" maxlength="200" value="${esc(filters.q)}" placeholder="${text('ログの文字列', 'Text in logs')}" /></label><button type="submit" class="admin-button">${text('適用', 'Apply')}</button></form><div class="ops-log-toolbar"><button type="button" class="admin-button admin-button-secondary" id="ops-log-pause">${paused?text('自動更新を再開', 'Resume'):text('自動更新を停止', 'Pause')}</button><button type="button" class="admin-button admin-button-secondary" id="ops-log-latest">${text('最新に戻る', 'Latest')}</button><span id="ops-log-status" role="status"></span></div><div class="ops-log-output" id="ops-log-output" tabindex="0" aria-label="${text('ログ一覧', 'Log entries')}"></div><button type="button" class="admin-button admin-button-secondary" id="ops-log-older">${text('以前のログ', 'Older logs')}</button>`;
  }

  async function loadLogs() {
    renderAdminIcons(root('logs'));
    const params=new URLSearchParams({limit:'200',since:new Date(Date.now()-Number(filters.period)*60000).toISOString()});
    for(const key of ['host','service','level','q'])if(filters[key])params.set(key,filters[key]);
    if(cursor)params.set('before',cursor);
    const result=await request(`/monitoring/logs?${params}`);
    nextCursor=result.nextCursor;
    if(!byId('ops-log-output'))return;
    byId('ops-log-output').innerHTML=result.items.length ? result.items.map((l)=>`<div class="ops-log-line" data-level="${esc(l.level)}"><time>${date(l.at)}</time><span>${esc(l.host)} / ${esc(l.service)}</span><b>${esc(l.level)}</b><pre>${esc(l.message)}</pre></div>`).join('') : empty(text('条件に一致するログはありません。', 'No logs match these filters.'));
    byId('ops-log-status').textContent=`${result.items.length} ${text('行', 'lines')} · ${paused?text('一時停止中', 'Paused'):cursor?text('過去ログを表示中', 'Historical page'):text('2秒ごとに更新', 'Updates every 2 seconds')}`;
    const collection=byId('ops-log-collection');
    if(collection){collection.hidden=!data.collectionStatus;collection.innerHTML=(data.collectionStatus||[]).map((s)=>`<p>${esc(s.name)} · ${text('最終収集', 'Collected')} ${date(s.measuredAt)} JST · ${(s.logSources||[]).length} ${text('対象', 'sources')}${s.error||s.logSources?.some((l)=>l.status==='error')?` · ${text('一部のログを取得できません', 'Some log sources unavailable')}`:''}${s.logsTruncated||s.logSources?.some((l)=>l.atLimit)?` · ${text('取得上限あり', 'Collection limit reached')}`:''}</p>`).join('');}
    byId('ops-log-older').disabled=!nextCursor;
  }

  const renders=Object.fromEntries(Object.entries({overview:renderOverview,hosts:renderHosts,services:renderServices,backups:renderBackups,ci:renderCI})
    .map(([tab,render])=>[tab,()=>{render();renderAdminIcons(root(tab));}]));
  async function refresh(tab=active) {
    if(pending){
      await pending;
      if(active===tab&&data){
        if(tab==='logs'){if(!byId('ops-log-filters'))renderLogFilters();await loadLogs();}
        else renders[tab]?.();
      }
      return;
    }
    pending=(async()=>{
      try{
        data=await request('/monitoring');failed=false;setConnection();
        byId('ops-demo').hidden=data.mode!=='demo';
        const liveSource=byId('ops-live-source');
        const scope=data.collectionScope||['hosts','ci'];
        if(liveSource){liveSource.hidden=data.mode!=='local-live';if(!liveSource.hidden)liveSource.innerHTML=`<strong>${text('ローカル / 実データ・読み取り専用', 'LOCAL / LIVE DATA · READ ONLY')}</strong><span>${esc(data.sourceDescription)}<br>${text('実データ：', 'Live data: ')}${scope.map((s)=>({hosts:text('サーバー・ディスク','Hosts / disks'),ci:'CI',services:text('サービス','Services'),backups:text('バックアップ','Backups'),logs:text('ログ','Logs')})[s]||esc(s)).join(' / ')}<br>${text('勤怠・操作履歴は未接続です。本番の設定変更はできません。', 'Attendance and audit history are not connected. Production changes are disabled.')}</span>`;}
        for(const id of ['services','backups','logs','timecard','audit']){const button=byId(`admin-tab-${id}`);if(button){button.disabled=data.mode==='local-live'&&!scope.includes(id);button.title=button.disabled?text('実データ未接続', 'Live data not connected'):'';}}
        if(data.mode==='local-live'&&active!=='overview'&&!scope.includes(active)){openTab('hosts');return;}
        if(active===tab){if(tab==='logs'){if(!byId('ops-log-filters'))renderLogFilters();if(!paused&&!cursor)await loadLogs();}else renders[tab]?.();}
      }catch(error){
        failed=true;setConnection();
        if(data){
          data.hosts.forEach((h)=>{h.freshness='stale';});
          data.backups.forEach((b)=>{b.freshness='stale';});
          data.ci.state='stale';
          if(active===tab)renders[tab]?.();
        }else if(root(tab))root(tab).innerHTML=empty(text('管理APIの情報を取得できません。', 'Monitoring API is unavailable.'));
      }
      finally{pending=null;schedule();}
    })();
    return pending;
  }
  function schedule(){clearTimeout(timer);if(initialized&&!document.hidden&&tabs.includes(active))timer=setTimeout(()=>refresh(),active==='logs'?2000:5000);}
  function tabChanged(tab){active=tab;clearTimeout(timer);if(tab==='logs')root('logs').innerHTML='';schedule();}
  function init(){
    initialized=true;
    document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&tabs.includes(active))refresh();});
    document.addEventListener('click',async(event)=>{
      const nav=event.target.closest('[data-ops-tab]');
      if(nav){filters.host=nav.dataset.host||'';filters.service=nav.dataset.service||'';cursor=null;paused=false;openTab(nav.dataset.opsTab);}
      if(event.target.closest('[data-ops-refresh]'))refresh();
      const paging=event.target.closest('[data-backup-page]');
      if(paging){backupPages.set(paging.dataset.backupPage,Number(paging.dataset.page));renders.backups();}
      if(event.target.closest('#ops-log-pause')){paused=!paused;renderLogFilters();await loadLogs();}
      if(event.target.closest('#ops-log-latest')){cursor=null;paused=false;renderLogFilters();await loadLogs();}
      if(event.target.closest('#ops-log-older')&&nextCursor){cursor=nextCursor;await loadLogs();}
      const logButton=event.target.closest('[data-ci-log]');
      if(logButton){
        const dialog=byId('ops-ci-dialog');byId('ops-ci-log').textContent=text('取得中…', 'Loading…');dialog.showModal();
        try{const result=await request(`/monitoring/ci/logs?${new URLSearchParams({repository:logButton.dataset.repo,jobId:logButton.dataset.ciLog})}`);byId('ops-ci-log').textContent=result.text+(result.truncated?text('\n…表示上限に達しました。全文はGitHubで確認してください。','\n…Display limit reached. Open GitHub for full logs.'):'');}
        catch{byId('ops-ci-log').textContent=text('ログはまだ取得できません。GitHubのジョブ画面でも確認できます。','Logs are unavailable. Open the job on GitHub.');}
      }
    });
    document.addEventListener('submit',async(event)=>{if(event.target.id==='ops-log-filters'){event.preventDefault();Object.assign(filters,Object.fromEntries(new FormData(event.target)));cursor=null;await loadLogs();}});
    document.addEventListener('change',(event)=>{const key=event.target.dataset.serviceFilter;if(key){serviceFilters[key]=event.target.value;renders.services();}});
    byId('ops-scenario')?.addEventListener('change',async(event)=>{await request('/local-scenario',{method:'POST',body:JSON.stringify({scenario:event.target.value})});await refresh();});
    window.addEventListener('langchange',()=>{if(data){if(active==='logs'){renderLogFilters();loadLogs();}else renders[active]?.();setConnection();}translateNavigation();});
    translateNavigation();
  }
  function translateNavigation(){
    for(const [id,ja,en] of [['overview','全体状況','Overview'],['hosts','サーバー','Hosts'],['services','サービス','Services'],['backups','バックアップ','Backups'],['logs','ログ','Logs'],['ci','GitHub CI','GitHub CI'],['timecard','勤怠管理','Attendance'],['audit','操作履歴','Audit trail']]){
      const el=byId(`admin-tab-${id}`)?.querySelector('.ops-nav-label');if(el)el.textContent=text(ja,en);
    }
    byId('admin-heading').textContent=text('サーバー管理','Server administration');
  }
  return {init,tabChanged,load:refresh,canManage:()=>data?.readOnly!==true};
}
