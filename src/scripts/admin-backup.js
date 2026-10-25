export function backupScheduleText(job, { text, date }) {
  if (job.scheduleMode === 'disabled') return text('自動実行は停止中', 'Automatic execution stopped');
  if (job.scheduleMode === 'manual') return text('手動実行（予定なし）', 'Manual · no scheduled run');
  if (job.scheduleMode === 'on-copy-change') return text('新しい世代のコピー時', 'When new snapshots are copied');
  if (job.nextRunAt && Number.isFinite(Date.parse(job.nextRunAt))) return `${date(job.nextRunAt)} JST`;
  if (job.scheduleMode === 'after-run') return text('今回の処理完了後に確定', 'Determined after the current run');
  return text('予定を取得できません', 'Schedule unavailable');
}

export function backupRetentionText(backup, { text }) {
  const r = backup.retention || {};
  if (backup.role === 'archive') return text('退避保管・自動削除なし', 'Fixed archive · no automatic deletion');
  if (backup.role === 'primary') {
    const parts = [];
    if (r.hourly) parts.push(text(`DB：毎時 ${r.hourly} 世代（約${Math.round(r.hourly / 24)}日分）`, `DB: ${r.hourly} hourly snapshots (~${Math.round(r.hourly / 24)} days)`));
    const full = [['daily', '日次', 'daily'], ['weekly', '週次', 'weekly'], ['monthly', '月次', 'monthly']]
      .filter(([key]) => r[key]).map(([key, ja, en]) => text(`${ja} ${r[key]}`, `${r[key]} ${en}`));
    if (full.length) parts.push(text(`全体：${full.join(' / ')}`, `Full: ${full.join(' / ')}`));
    return parts.length ? parts.join(' · ') : text('保持設定を取得できません', 'Retention unavailable');
  }
  return Object.entries(r).map(([kind, count]) => `${kind === 'full' ? text('全体', 'Full') : kind === 'db' ? 'DB' : kind} ${count}`).join(' / ')
    || text('保持設定を取得できません', 'Retention unavailable');
}
