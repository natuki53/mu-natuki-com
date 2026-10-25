import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDiskInventory } from '../src/scripts/admin-storage.js';
const helpers = { text: (ja) => ja, esc: (v) => String(v).replaceAll('<', '&lt;').replaceAll('>', '&gt;'), formatBytes: (v) => v == null ? '—' : `${v} B` };

test('unmounted disks show unknown usage, never an empty usage meter', () => {
  const html = renderDiskInventory({diskInventoryStatus:'ok',physicalDisks:[{device:'/dev/sdc',kind:'usb',model:'USB <disk>',sizeBytes:1000,volumes:[{device:'/dev/sdc1',kind:'part',sizeBytes:1000,mountpoints:[],mounted:false}]}]}, helpers);
  assert.match(html,/未マウント/);
  assert.match(html,/USB &lt;disk&gt;/);
  assert(!html.includes('<meter'));
});
test('missing disk collection is not shown as zero devices', () => {
  const html = renderDiskInventory({diskInventoryStatus:'error',physicalDisks:[]}, helpers);
  assert.match(html,/取得できません/);
  assert(!html.includes('0 台'));
});
