import test from 'node:test';
import assert from 'node:assert/strict';
import { backupScheduleText, backupRetentionText } from '../src/scripts/admin-backup.js';

const helpers = { text: (ja) => ja, date: () => '11/01 06:00:00' };
test('scheduled jobs display actual dates while manual and conditional jobs have explicit explanations', () => {
  assert.equal(backupScheduleText({ nextRunAt: '2026-10-31T21:00:00Z' }, helpers), '11/01 06:00:00 JST');
  assert.equal(backupScheduleText({ scheduleMode: 'manual' }, helpers), '手動実行（予定なし）');
  assert.equal(backupScheduleText({ scheduleMode: 'on-copy-change' }, helpers), '新しい世代のコピー時');
  assert.equal(backupScheduleText({ scheduleMode: 'after-run' }, helpers), '今回の処理完了後に確定');
});
test('stopped schedules suppress old dates and missing or invalid dates remain unknown', () => {
  assert.equal(backupScheduleText({ scheduleMode: 'disabled', nextRunAt: '2026-10-31T21:00:00Z' }, helpers), '自動実行は停止中');
  for (const job of [{}, { nextRunAt: 'invalid' }, { scheduleMode: 'scheduled' }]) {
    assert.equal(backupScheduleText(job, helpers), '予定を取得できません');
  }
});
test('primary retention separates hourly DB policy from full snapshot policies', () => {
  const result = backupRetentionText({ role: 'primary', retention: { hourly: 2160, daily: 730, weekly: 260, monthly: 120 } }, helpers);
  assert.equal(result, 'DB：毎時 2160 世代（約90日分） · 全体：日次 730 / 週次 260 / 月次 120');
  assert.equal(backupRetentionText({ role: 'secondary', retention: { full: 1, db: 1 } }, helpers), '全体 1 / DB 1');
  assert.equal(backupRetentionText({ role: 'archive' }, helpers), '退避保管・自動削除なし');
});
