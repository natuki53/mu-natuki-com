import test from 'node:test';
import assert from 'node:assert/strict';
import { logEmptyMessage } from '../src/scripts/admin-log-context.js';

test('empty warning logs explain missing targets, disabled collection, and retention separately', () => {
  const service={id:'docker.web',state:'unknown',logsEnabled:false};
  const data={hosts:[{hostId:'intel',services:[service]}]};
  const filters={host:'intel',service:'docker.web'};
  assert.match(logEmptyMessage(data,filters,(ja)=>ja),/検出できない/);
  service.state='stopped';
  assert.match(logEmptyMessage(data,filters,(ja)=>ja),/収集の対象外/);
  service.logsEnabled=true;
  assert.match(logEmptyMessage(data,filters,(ja)=>ja),/選択期間に保存されたログはありません/);
  data.collectionStatus=[{hostId:'intel',logSources:[{serviceId:'docker.web',status:'error'}]}];
  assert.match(logEmptyMessage(data,filters,(ja)=>ja),/収集に失敗/);
  data.hosts.push({hostId:'ryzen',services:[{...service}]});
  assert.doesNotMatch(logEmptyMessage(data,{...filters,host:''},(ja)=>ja),/検出できない/);
});
