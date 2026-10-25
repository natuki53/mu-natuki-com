import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Deliberately restricted to the synthetic loopback preview, never a live admin site.
const url = new URL(process.env.MONITOR_PREVIEW_URL || 'http://127.0.0.1:4178/admin/');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only loopback previews may be tested');
const output = '.local/browser-verification';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  const failures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 500 && !response.url().includes('/ci/logs')) failures.push(response.url()); });
  await page.goto(url.href);
  await page.locator('#ops-overview h2').waitFor();
  assert(await page.locator('#ops-demo').isVisible(), 'Synthetic preview marker is required');
  assert.equal(await page.locator('.admin-tabs svg.lucide').count(), 8, 'Navigation uses standard SVG icons');
  for (const [scenario, message] of [
    ['backup-failure', '直近の実行が失敗'], ['disk-missing', 'ディスクの確認'], ['low-space', '容量不足'],
    ['collector-offline', '更新されていません'], ['service-failure', '異常があります'], ['ci-failure', '失敗しました'],
  ]) {
    await page.selectOption('#ops-scenario', scenario);
    await page.waitForFunction((value) => document.querySelector('#ops-overview')?.textContent.includes(value), message);
  }
  await page.selectOption('#ops-scenario', 'normal');
  await page.waitForFunction(() => document.querySelector('#ops-overview')?.textContent.includes('異常はありません'));
  await page.screenshot({ path: `${output}/overview.png` });
  const tabs = ['overview', 'hosts', 'services', 'backups', 'logs', 'ci', 'timecard', 'audit'];
  const widths = [320, 375, 430, 768, 1024, 1264, 1440, 1920, 2560, 3840];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of tabs) {
      await page.locator(`#admin-tab-${tab}`).click();
      await page.waitForFunction((id) => !document.getElementById(`admin-panel-${id}`).hidden, tab);
      if (['overview', 'hosts', 'services', 'backups', 'logs', 'ci'].includes(tab)) await page.locator(`#ops-${tab} h2`).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}px / ${tab}`);
      if (width >= 1264) assert(await page.evaluate(() => document.documentElement.clientWidth - document.querySelector('.admin-main').getBoundingClientRect().right <= 33), `Unused right margin at ${width}px / ${tab}`);
      if (width === 3840 && tab === 'timecard') await page.screenshot({ path: `${output}/ultrawide-timecard.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#admin-tab-backups').click();
  await page.locator('.ops-backup-card').first().waitFor();
  assert((await page.locator('#ops-backups').innerText()).includes('最新の保存元IDと一致'));
  await page.locator('.ops-snapshots summary').first().click();
  await page.locator('[data-backup-page][data-page="1"]').first().click();
  assert.match(await page.locator('.ops-pagination').first().innerText(), /2 \/ 4/);
  await page.locator('.ops-snapshots summary').first().click();
  await page.screenshot({ path: `${output}/backups.png`, fullPage: true });
  await page.locator('#admin-tab-logs').click();
  await page.locator('.ops-log-line').first().waitFor();
  assert(!(await page.locator('#ops-log-output').innerText()).includes('demo-secret-must-be-redacted'));
  await page.locator('#ops-log-pause').click();
  await page.waitForFunction(() => document.querySelector('#ops-log-status')?.textContent.includes('一時停止'));
  await page.locator('#admin-tab-ci').click();
  await page.locator('.ops-ci-job').waitFor();
  assert.match(await page.locator('.ops-ci-server[data-host="ryzen"] [data-ci-capacity]').innerText(), /1\s*\/\s*2/);
  assert.equal(await page.locator('.ops-ci-server[data-host="intel"]').getAttribute('data-state'), 'offline');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/ci.png`, fullPage: true });
  await page.locator('[data-ci-log]').first().click();
  await page.waitForFunction(() => document.querySelector('#ops-ci-log')?.textContent.includes('取得できません'));
  await page.locator('#ops-ci-dialog button').click();
  for (const [scenario, state] of [['ci-idle', 'idle'], ['ci-offline', 'offline']]) {
    await page.selectOption('#ops-scenario', scenario);
    await page.waitForFunction((expected) => document.querySelector('.ops-ci-server[data-host="ryzen"]')?.dataset.state === expected, state);
    assert.match(await page.locator('.ops-ci-server[data-host="ryzen"]').innerText(), /未稼働/);
    assert.equal(await page.locator('.ops-ci-run').count(), 0, 'Completed jobs cannot remain in the running list');
  }
  await page.locator('.ops-ci-history summary').first().click();
  await Promise.all([page.waitForResponse((response) => response.url().endsWith('/api/admin/v1/monitoring')), page.locator('#ops-ci [data-ops-refresh]').click()]);
  assert(await page.locator('.ops-ci-history').first().getAttribute('open') !== null, 'History remains expanded on refresh');
  await page.selectOption('#ops-scenario', 'normal');
  await page.waitForFunction(() => document.querySelector('.ops-ci-server[data-host="ryzen"]')?.dataset.state === 'running');
  await page.route('**/api/admin/v1/monitoring', (route) => route.abort());
  await page.locator('#ops-ci [data-ops-refresh]').click();
  await page.waitForFunction(() => document.querySelector('.ops-ci-server[data-host="ryzen"]')?.dataset.state === 'unknown');
  assert.match(await page.locator('.ops-ci-server[data-host="ryzen"] [data-ci-capacity]').innerText(), /—\s*\/\s*2/);
  await page.unroute('**/api/admin/v1/monitoring');
  await page.locator('#ops-ci [data-ops-refresh]').click();
  await page.waitForFunction(() => document.querySelector('.ops-ci-server[data-host="ryzen"]')?.dataset.state === 'running');
  await page.locator('#admin-tab-hosts').click();
  await page.locator('#ops-hosts h2').waitFor();
  assert.equal(await page.locator('[data-disk-kind="ssd"]').count(), 2);
  assert.equal(await page.locator('[data-disk-kind="hdd"]').count(), 1);
  assert.equal(await page.locator('[data-disk-kind="usb"]').count(), 1);
  assert.match(await page.locator('[data-disk-kind="usb"]').innerText(), /未マウント/);
  assert.equal(await page.locator('[data-disk-kind="usb"] meter').count(), 0);
  await page.screenshot({ path: `${output}/hosts.png`, fullPage: true });
  await page.route('**/api/admin/v1/monitoring', (route) => route.abort());
  await page.locator('#ops-hosts [data-ops-refresh]').click();
  await page.waitForFunction(() => document.querySelector('#ops-connection')?.textContent.includes('接続できません'));
  assert((await page.locator('#ops-hosts').innerText()).includes('更新停止'));
  await page.unroute('**/api/admin/v1/monitoring');
  await page.locator('#ops-hosts [data-ops-refresh]').click();
  await page.waitForFunction(() => !document.querySelector('#ops-connection')?.textContent.includes('接続できません'));
  await page.locator('[data-theme="dark"]').click();
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(28, 25, 32)');
  await page.screenshot({ path: `${output}/dark.png` });
  await page.locator('[data-lang="en"]').click();
  await page.waitForFunction(() => document.querySelector('#ops-hosts h2')?.textContent === 'Hosts & disks');
  await page.locator('[data-lang="ja"]').click();
  await page.locator('[data-theme="light"]').click();
  await page.setViewportSize({ width: 375, height: 950 });
  await page.locator('[data-theme="dark"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Mobile theme control must be operable');
  await page.locator('[data-theme="light"]').click();
  await page.locator('#admin-tab-backups').click();
  await page.locator('.ops-backup-card').first().waitFor();
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(250, 248, 251)');
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, widths, tabs, failureScenarios: 6, ciScenarios: ['running','idle','offline','unknown'], errors, failures }, null, 2));
  console.log('PASS: 80 responsive views including full-width 3840px, disks/unmounted usage, CI running/idle/offline/unknown capacity, 6 failure scenarios, pagination, logs, API loss/recovery and theme/language controls');
} finally {
  await browser.close();
}
