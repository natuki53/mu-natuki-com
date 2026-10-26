import { createObservability } from './admin-observability.js';

const API_ROOT = '/api/admin/v1';
const REQUEST_TIMEOUT_MS = 15000;
const ATTENDANCE_POLL_MS = 10_000;

const dynamicCopy = {
  ja: {
    loading: '読み込み中…',
    unavailable: '情報を取得できませんでした。',
    noData: '表示できるデータはありません。',
    online: '稼働中',
    degraded: '一部異常',
    offline: '停止中',
    running: '稼働中',
    stopped: '停止中',
    restarting: '再起動中',
    unhealthy: '異常',
    activeCount: '出勤中',
    servicesOnline: '稼働サービス',
    hostCpu: 'CPU',
    hostMemory: 'メモリ',
    currentUsage: '現在の使用率',
    shifts: '勤務回数',
    workDays: '勤務日数',
    totalWorkDays: '延べ勤務日数',
    workTotal: '勤務合計',
    breakTotal: '休憩合計',
    working: '勤務中',
    break: '休憩中',
    offDuty: '未出勤',
    noCurrentShift: '現在は勤務していません',
    clockedInAt: (time) => `出勤 ${time}`,
    breakStartedAt: (time) => `休憩開始 ${time}`,
    workedDuration: (duration) => `勤務 ${duration}`,
    cumulativeBreak: (duration) => `累計休憩 ${duration}`,
    autoRefreshWaiting: '10秒ごとに自動更新',
    autoRefreshUpdated: (time) => `自動更新 · ${time}`,
    autoRefreshRetrying: '自動更新 · 再試行中',
    excludedRecords: (count) => `旧形式・不整合な記録 ${count}件を除外`,
    completedRecordsOnly: (count) => `退勤済み ${count}件の合計`,
    records: (count) => `${count}件`,
    edit: '修正',
    start: '開始',
    stop: '停止',
    restart: '再起動',
    actionConfirm: (action, name) => `${name}を${action}します。状態が切り替わるまで少し時間がかかることがあります。`,
    actionDone: 'サービス操作が完了しました。',
    correctionDone: '勤務明細を修正しました。',
    signedInError: '管理APIへ接続できません。Cloudflare Accessの設定を確認してください。',
    refreshed: '最新の状態へ更新しました。',
    component: '構成',
    restartCount: '再起動',
    times: '回',
    page: (current, total) => `${current} / ${total} ページ`,
  },
  en: {
    loading: 'Loading…',
    unavailable: 'The information could not be loaded.',
    noData: 'There is no data to display.',
    online: 'Online',
    degraded: 'Degraded',
    offline: 'Stopped',
    running: 'Running',
    stopped: 'Stopped',
    restarting: 'Restarting',
    unhealthy: 'Unhealthy',
    activeCount: 'Clocked in',
    servicesOnline: 'Services online',
    hostCpu: 'CPU',
    hostMemory: 'Memory',
    currentUsage: 'Current usage',
    shifts: 'Shifts',
    workDays: 'Work days',
    totalWorkDays: 'Total work days',
    workTotal: 'Total work',
    breakTotal: 'Total breaks',
    working: 'Working',
    break: 'On break',
    offDuty: 'Not clocked in',
    noCurrentShift: 'No current shift',
    clockedInAt: (time) => `Clocked in ${time}`,
    breakStartedAt: (time) => `Break started ${time}`,
    workedDuration: (duration) => `Worked ${duration}`,
    cumulativeBreak: (duration) => `Total breaks ${duration}`,
    autoRefreshWaiting: 'Auto-refresh every 10 seconds',
    autoRefreshUpdated: (time) => `Auto-refreshed · ${time}`,
    autoRefreshRetrying: 'Auto-refresh · retrying',
    excludedRecords: (count) => `${count} legacy or inconsistent records excluded`,
    completedRecordsOnly: (count) => `Total for ${count} completed shifts`,
    records: (count) => `${count} records`,
    edit: 'Edit',
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
    actionConfirm: (action, name) => `${action} ${name}. The state may take a moment to update.`,
    actionDone: 'The service operation completed.',
    correctionDone: 'The attendance record was corrected.',
    signedInError: 'The administration API is unavailable. Check the Cloudflare Access configuration.',
    refreshed: 'The latest state has been loaded.',
    component: 'Component',
    restartCount: 'Restarts',
    times: '',
    page: (current, total) => `Page ${current} of ${total}`,
  },
};

const state = {
  session: null,
  activeTab: 'overview',
  services: [],
  members: [],
  attendanceStatuses: [],
  activeAttendanceItems: [],
  activeAttendanceFetchedAt: 0,
  timecardSummary: null,
  records: [],
  recordTotal: 0,
  recordPage: 1,
  recordPageSize: 25,
  editingRecord: null,
  pendingServiceAction: null,
};

let attendancePollTimer = null;
let activeAttendanceRequest = null;
let attendanceAutoRefreshPromise = null;

const language = () => (document.documentElement.lang === 'en' ? 'en' : 'ja');
const copy = () => dynamicCopy[language()];

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const showToast = (message) => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.add('hidden'), 2800);
};

const showGlobalError = (message) => {
  const element = document.getElementById('admin-global-message');
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
};

const request = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (options.method && !['GET', 'HEAD'].includes(options.method)) {
    headers.set('X-CSRF-Token', state.session?.csrfToken || '');
  }
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `${response.status} ${response.statusText}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(Number(seconds))) return '—';
  const totalMinutes = Math.max(0, Math.floor(Number(seconds) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return language() === 'en' ? `${hours}h ${minutes}m` : `${hours}時間 ${minutes}分`;
};

const formatLiveDuration = (seconds) => {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return language() === 'en'
    ? `${hours}h ${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`
    : `${hours}時間 ${minutes}分 ${String(remainingSeconds).padStart(2, '0')}秒`;
};

const formatDateTime = (value, includeDate = true) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(language() === 'en' ? 'en-US' : 'ja-JP', {
    ...(includeDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(parsed);
};

const formatTimeWithSeconds = (value) =>
  new Intl.DateTimeFormat(language() === 'en' ? 'en-US' : 'ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(value);

const stateLabel = (value) => copy()[value] || value;

const percentage = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null;
};

const summaryCard = (label, value, note = '', progress = null, tone = 'lavender') => {
  const safeProgress = percentage(progress);
  const chart =
    safeProgress === null
      ? ''
      : `
        <div class="admin-metric-chart" role="progressbar"
          aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow="${Math.round(safeProgress)}">
          <span style="--admin-metric-value: ${safeProgress}"></span>
        </div>
      `;
  return `
  <article class="admin-summary-card" data-tone="${escapeHtml(tone)}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${note ? `<small>${escapeHtml(note)}</small>` : ''}
    ${chart}
  </article>
`;
};

const loadOverview = async () => {
  const root = document.getElementById('admin-overview-cards');
  const list = document.getElementById('overview-services');
  root?.setAttribute('aria-busy', 'true');
  try {
    const data = await request('/overview');
    state.services = data.services || [];
    const online = state.services.filter((service) => service.state === 'online').length;
    const host = data.publicStatus?.['server-status'];
    const cpu = percentage(host?.cpuPct);
    const memory = percentage(host?.memoryPct);
    const serviceRatio = state.services.length ? (online / state.services.length) * 100 : null;
    if (root) {
      root.innerHTML = [
        summaryCard(
          copy().servicesOnline,
          `${online} / ${state.services.length}`,
          '',
          serviceRatio,
          'services',
        ),
        summaryCard(copy().activeCount, String(data.activeAttendanceCount ?? 0)),
        summaryCard(
          copy().hostCpu,
          cpu === null ? '—' : `${Math.round(cpu)}%`,
          copy().currentUsage,
          cpu,
          'cpu',
        ),
        summaryCard(
          copy().hostMemory,
          memory === null ? '—' : `${Math.round(memory)}%`,
          copy().currentUsage,
          memory,
          'memory',
        ),
      ].join('');
    }
    if (list) {
      list.innerHTML = state.services.length
        ? state.services
            .map(
              (service) => `
                <div class="admin-compact-row">
                  <span class="admin-state-dot" data-state="${escapeHtml(service.state)}"></span>
                  <strong>${escapeHtml(service.displayName)}</strong>
                  <span>${escapeHtml(stateLabel(service.state))}</span>
                </div>
              `,
            )
            .join('')
        : `<p class="admin-empty">${copy().noData}</p>`;
    }
    const updated = document.getElementById('overview-updated');
    if (updated) updated.textContent = formatDateTime(data.measuredAt);
  } catch (error) {
    if (root) root.innerHTML = `<p class="admin-empty">${escapeHtml(copy().unavailable)}</p>`;
    if (list) list.innerHTML = '';
    throw error;
  } finally {
    root?.setAttribute('aria-busy', 'false');
  }
};

const monthValue = () => document.getElementById('timecard-month')?.value || '';
const memberValue = () => document.getElementById('timecard-member')?.value || '';
const queryForFilters = () => {
  const params = new URLSearchParams({ month: monthValue() });
  if (memberValue()) params.set('memberId', memberValue());
  return params;
};

const loadMembers = async () => {
  const select = document.getElementById('timecard-member');
  const data = await request('/timecard/members');
  state.members = data.items || [];
  if (!select) return state.members;
  const current = select.value;
  const allLabel = language() === 'en' ? 'All members' : '全員';
  select.innerHTML = `<option value="">${allLabel}</option>${state.members
    .map(
      (member) =>
        `<option value="${escapeHtml(member.id)}">${escapeHtml(member.displayName)}</option>`,
    )
    .join('')}`;
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  return state.members;
};

const renderTimecardSummary = (summary) => {
  const root = document.getElementById('timecard-summary');
  if (!root) return;
  state.timecardSummary = summary;
  const excluded = Number(summary.excludedRecordCount || 0);
  const completedNote = copy().completedRecordsOnly(
    Number(summary.recordCount ?? summary.shiftCount ?? 0),
  );
  root.innerHTML = [
    summaryCard(
      copy().shifts,
      String(summary.shiftCount ?? 0),
      excluded > 0 ? copy().excludedRecords(excluded) : '',
    ),
    summaryCard(
      memberValue() ? copy().workDays : copy().totalWorkDays,
      String(summary.workDayCount ?? 0),
    ),
    summaryCard(copy().workTotal, formatDuration(summary.workSeconds), completedNote),
    summaryCard(copy().breakTotal, formatDuration(summary.breakSeconds), completedNote),
  ].join('');
  root.setAttribute('aria-busy', 'false');
};

const attendanceKey = (_guildId, memberId) => String(memberId);

const mergeAttendanceStatuses = (activeItems) => {
  const activeByMember = new Map(
    activeItems.map((item) => [attendanceKey(item.guildId, item.memberId), item]),
  );
  const knownKeys = new Set();
  const statuses = state.members.map((member) => {
    const key = attendanceKey(member.guildId, member.id);
    knownKeys.add(key);
    return (
      activeByMember.get(key) || {
        guildId: member.guildId,
        memberId: member.id,
        displayName: member.displayName,
        state: 'offDuty',
      }
    );
  });
  activeItems.forEach((item) => {
    if (!knownKeys.has(attendanceKey(item.guildId, item.memberId))) statuses.push(item);
  });
  const stateOrder = { working: 0, break: 1, offDuty: 2 };
  return statuses.sort(
    (left, right) =>
      (stateOrder[left.state] ?? 3) - (stateOrder[right.state] ?? 3) ||
      left.displayName.localeCompare(right.displayName, language() === 'en' ? 'en' : 'ja'),
  );
};

const attendanceDetail = (item) => {
  if (item.state === 'offDuty') {
    return {
      state: copy().offDuty,
      timing: copy().noCurrentShift,
      tone: 'idle',
    };
  }
  const isBreak = item.state === 'break';
  const secondsSinceRefresh = state.activeAttendanceFetchedAt
    ? Math.max(0, Math.floor((Date.now() - state.activeAttendanceFetchedAt) / 1000))
    : 0;
  const duration = isBreak
    ? Number(item.currentBreakSeconds || 0) + secondsSinceRefresh
    : Number(item.workSeconds || 0) + secondsSinceRefresh;
  const times = [copy().clockedInAt(formatDateTime(item.startAt, false))];
  if (isBreak) {
    times.push(copy().breakStartedAt(formatDateTime(item.breakStartedAt, false)));
    times.push(copy().workedDuration(formatDuration(item.workSeconds)));
    times.push(
      copy().cumulativeBreak(
        formatDuration(Number(item.breakSeconds || 0) + secondsSinceRefresh),
      ),
    );
  }
  return {
    state: `${copy()[item.state]} · ${formatLiveDuration(duration)}`,
    timing: times.join(' / '),
    tone: isBreak ? 'degraded' : 'online',
  };
};

const renderAttendanceStatuses = () => {
  const root = document.getElementById('timecard-active-list');
  if (!root) return;
  root.innerHTML = state.attendanceStatuses.length
    ? state.attendanceStatuses
        .map(
          (item) => {
            const detail = attendanceDetail(item);
            return `
            <div class="admin-compact-row admin-active-row">
              <span class="admin-state-dot" data-state="${detail.tone}"></span>
              <strong>${escapeHtml(item.displayName)}</strong>
              <span class="admin-attendance-state" data-state="${escapeHtml(item.state)}">
                ${escapeHtml(detail.state)}
              </span>
              <small>${escapeHtml(detail.timing)}</small>
            </div>
          `;
          },
        )
        .join('')
    : `<p class="admin-empty">${escapeHtml(copy().noData)}</p>`;
};

const renderActiveAttendance = (items) => {
  state.activeAttendanceItems = items;
  state.activeAttendanceFetchedAt = Date.now();
  state.attendanceStatuses = mergeAttendanceStatuses(items);
  renderAttendanceStatuses();
};

const setAttendanceLiveStatus = (status, updatedAt = null) => {
  const root = document.getElementById('timecard-live-status');
  const dot = root?.querySelector('[data-live-status-dot]');
  const label = root?.querySelector('[data-live-status-label]');
  const stateName = status === 'retrying' ? 'degraded' : 'online';
  if (root) root.dataset.state = stateName;
  if (dot) dot.dataset.state = stateName;
  if (!label) return;
  if (status === 'retrying') {
    label.textContent = copy().autoRefreshRetrying;
  } else if (updatedAt) {
    label.textContent = copy().autoRefreshUpdated(formatTimeWithSeconds(updatedAt));
  } else {
    label.textContent = copy().autoRefreshWaiting;
  }
};

const fetchActiveAttendance = () => {
  if (!activeAttendanceRequest) {
    activeAttendanceRequest = request('/timecard/active').finally(() => {
      activeAttendanceRequest = null;
    });
  }
  return activeAttendanceRequest;
};

const renderRecords = (data) => {
  state.records = data.items || [];
  state.recordTotal = data.total || 0;
  state.recordPage = data.page || state.recordPage;
  state.recordPageSize = data.pageSize || state.recordPageSize;
  const body = document.getElementById('timecard-records');
  const count = document.getElementById('timecard-record-count');
  if (count) count.textContent = copy().records(state.recordTotal);
  const totalPages = Math.max(1, Math.ceil(state.recordTotal / state.recordPageSize));
  const pageLabel = document.getElementById('timecard-page-label');
  const previous = document.getElementById('timecard-page-prev');
  const next = document.getElementById('timecard-page-next');
  if (pageLabel) pageLabel.textContent = copy().page(state.recordPage, totalPages);
  if (previous) previous.disabled = state.recordPage <= 1;
  if (next) next.disabled = state.recordPage >= totalPages;
  if (!body) return;
  body.innerHTML = state.records.length
    ? state.records
        .map(
          (record) => `
            <tr>
              <td><strong>${escapeHtml(record.displayName)}</strong></td>
              <td>${escapeHtml(formatDateTime(record.startAt))}</td>
              <td>${escapeHtml(formatDateTime(record.endAt))}</td>
              <td>${escapeHtml(formatDuration(record.breakSeconds))}</td>
              <td>${escapeHtml(formatDuration(record.workSeconds))}</td>
              <td>
                <button class="admin-table-action" type="button" data-edit-record="${record.id}">
                  ${escapeHtml(copy().edit)}
                </button>
              </td>
            </tr>
          `,
        )
        .join('')
    : `<tr><td colspan="6" class="admin-empty">${escapeHtml(copy().noData)}</td></tr>`;
};

const loadTimecard = async () => {
  const summaryRoot = document.getElementById('timecard-summary');
  summaryRoot?.setAttribute('aria-busy', 'true');
  const query = queryForFilters();
  const [, summary, active, records] = await Promise.all([
    loadMembers(),
    request(`/timecard/summary?${query}`),
    fetchActiveAttendance(),
    request(
      `/timecard/records?${query}&page=${state.recordPage}&pageSize=${state.recordPageSize}`,
    ),
  ]);
  renderTimecardSummary(summary);
  renderActiveAttendance(active.items || []);
  setAttendanceLiveStatus('ready', new Date());
  renderRecords(records);
  const exportLink = document.getElementById('timecard-export');
  if (exportLink) exportLink.href = `${API_ROOT}/timecard/export.csv?${query}`;
};

const activeAttendanceKey = (item) =>
  `${String(item.guildId || '')}:${String(item.memberId || '')}`;

const hasCompletedShiftSince = (previousItems, nextItems) => {
  const nextByMember = new Map(
    nextItems.map((item) => [activeAttendanceKey(item), item]),
  );
  return previousItems.some((item) => {
    const next = nextByMember.get(activeAttendanceKey(item));
    return !next || next.startAt !== item.startAt;
  });
};

const stopAttendancePolling = () => {
  if (attendancePollTimer !== null) {
    window.clearTimeout(attendancePollTimer);
    attendancePollTimer = null;
  }
};

const scheduleAttendancePolling = () => {
  stopAttendancePolling();
  if (state.activeTab !== 'timecard' || document.visibilityState !== 'visible') return;
  attendancePollTimer = window.setTimeout(refreshAttendanceAutomatically, ATTENDANCE_POLL_MS);
};

const refreshAttendanceAutomatically = () => {
  attendancePollTimer = null;
  if (state.activeTab !== 'timecard' || document.visibilityState !== 'visible') {
    return Promise.resolve();
  }
  if (attendanceAutoRefreshPromise) return attendanceAutoRefreshPromise;
  const previousItems = state.activeAttendanceItems;
  attendanceAutoRefreshPromise = (async () => {
    try {
      const data = await fetchActiveAttendance();
      const nextItems = data.items || [];
      const completedShift = hasCompletedShiftSince(previousItems, nextItems);
      renderActiveAttendance(nextItems);
      setAttendanceLiveStatus('ready', new Date());
      if (completedShift) await loadTimecard();
    } catch (error) {
      console.warn('Failed to refresh current attendance automatically', error);
      setAttendanceLiveStatus('retrying');
    }
  })().finally(() => {
    attendanceAutoRefreshPromise = null;
    scheduleAttendancePolling();
  });
  return attendanceAutoRefreshPromise;
};

const componentMarkup = (component) => `
  <li>
    <span>${escapeHtml(component.name)}</span>
    <span>${escapeHtml(stateLabel(component.state))}</span>
    <small>${escapeHtml(copy().restartCount)} ${component.restartCount}${escapeHtml(copy().times)}</small>
  </li>
`;

const renderServices = () => {
  const root = document.getElementById('admin-services-grid');
  if (!root) return;
  root.innerHTML = state.services
    .map(
      (service) => `
        <article class="admin-service-card" data-state="${escapeHtml(service.state)}">
          <div class="admin-service-heading">
            <div>
              <p class="admin-card-kicker">${escapeHtml(service.id)}</p>
              <h3>${escapeHtml(service.displayName)}</h3>
            </div>
            <span class="admin-state-badge">
              <span class="admin-state-dot" data-state="${escapeHtml(service.state)}"></span>
              ${escapeHtml(stateLabel(service.state))}
            </span>
          </div>
          <ul class="admin-component-list">
            ${(service.components || []).map(componentMarkup).join('')}
          </ul>
          <div class="admin-service-actions">
            ${['start', 'restart', 'stop']
              .map(
                (action) => `
                  <button type="button"
                    class="admin-button ${action === 'stop' ? 'admin-button-danger-outline' : 'admin-button-secondary'}"
                    data-service-id="${escapeHtml(service.id)}"
                    data-service-name="${escapeHtml(service.displayName)}"
                    data-service-action="${action}">
                    ${escapeHtml(copy()[action])}
                  </button>
                `,
              )
              .join('')}
          </div>
        </article>
      `,
    )
    .join('');
  root.setAttribute('aria-busy', 'false');
};

const loadServices = async () => {
  const root = document.getElementById('admin-services-grid');
  const hasCachedServices = state.services.length > 0;
  if (hasCachedServices) {
    renderServices();
  } else {
    root?.setAttribute('aria-busy', 'true');
  }
  try {
    const data = await request('/services');
    state.services = data.items || [];
    renderServices();
  } finally {
    root?.setAttribute('aria-busy', 'false');
  }
};

const loadAudit = async () => {
  const root = document.getElementById('admin-audit-list');
  root?.setAttribute('aria-busy', 'true');
  const data = await request('/audit?limit=100');
  if (root) {
    root.innerHTML = (data.items || []).length
      ? data.items
          .map(
            (item) => `
              <article class="admin-audit-entry">
                <span class="admin-state-dot" data-state="${item.status === 'succeeded' ? 'online' : item.status === 'running' ? 'degraded' : 'offline'}"></span>
                <div>
                  <strong>${escapeHtml(item.action)} · ${escapeHtml(item.target)}</strong>
                  <p>${escapeHtml(item.detail || '')}</p>
                </div>
                <div class="admin-audit-meta">
                  <span>${escapeHtml(item.actor)}</span>
                  <time>${escapeHtml(formatDateTime(item.created_at))}</time>
                </div>
              </article>
            `,
          )
          .join('')
      : `<p class="admin-empty">${escapeHtml(copy().noData)}</p>`;
    root.setAttribute('aria-busy', 'false');
  }
};

const observability = createObservability({ request, openTab: (tab, options) => setTab(tab, options) });
const loaders = {
  overview: () => observability.load('overview'),
  hosts: () => observability.load('hosts'),
  backups: () => observability.load('backups'),
  logs: () => observability.load('logs'),
  ci: () => observability.load('ci'),
  timecard: loadTimecard,
  services: async () => {
    await observability.load('services');
    const actions=document.querySelector('.ops-existing-actions');
    if(actions)actions.hidden=!observability.canManage();
    if(observability.canManage())await loadServices();
  },
  audit: loadAudit,
};

const setTab = async (tab, { scroll = false } = {}) => {
  if (document.querySelector(`[data-admin-tab="${tab}"]`)?.disabled) return;
  state.activeTab = tab;
  observability.tabChanged(tab);
  const tabList = document.querySelector('.admin-tabs');
  if (tabList) tabList.dataset.activeTab = tab;
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    const active = button.dataset.adminTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.setAttribute('aria-pressed', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
    const active = panel.dataset.adminPanel === tab;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  if (scroll) tabList?.scrollIntoView({ block: 'start' });
  try {
    await loaders[tab]?.();
  } catch (error) {
    showGlobalError(error.message || copy().unavailable);
  } finally {
    scheduleAttendancePolling();
  }
};

const openServiceDialog = (button) => {
  const action = button.dataset.serviceAction;
  const name = button.dataset.serviceName;
  state.pendingServiceAction = {
    id: button.dataset.serviceId,
    action,
    name,
  };
  const title = document.getElementById('service-action-title');
  const description = document.getElementById('service-action-description');
  if (title) title.textContent = `${copy()[action]} · ${name}`;
  if (description) description.textContent = copy().actionConfirm(copy()[action], name);
  document.getElementById('service-action-dialog')?.showModal();
};

const executeServiceAction = async () => {
  if (!state.pendingServiceAction) return;
  const { id, action } = state.pendingServiceAction;
  await request(`/services/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    body: JSON.stringify({ action, requestId: crypto.randomUUID() }),
  });
  showToast(copy().actionDone);
  await loadServices();
};

const toLocalInput = (value) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 19);
};

const openAttendanceDialog = (recordId) => {
  const record = state.records.find((item) => String(item.id) === String(recordId));
  if (!record) return;
  state.editingRecord = record;
  document.getElementById('attendance-edit-member').textContent = record.displayName;
  document.getElementById('attendance-edit-start').value = toLocalInput(record.startAt);
  document.getElementById('attendance-edit-end').value = toLocalInput(record.endAt);
  document.getElementById('attendance-edit-break').value = String(
    Math.round(record.breakSeconds / 60),
  );
  document.getElementById('attendance-edit-reason').value = '';
  document.getElementById('attendance-edit-dialog')?.showModal();
};

const saveAttendanceCorrection = async () => {
  const record = state.editingRecord;
  if (!record) return;
  await request(`/timecard/records/${encodeURIComponent(monthValue())}/${record.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      startAt: new Date(document.getElementById('attendance-edit-start').value).toISOString(),
      endAt: new Date(document.getElementById('attendance-edit-end').value).toISOString(),
      breakSeconds: Number(document.getElementById('attendance-edit-break').value) * 60,
      reason: document.getElementById('attendance-edit-reason').value,
      recordVersion: record.recordVersion,
      requestId: crypto.randomUUID(),
    }),
  });
  document.getElementById('attendance-edit-dialog')?.close();
  showToast(copy().correctionDone);
  await loadTimecard();
};

export const initAdminPage = async () => {
  const month = document.getElementById('timecard-month');
  if (month) {
    const today = new Date();
    month.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }

  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.addEventListener('click', () =>
      setTab(button.dataset.adminTab, { scroll: true }),
    );
  });
  document.querySelector('.admin-tabs')?.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-admin-tab]:not(:disabled)')];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    setTab(tabs[next].dataset.adminTab, { scroll: true });
  });
  document.querySelectorAll('[data-refresh]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await loaders[button.dataset.refresh]?.();
        showToast(copy().refreshed);
      } catch (error) {
        showGlobalError(error.message || copy().unavailable);
      }
    });
  });
  document.getElementById('timecard-filters')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.recordPage = 1;
    await loadTimecard().catch((error) => showGlobalError(error.message));
  });
  document.getElementById('timecard-page-prev')?.addEventListener('click', async () => {
    if (state.recordPage <= 1) return;
    state.recordPage -= 1;
    await loadTimecard().catch((error) => showGlobalError(error.message));
  });
  document.getElementById('timecard-page-next')?.addEventListener('click', async () => {
    const totalPages = Math.max(1, Math.ceil(state.recordTotal / state.recordPageSize));
    if (state.recordPage >= totalPages) return;
    state.recordPage += 1;
    await loadTimecard().catch((error) => showGlobalError(error.message));
  });
  document.getElementById('admin-services-grid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-service-action]');
    if (button) openServiceDialog(button);
  });
  document.getElementById('timecard-records')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-edit-record]');
    if (button) openAttendanceDialog(button.dataset.editRecord);
  });
  document.getElementById('service-action-dialog')?.addEventListener('close', async (event) => {
    if (event.target.returnValue !== 'confirm') return;
    try {
      await executeServiceAction();
    } catch (error) {
      showGlobalError(error.message || copy().unavailable);
    }
  });
  document.querySelector('[data-close-dialog]')?.addEventListener('click', () => {
    document.getElementById('attendance-edit-dialog')?.close();
  });
  document.getElementById('attendance-edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveAttendanceCorrection();
    } catch (error) {
      showGlobalError(error.message || copy().unavailable);
    }
  });
  window.addEventListener('langchange', () => {
    renderServices();
    if (state.timecardSummary) renderTimecardSummary(state.timecardSummary);
    renderAttendanceStatuses();
    setAttendanceLiveStatus(
      'ready',
      state.activeAttendanceFetchedAt ? new Date(state.activeAttendanceFetchedAt) : null,
    );
    renderRecords({
      items: state.records,
      total: state.recordTotal,
      page: state.recordPage,
      pageSize: state.recordPageSize,
    });
    setTab(state.activeTab);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.activeTab === 'timecard') {
      refreshAttendanceAutomatically();
    } else {
      stopAttendancePolling();
    }
  });
  window.setInterval(() => {
    if (
      state.activeTab === 'timecard' &&
      document.visibilityState === 'visible' &&
      state.activeAttendanceItems.length
    ) {
      renderAttendanceStatuses();
    }
  }, 1000);

  try {
    state.session = await request('/session');
    observability.init();
    const email = document.getElementById('admin-email');
    if (email) email.textContent = state.session.email;
    // Attendance loads its members when opened; disconnected optional sections must not fail login.
    await setTab('overview');
  } catch (error) {
    console.error('Failed to initialize the administration page', error);
    showGlobalError(copy().signedInError);
    const email = document.getElementById('admin-email');
    if (email) email.textContent = copy().unavailable;
  }
};
