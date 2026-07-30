const API_ROOT = '/api/admin/v1';
const REQUEST_TIMEOUT_MS = 15000;

const dynamicCopy = {
  ja: {
    loading: '読み込み中…',
    unavailable: '情報を取得できませんでした。',
    noData: '表示できるデータはありません。',
    online: '稼働中',
    degraded: '一部異常',
    offline: '停止中',
    activeCount: '出勤中',
    servicesOnline: '稼働サービス',
    hostCpu: 'CPU',
    hostMemory: 'メモリ',
    shifts: '勤務回数',
    workDays: '勤務日数',
    workTotal: '勤務合計',
    breakTotal: '休憩合計',
    working: '勤務中',
    break: '休憩中',
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
    activeCount: 'Clocked in',
    servicesOnline: 'Services online',
    hostCpu: 'CPU',
    hostMemory: 'Memory',
    shifts: 'Shifts',
    workDays: 'Work days',
    workTotal: 'Total work',
    breakTotal: 'Total breaks',
    working: 'Working',
    break: 'On break',
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
  records: [],
  recordTotal: 0,
  recordPage: 1,
  recordPageSize: 25,
  editingRecord: null,
  pendingServiceAction: null,
};

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

const formatDateTime = (value, includeDate = true) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(language() === 'en' ? 'en-US' : 'ja-JP', {
    ...(includeDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const stateLabel = (value) => copy()[value] || value;

const summaryCard = (label, value, note = '') => `
  <article class="admin-summary-card">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${note ? `<small>${escapeHtml(note)}</small>` : ''}
  </article>
`;

const loadOverview = async () => {
  const root = document.getElementById('admin-overview-cards');
  const list = document.getElementById('overview-services');
  root?.setAttribute('aria-busy', 'true');
  try {
    const data = await request('/overview');
    state.services = data.services || [];
    const online = state.services.filter((service) => service.state === 'online').length;
    const host = data.publicStatus?.['server-status'];
    if (root) {
      root.innerHTML = [
        summaryCard(copy().servicesOnline, `${online} / ${state.services.length}`),
        summaryCard(copy().activeCount, String(data.activeAttendanceCount ?? 0)),
        summaryCard(copy().hostCpu, host ? `${Math.round(host.cpuPct)}%` : '—'),
        summaryCard(copy().hostMemory, host ? `${Math.round(host.memoryPct)}%` : '—'),
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
  if (!select) return;
  const current = select.value;
  const data = await request('/timecard/members');
  const allLabel = language() === 'en' ? 'All members' : '全員';
  select.innerHTML = `<option value="">${allLabel}</option>${(data.items || [])
    .map(
      (member) =>
        `<option value="${escapeHtml(member.id)}">${escapeHtml(member.displayName)}</option>`,
    )
    .join('')}`;
  if ([...select.options].some((option) => option.value === current)) select.value = current;
};

const renderTimecardSummary = (summary) => {
  const root = document.getElementById('timecard-summary');
  if (!root) return;
  root.innerHTML = [
    summaryCard(copy().shifts, String(summary.shiftCount ?? 0)),
    summaryCard(copy().workDays, String(summary.workDayCount ?? 0)),
    summaryCard(copy().workTotal, formatDuration(summary.workSeconds)),
    summaryCard(copy().breakTotal, formatDuration(summary.breakSeconds)),
  ].join('');
  root.setAttribute('aria-busy', 'false');
};

const renderActiveAttendance = (items) => {
  const root = document.getElementById('timecard-active-list');
  if (!root) return;
  root.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <div class="admin-compact-row admin-active-row">
              <span class="admin-state-dot" data-state="${item.state === 'break' ? 'degraded' : 'online'}"></span>
              <strong>${escapeHtml(item.displayName)}</strong>
              <span>${escapeHtml(copy()[item.state])} · ${escapeHtml(formatDuration(item.workSeconds))}</span>
              <small>${escapeHtml(formatDateTime(item.startAt))}</small>
            </div>
          `,
        )
        .join('')
    : `<p class="admin-empty">${escapeHtml(copy().noData)}</p>`;
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
  const [summary, active, records] = await Promise.all([
    request(`/timecard/summary?${query}`),
    request('/timecard/active'),
    request(
      `/timecard/records?${query}&page=${state.recordPage}&pageSize=${state.recordPageSize}`,
    ),
  ]);
  renderTimecardSummary(summary);
  renderActiveAttendance(active.items || []);
  renderRecords(records);
  const exportLink = document.getElementById('timecard-export');
  if (exportLink) exportLink.href = `${API_ROOT}/timecard/export.csv?${query}`;
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
  root?.setAttribute('aria-busy', 'true');
  const data = await request('/services');
  state.services = data.items || [];
  renderServices();
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

const loaders = {
  overview: loadOverview,
  timecard: loadTimecard,
  services: loadServices,
  audit: loadAudit,
};

const setTab = async (tab) => {
  state.activeTab = tab;
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    const active = button.dataset.adminTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
    const active = panel.dataset.adminPanel === tab;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  try {
    await loaders[tab]?.();
  } catch (error) {
    showGlobalError(error.message || copy().unavailable);
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
    button.addEventListener('click', () => setTab(button.dataset.adminTab));
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
    renderRecords({
      items: state.records,
      total: state.recordTotal,
      page: state.recordPage,
      pageSize: state.recordPageSize,
    });
    setTab(state.activeTab);
  });

  try {
    state.session = await request('/session');
    const email = document.getElementById('admin-email');
    if (email) email.textContent = state.session.email;
    await loadMembers();
    await setTab('overview');
  } catch (error) {
    console.error('Failed to initialize the administration page', error);
    showGlobalError(copy().signedInError);
    const email = document.getElementById('admin-email');
    if (email) email.textContent = copy().unavailable;
  }
};
