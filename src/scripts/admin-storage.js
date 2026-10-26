export function renderDiskInventory(host, { text, esc, formatBytes }) {
  const priority = { ssd: 0, nvme: 0, hdd: 1, usb: 2, optical: 3, unknown: 4 };
  const disks = [...(host.physicalDisks || [])].sort((a, b) => (priority[a.kind] ?? 4) - (priority[b.kind] ?? 4));
  const status = host.diskInventoryStatus || 'unknown';
  if (status !== 'ok') {
    return `<p class="ops-inline-warning">${status === 'error'
      ? text('ディスク一覧を取得できません。情報収集処理を確認してください。', 'Disk inventory is unavailable. Check the collector.')
      : text('全ディスクの情報はまだ届いていません。', 'Waiting for a complete disk inventory.')}</p>`;
  }
  const kindLabels = { ssd: 'SSD', hdd: 'HDD', nvme: 'NVMe SSD', usb: text('USBストレージ', 'USB storage'), optical: text('光学ドライブ', 'Optical drive'), unknown: text('種類未確認', 'Unknown media') };
  const capacity = (volume) => {
    if (!volume.mounted) {
      return `<p class="ops-volume-note">${volume.container
        ? text('構成領域 — 使用量は配下の論理ボリュームで表示', 'Container — usage is shown on its logical volumes')
        : volume.filesystem === 'swap' ? text('スワップ領域', 'Swap space')
          : text('未マウント — 使用量・空き容量は未取得', 'Unmounted — usage and free space are unknown')}</p>`;
    }
    const known = volume.totalBytes > 0 && volume.usedBytes != null;
    return `${known ? `<meter min="0" max="100" value="${Math.min(100, volume.usedBytes / volume.totalBytes * 100)}" aria-label="${esc(volume.device)} ${text('使用率', 'usage')}"></meter>` : ''}
      <div class="ops-volume-capacity"><span>${text('使用', 'Used')} <strong>${formatBytes(volume.usedBytes)}</strong> / ${formatBytes(volume.totalBytes)}</span><span>${text('空き', 'Free')} <strong>${formatBytes(volume.freeBytes)}</strong></span></div>
      ${!known ? `<p class="ops-volume-note">${text('マウント済みですが容量情報を取得できません。', 'Mounted, but filesystem usage is unavailable.')}</p>` : ''}`;
  };
  return `<div class="ops-storage-heading"><h4>${text('接続されているディスク', 'Attached disks')}</h4><span>${disks.length} ${text('台', 'devices')}</span></div>
    <p class="ops-meta">${text('ディスク本体の容量と、保存領域の使用量を表示。共有する論理ボリュームは合算しません。', 'Device capacities and filesystem usage. Shared logical volumes are not added together.')}</p>
    <div class="ops-physical-grid">${disks.map((disk) => `<section class="ops-physical-disk" data-disk-kind="${esc(disk.kind)}">
      <div class="ops-physical-title"><div class="ops-drive-name"><i data-lucide="${disk.kind === 'usb' ? 'usb' : disk.kind === 'optical' ? 'disc-3' : 'hard-drive'}" aria-hidden="true"></i><div><span class="ops-drive-type">${esc(kindLabels[disk.kind] || kindLabels.unknown)}</span><h5>${esc(disk.model || disk.device)}</h5></div></div><div class="ops-drive-size"><strong>${formatBytes(disk.kind === 'optical' && !disk.volumes.length ? null : disk.sizeBytes)}</strong><span>${disk.kind === 'optical' ? text('媒体容量', 'Media capacity') : text('本体容量', 'Device capacity')}</span></div></div>
      <p class="ops-meta"><code>${esc(disk.device)}</code>${disk.transport ? ` · ${esc(disk.transport.toUpperCase())}` : ''}${disk.removable ? ` · ${text('取り外し可能', 'Removable')}` : ''}</p>
      <div class="ops-volumes">${disk.volumes.length ? disk.volumes.map((volume) => `<div class="ops-volume"><div class="ops-volume-heading"><code>${esc(volume.device)}</code><span>${esc(volume.filesystem || volume.kind)} · ${formatBytes(volume.sizeBytes)}</span></div>
        ${volume.label ? `<p class="ops-volume-label">${esc(volume.label)}</p>` : ''}
        <p class="ops-mountpoints">${volume.mountpoints.map((mountpoint) => `<code>${esc(mountpoint)}</code>`).join(' ')}</p>
        ${capacity(volume)}${volume.shared ? `<p class="ops-volume-note">${text('複数の物理ディスクが共有する論理ボリューム', 'Logical volume shared across physical disks')}</p>` : ''}</div>`).join('')
        : `<p class="ops-volume-note">${text('パーティション・ファイルシステムなし／未取得', 'No partition or filesystem information available')}</p>`}</div>
    </section>`).join('') || `<p class="ops-empty">${text('検出されたディスクはありません。', 'No block disks were detected.')}</p>`}</div>`;
}
