export function selectedLogService(data, filters) {
  const hosts = data.hosts.filter((h) => filters.host ? h.hostId === filters.host : h.services.some((s) => s.id === filters.service));
  const host = hosts.length === 1 ? hosts[0] : undefined;
  return { host, service: host?.services.find((s) => s.id === filters.service) };
}

export function logEmptyMessage(data, filters, text) {
  const { host, service } = selectedLogService(data, filters);
  if (filters.service && ((filters.host && !service) || service?.state === 'unknown')) return text('このサービスを検出できないため、ログを取得できません。対象名と収集結果を確認してください。', 'This service was not detected, so its logs are unavailable. Check the target name and observation.');
  if (service && !service.logsEnabled) return text('このサービスはログ収集の対象外です。稼働状態の監視結果は上に表示しています。', 'Log collection is not enabled for this service. Its observed state is shown above.');
  const source = data.collectionStatus?.find((s) => s.hostId === host?.hostId)?.logSources?.find((s) => s.serviceId === filters.service);
  if (service?.logStatus === 'error' || source?.status === 'error') return text('対象サービスのログ収集に失敗しています。収集権限とサービスの状態を確認してください。', 'Collection of this service’s logs failed. Check permissions and service state.');
  return text('選択期間に保存されたログはありません。停止前のログが保持期間外、または収集開始前の場合もあります。', 'No saved logs in the selected period. Earlier logs may predate collection or the retention window.');
}
