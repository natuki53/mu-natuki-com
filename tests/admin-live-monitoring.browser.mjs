import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const url = 'http://127.0.0.1:4178/admin/';
const output = '.local/live-browser-verification';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#ops-live-source').waitFor({ state: 'visible' });
  assert(!await page.locator('#admin-global-message').isVisible(), 'Connected read-only preview must not show an authentication error');
  assert.equal(await page.locator('#admin-email').innerText(), 'local-readonly@example.invalid');
  assert(!await page.locator('#ops-demo').isVisible());
  const response = await page.request.get('http://127.0.0.1:4178/api/admin/v1/monitoring');
  const data = await response.json();
  assert.equal(data.mode, 'local-live');
  assert(data.hosts.every((h) => h.freshness === 'fresh' && h.diskInventoryStatus === 'ok'));
  assert.equal(data.ci.runnerInventoryState, 'fresh');
  assert.equal(await page.locator('.admin-tab:disabled').count(), 2);
  assert(data.collectionScope.includes('backups') && data.collectionScope.includes('logs'));
  for (const width of [320, 375, 430, 768, 1024, 1264, 1920, 3840]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of ['overview', 'hosts', 'services', 'backups', 'logs', 'ci']) {
      await page.locator(`#admin-tab-${tab}`).click();
      await page.locator(`#ops-${tab} h2`).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow ${width} / ${tab}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#admin-tab-hosts').click();
  await page.locator('.ops-physical-disk').first().waitFor();
  assert.equal(await page.locator('.ops-physical-disk').count(), data.hosts.reduce((n, h) => n + h.physicalDisks.length, 0));
  assert(!(await page.locator('#ops-hosts').innerText()).includes('Sample'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/hosts.png`, fullPage: true });
  await page.locator('#admin-tab-services').click();
  await page.locator('[data-service-id]').first().waitFor();
  assert.equal(await page.locator('[data-service-id]').count(), data.hosts.reduce((n,h)=>n+h.services.length,0));
  assert(!await page.locator('.ops-existing-actions').isVisible(), 'No production maintenance controls in local read-only mode');
  await page.selectOption('[data-service-filter="host"]', 'ryzen');
  await page.selectOption('[data-service-filter="state"]', 'running');
  assert((await page.locator('[data-service-id]').count()) > 0);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({ path: `${output}/services.png` });
  await page.selectOption('[data-service-filter="host"]', '');
  await page.selectOption('[data-service-filter="state"]', '');
  await page.locator('#admin-tab-backups').click();
  await page.locator('.ops-backup-card').first().waitFor();
  assert.equal(await page.locator('.ops-backup-card').count(), data.backups.length);
  for (const [index,b] of data.backups.entries()) {
    const card=page.locator('.ops-backup-card').nth(index);
    assert((await card.innerText()).includes(b.repository));
    const numbers=await card.locator('.ops-metrics-grid').first().locator('strong').allTextContents();
    assert.deepEqual(numbers,[String(b.counts.full),String(b.counts.db),String(b.pendingCount)]);
  }
  await page.locator('.ops-snapshots summary').first().click();
  await page.locator('[data-backup-page][data-page="1"]').first().click();
  assert.match(await page.locator('.ops-pagination').first().innerText(), /^前へ\s+2\s*\//);
  await page.locator('.ops-snapshots summary').first().click();
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({ path: `${output}/backups.png`, fullPage: true });
  await page.locator('#admin-tab-logs').click();
  await page.locator('.ops-log-line').first().waitFor();
  const logData=await page.request.get('http://127.0.0.1:4178/api/admin/v1/monitoring/logs?limit=1').then(r=>r.json());
  const entry=logData.items[0];
  await page.selectOption('#ops-log-filters [name="host"]',entry.host);
  await page.selectOption('#ops-log-filters [name="service"]',entry.service);
  await page.locator('#ops-log-filters button').click();
  await page.waitForFunction((s)=>[...document.querySelectorAll('.ops-log-line>span')].every(el=>el.textContent.includes(s)),entry.service);
  await page.locator('#ops-log-pause').click();
  await page.waitForFunction(()=>document.querySelector('#ops-log-status')?.textContent.includes('一時停止'));
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({ path: `${output}/logs.png` });
  assert(!await page.locator('#admin-global-message').isVisible());
  await page.locator('#admin-tab-ci').click();
  await page.locator('.ops-ci-server').first().waitFor();
  for (const server of data.ci.servers) {
    assert.match(await page.locator(`.ops-ci-server[data-host="${server.hostId}"] [data-ci-capacity]`).innerText(), new RegExp(`/\\s*${server.maxJobs}`));
  }
  assert.equal(await page.locator('.ops-ci-runner').count(), data.ci.servers.reduce((n, s) => n + s.runners.length, 0));
  assert.match(await page.locator('#ops-ci').innerText(), /登録runner枠/);
  await page.locator('.ops-ci-server[data-host="ryzen"] .ops-ci-machines summary').click();
  assert.match(await page.locator('.ops-ci-server[data-host="ryzen"]').innerText(), /VM停止中/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/ci-top.png` });
  await page.screenshot({ path: `${output}/ci.png`, fullPage: true });
  await page.locator('[data-theme="dark"]').click();
  await page.screenshot({ path: `${output}/ci-dark.png`, fullPage: true });
  await page.route('**/api/admin/v1/monitoring', (route) => route.abort());
  await page.locator('#ops-ci [data-ops-refresh]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ops-ci-server')].every((s) => s.dataset.state === 'unknown'));
  await page.unroute('**/api/admin/v1/monitoring');
  await page.locator('#ops-ci [data-ops-refresh]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ops-ci-server')].every((s) => s.dataset.state !== 'unknown'));
  await page.locator('[data-theme="light"]').click();
  // Wait for one host collection cycle; this does not invoke or change any production job.
  await page.waitForFunction(async (previous) => {
    const latest = await fetch('/api/admin/v1/monitoring').then((r) => r.json());
    return latest.hosts.every((h) => h.measuredAt !== previous[h.hostId]);
  }, Object.fromEntries(data.hosts.map((h) => [h.hostId, h.measuredAt])), { timeout: 45000, polling: 5000 });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, mode: data.mode, readOnly: data.readOnly,
    hosts: data.hosts.map((h) => ({ hostId: h.hostId, disks: h.physicalDisks.length })),
    runnerCapacity: data.ci.servers.map((s) => ({ hostId: s.hostId, maxJobs: s.maxJobs })),
    services: data.hosts.reduce((n,h)=>n+h.services.length,0), backups:data.backups.map(b=>({hostId:b.hostId,counts:b.counts,pending:b.pendingCount})),
    responsiveViews: 48, collectionRefreshVerified: true, errors }, null, 2));
  console.log('PASS: actual disks, CI, services, backups/generations/pagination, logs/filter/pause, 48 responsive views, API recovery and repeated collection; read-only');
} finally { await browser.close(); }
