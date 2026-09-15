import { UpdateError } from './znfw.js';
import { CMD, chunks, parseHello, parseBootInfo, parseStatus, checkTarget } from './zn-protocol.js';

export const BUSY = new Set(['CONNECTING','ENTERING_BOOTLOADER','WAITING_BOOTLOADER','BEGIN_UPDATE','SENDING','TRANSFER_COMPLETE','VERIFYING','FINALIZING','WAITING_FOR_APPLICATION','VERIFYING_INSTALLED_VERSION','WAITING_BOOT_CONFIRM','DIAGNOSING','ABORTING']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function appInfo(line) {
  try {
    const o = JSON.parse(line);
    if (o.product !== 'ClearVoice' || !/^REV\d\d$/.test(o.hardware) || !/^\d+\.\d+\.\d+\.\d+$/.test(o.firmware) ||
        !/^[a-f0-9]{40,64}$/i.test(o.git) || ![0,1].includes(o.dirty) || ![0,1].includes(o.shallow)) return null;
    return { ...o, version: o.firmware, mode: 'application',
      displayId: `${o.firmware}-${o.git.slice(0,12)}${o.dirty ? '-dirty' : ''}` };
  } catch { return null; }
}
export function runtimeInfo(line) {
  const m = /^\[RUNTIME\] STATUS=(RUNNING|STARTUP|FAULT) FAULT=([A-Z_0-9]+) CODE=(\d+) AUDIO_BLOCKS=(\d+) CONFIRMED=([01]) UART_ERRORS=0x([A-Fa-f0-9]+)$/.exec(line);
  return m ? {status:m[1],fault:m[2],code:Number(m[3]),audioBlocks:Number(m[4]),confirmed:m[5] === '1',uartErrors:parseInt(m[6],16)} : null;
}
// Optional R4E visibility only. These strings never authorize COMPLETE or change
// the legacy runtime predicate. Unknown/missing values remain verbatim.
export function diagnosticLine(line) {
  const match = /^\[(BOOT_DIAG|HEALTH|SAI|RESET)\] (.+)$/.exec(line);
  if (!match) return null;
  const fields = {};
  for (const token of match[2].split(' ')) {
    const pair = /^([A-Z][A-Z0-9_]*)=(\S+)$/.exec(token);
    if (!pair || Object.hasOwn(fields,pair[1])) return null;
    fields[pair[1]] = pair[2];
  }
  return {section:match[1],fields};
}
export function matchInstalled(pkg, info) {
  const id = pkg.identity;
  if (!id) throw new UpdateError('PACKAGE_IDENTITY_UNKNOWN', 'Current compiled identity ABI was not uniquely recognized.');
  if (info.version !== id.version || info.git !== id.git || info.hardware !== id.hardware || info.dirty !== id.dirty || info.shallow !== id.shallow)
    throw new UpdateError('INSTALLED_IDENTITY_MISMATCH', `Device ${info.displayId}; expected ${id.buildId}. Possible fallback/rollback.`);
}
export class FirmwareUpdater {
  constructor(io, notify = () => {}, { bootTimeout = 20000, resetTimeout = 45000, sleep = pause } = {}) {
    this.io = io; this.notify = notify; this.state = 'IDLE'; this.bootTimeout = bootTimeout;
    this.resetTimeout = resetTimeout; this.sleep = sleep; this.cancelRequested = false;
    this.endAccepted = false;
  }
  get busy() { return BUSY.has(this.state); }
  set(state, detail = {}) { this.state = state; this.notify({ state, ...detail }); }
  cancel() { if (['BEGIN_UPDATE','SENDING'].includes(this.state)) this.cancelRequested = true; }
  async queryApp() {
    const line = await this.io.text('\nZN_INFO?\n', line => !!appInfo(line));
    return appInfo(line);
  }
  async queryRuntime() {
    return runtimeInfo(await this.io.text('\nZN_STATS?\n', line => !!runtimeInfo(line), 2500));
  }
  async bootInfo() {
    parseHello(await this.io.hello());
    this.info = parseBootInfo(await this.io.request(CMD.INFO));
    const status = parseStatus(await this.io.request(CMD.STATUS));
    this.bootState = status.state;
    this.diagnostics = {info:this.info, status:{state:status.state,lastError:status.lastError,offset:status.offset,
      imageSize:status.imageSize,nextSequence:status.nextSequence,activeSlot:status.activeSlot,targetSlot:status.targetSlot},
      notExposed:['metadata per slot','attempt count','confirmed/rejected tokens','reset cause','image identity per slot','last boot-selection failure']};
    this.notify({state:this.state,diagnostics:this.diagnostics});
    return this.info;
  }
  async connect(expectedPackage = null, endAccepted = false) {
    if (this.busy) throw new UpdateError('BUSY');
    this.set('CONNECTING');
    this.endAccepted = endAccepted;
    try {
      await this.io.open();
      try { this.info = await this.queryApp(); }
      catch (e) { if (!this.io.connected) throw e; this.info = await this.bootInfo(); }
      if (expectedPackage && this.info.mode === 'bootloader') {
        this.set('FAILED_RECOVERY', {info:this.info,error:new UpdateError('APPLICATION_DID_NOT_START', 'Device returned to recovery mode.'),bootState:this.bootState});
        return this.info;
      }
      if (expectedPackage) return await this.waitForApplication(expectedPackage, Date.now()+this.resetTimeout);
      this.set('CONNECTED', { info: this.info, bootState: this.bootState }); return this.info;
    } catch (e) { this.set('FAILED', { error: e }); throw e; }
  }
  async reopen() {
    if (!this.io.connected) { await this.io.close(); await this.io.open(); }
  }
  async enterBoot() {
    if (this.info?.mode === 'bootloader') { this.set('WAITING_BOOTLOADER'); await this.bootInfo(); return; }
    this.set('ENTERING_BOOTLOADER');
    try { await this.io.text('ZN_BOOT\n', line => line === 'ZN_BOOT_ACK', 3500); }
    catch (e) {
      if (!['TRANSFER_TIMEOUT','SERIAL_DISCONNECTED'].includes(e.code)) throw e;
      // ACK can be lost; only a validated binary HELLO will establish recovery.
    }
    this.set('WAITING_BOOTLOADER');
    const until = Date.now() + this.bootTimeout;
    while (Date.now() < until) {
      try { await this.reopen(); await this.bootInfo(); return; }
      catch (e) { if (!['TRANSFER_TIMEOUT','SERIAL_DISCONNECTED','SERIAL_OPEN_FAILED'].includes(e.code)) throw e; }
      await this.sleep(300);
    }
    throw new UpdateError('BOOTLOADER_TIMEOUT', 'Reconnect and detect recovery before retrying.');
  }
  async abort() {
    if (this.busy && this.state !== 'ABORTING') { this.cancel(); return; }
    this.set('ABORTING');
    try {
      const r = await this.io.request(CMD.ABORT);
      this.bootState = r.state; this.set('ABORTED');
    } catch (e) {
      if (e.response) this.bootState = e.response.state;
      this.set('FAILED', { error: e, bootState: this.bootState }); throw e;
    }
  }
  async run(pkg) {
    if (this.busy) throw new UpdateError('BUSY');
    if (!this.io.connected) throw new UpdateError('SERIAL_NOT_CONNECTED');
    if (!pkg.identity) throw new UpdateError('PACKAGE_IDENTITY_UNKNOWN', 'Cannot verify the installed build identity; update not started.');
    this.cancelRequested = false;
    this.endAccepted = false;
    try {
      await this.enterBoot(); checkTarget(pkg, this.info);
      if (this.bootState === 3 || this.bootState === 4) throw new UpdateError('RECOVERY_TRANSACTION', 'Abort the interrupted transfer explicitly before starting again.');
      if (this.bootState === 5) throw new UpdateError('PENDING_INSTALL', 'A package is already committed. Restart the device; ABORT cannot roll it back.');
      this.set('BEGIN_UPDATE');
      const begin = await this.io.request(CMD.BEGIN, pkg.header, { timeout: 60000 });
      if (begin.state !== 3 || begin.offset !== 0) throw new UpdateError('OFFSET_ERROR', 'Unexpected BEGIN response');
      this.bootState = 3;
      for (const chunk of chunks(pkg.payload)) {
        if (this.cancelRequested) { this.set('ABORTING'); await this.abort(); return; }
        this.set('SENDING', { offset: chunk.offset, total: pkg.imageSize });
        const r = await this.io.request(CMD.DATA, chunk.data, { timeout: 10000 });
        if (r.offset !== chunk.end || r.state !== 3) throw new UpdateError('OFFSET_ERROR', `Expected ${chunk.end}, received ${r.offset}`);
        this.set('SENDING', { offset: r.offset, total: pkg.imageSize });
      }
      if (this.cancelRequested) { this.set('ABORTING'); await this.abort(); return; }
      this.set('TRANSFER_COMPLETE', {offset:pkg.imageSize,total:pkg.imageSize});
      this.set('VERIFYING');
      const end = await this.io.request(CMD.END, undefined, { timeout: 60000 });
      if (end.state !== 5 || end.offset !== pkg.imageSize) throw new UpdateError('VERIFY_FAILED', 'END did not confirm durable pending metadata.');
      this.endAccepted = true; this.bootState = 5; this.set('FINALIZING');
      await this.restart(pkg);
    } catch (e) {
      if (e.response) this.bootState = e.response.state;
      this.set(e.code === 'APPLICATION_DID_NOT_START' ? 'FAILED_RECOVERY' : 'FAILED', { error: e, info:this.info, bootState: this.bootState }); throw e;
    }
  }
  async restart(pkg = null) {
    if (this.busy && this.state !== 'FINALIZING') throw new UpdateError('BUSY');
    this.set('WAITING_FOR_APPLICATION');
    try {
      try { await this.io.request(CMD.REBOOT, undefined, { timeout: 3000, retries: 0 }); }
      catch (e) { if (!['TRANSFER_TIMEOUT','SERIAL_DISCONNECTED'].includes(e.code)) throw e; }
      return await this.waitForApplication(pkg, Date.now()+this.resetTimeout);
    } catch (e) {
      this.set(e.code === 'APPLICATION_DID_NOT_START' ? 'FAILED_RECOVERY' : 'FAILED', {error:e,info:this.info,bootState:this.bootState}); throw e;
    }
  }
  async waitForApplication(pkg, until) {
    let observed = false;
    while (Date.now() < until) {
      try {
        await this.reopen(); const info = await this.queryApp();
        observed = true; this.info = info; this.bootState = null;
        this.set('VERIFYING_INSTALLED_VERSION', {info});
        if (pkg) matchInstalled(pkg, info);
        this.set('WAITING_BOOT_CONFIRM', {info});
        const runtime = await this.queryRuntime();
        this.notify({state:this.state,runtime});
        if (runtime.status === 'FAULT' || runtime.code || runtime.uartErrors)
          throw new UpdateError('APPLICATION_HEALTH_FAILED', JSON.stringify(runtime));
        if (runtime.confirmed && runtime.status === 'RUNNING' && runtime.fault === 'OK') {
          const finalInfo = await this.queryApp();
          if (pkg) matchInstalled(pkg, finalInfo);
          this.info = finalInfo;
          this.set(pkg && this.endAccepted ? 'COMPLETE' : 'CONNECTED', {info:finalInfo,runtime,
            notice:pkg && !this.endAccepted ? 'Application confirmed, but this session has no accepted END evidence.' : ''}); return finalInfo;
        }
      } catch (e) {
        if (!['TRANSFER_TIMEOUT','SERIAL_DISCONNECTED','SERIAL_OPEN_FAILED'].includes(e.code)) throw e;
        if (this.io.connected) {
          try {
            await this.bootInfo();
          } catch (probeError) {
            if (!['TRANSFER_TIMEOUT','SERIAL_DISCONNECTED','SERIAL_OPEN_FAILED'].includes(probeError.code)) throw probeError;
            await this.sleep(500); continue;
          }
          throw new UpdateError('APPLICATION_DID_NOT_START', `${observed ? 'Application was observed, then ' : ''}device returned to recovery mode.`);
        }
      }
      await this.sleep(500);
    }
    throw new UpdateError(observed ? 'BOOTCONFIRM_TIMEOUT' : 'DEVICE_RESET_TIMEOUT', 'Update not confirmed. Read diagnostics; do not automatically reinstall.');
  }
  async readDiagnostics() {
    if (this.busy) throw new UpdateError('BUSY');
    this.set('DIAGNOSING');
    try {
      let info;
      try { info = await this.queryApp(); }
      catch (e) {
        if (!['TRANSFER_TIMEOUT'].includes(e.code)) throw e;
        await this.bootInfo();
        this.set('FAILED_RECOVERY', {info:this.info,bootState:this.bootState,error:new UpdateError('APPLICATION_DID_NOT_START','Device is in recovery mode.')});
        return this.diagnostics;
      }
      this.info = info;
      const runtime = await this.queryRuntime();
      this.set('CONNECTED', {info,runtime}); return {info,runtime};
    } catch (e) { this.set('FAILED', {error:e}); throw e; }
  }
}
