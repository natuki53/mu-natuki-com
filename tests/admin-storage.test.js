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

test('SSDs are first on the left without mutating the received disk inventory', () => {
  const physicalDisks=['hdd','optical','ssd','nvme','usb'].map((kind)=>({kind,device:kind,model:kind,sizeBytes:1000,volumes:[]}));
  const before=physicalDisks.map((d)=>d.kind);
  const html=renderDiskInventory({diskInventoryStatus:'ok',physicalDisks},helpers);
  assert.deepEqual([...html.matchAll(/data-disk-kind="([^"]+)"/g)].map((m)=>m[1]),['ssd','nvme','hdd','usb','optical']);
  assert.deepEqual(physicalDisks.map((d)=>d.kind),before);
});
