import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPackage, PRODUCT, versionForms } from '../docs/znfw.js';
import { appInfo } from '../docs/fw-updater.js';

const text = s => new TextEncoder().encode(s);
const git = '0123456789abcdef0123456789abcdef01234567';

async function fixture({major=1,minor=2,patch=0,build=88,publicVersion='1.2.88'}={}) {
  const bytes = new Uint8Array(128 + 2052), view = new DataView(bytes.buffer);
  bytes.set(text('ZNFW'));
  view.setUint16(4,1,true); view.setUint16(6,128,true); view.setUint32(8,PRODUCT,true);
  view.setUint32(12,1,true);
  [major,minor,patch,build].forEach((n,i) => view.setUint16(16+i*2,n,true));
  view.setUint32(24,2052,true); view.setUint32(28,0x01000000,true);
  bytes.fill(42,64,128);
  view.setUint32(128,0x20020000,true); view.setUint32(132,0x080081e1,true);

  const object = 128+600;
  [major,minor,patch,build].forEach((n,i) => view.setUint16(object+i*2,n,true));
  view.setUint32(object+8,1,true); bytes[object+12]=1;
  [640,680,750,850].forEach((offset,i) => view.setUint32(object+16+i*4,0x08008000+offset,true));
  const buildId=`${publicVersion}-${git.slice(0,12)}`;
  [publicVersion,git,buildId,'REV01'].forEach((s,i) => bytes.set(text(s+'\0'),128+[640,680,750,850][i]));
  const hash = await crypto.subtle.digest('SHA-256',bytes.subarray(128));
  bytes.set(new Uint8Array(hash),32);
  return bytes;
}

test('compact release maps to unchanged four-field ZNFW header', () => {
  const forms=versionForms('1.2.0.88');
  assert.deepEqual(forms.parts,[1,2,0,88]);
  assert.equal(forms.legacy,'1.2.0.88');
  assert.equal(forms.compact,'1.2.88');
});

test('ZNFW parser accepts compact identity with legacy-compatible header tuple', async () => {
  const pkg=await inspectPackage((await fixture()).buffer,'ClearVoice_1.2.88_PROD.znfw');
  assert.equal(pkg.headerVersion,'1.2.0.88');
  assert.equal(pkg.version,'1.2.88');
  assert.equal(pkg.identity.version,'1.2.88');
  assert.equal(pkg.identity.headerVersion,'1.2.0.88');
});

test('legacy four-part package identity remains accepted', async () => {
  const pkg=await inspectPackage((await fixture({minor:1,build:76,publicVersion:'1.1.0.76'})).buffer,'ClearVoice_1.1.0.76_PROD.znfw');
  assert.equal(pkg.headerVersion,'1.1.0.76');
  assert.equal(pkg.version,'1.1.0.76');
});

test('application identity accepts both public version formats', () => {
  const base={product:'ClearVoice',hardware:'REV01',git,dirty:0,shallow:0};
  assert.equal(appInfo(JSON.stringify({...base,firmware:'1.2.88'})).version,'1.2.88');
  assert.equal(appInfo(JSON.stringify({...base,firmware:'1.1.0.76'})).version,'1.1.0.76');
  assert.equal(appInfo(JSON.stringify({...base,firmware:'1.2'})),null);
  assert.equal(appInfo(JSON.stringify({...base,firmware:'1.2.88.1.2'})),null);
});
