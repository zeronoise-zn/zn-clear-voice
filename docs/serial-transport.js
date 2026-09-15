import { UpdateError } from './znfw.js';
import { decodeFrame, response, frame, ERRORS, CMD } from './zn-protocol.js';
const commandName = id => Object.keys(CMD).find(name => CMD[name] === id) || `CMD_${id}`;

// One reader for the port lifetime. USB read boundaries never delimit messages.
export class SerialTransport {
  constructor(port, onDisconnect = () => {}, trace = () => {}, baudRate = 230400) {
    this.port = port; this.onDisconnect = onDisconnect; this.mode = 'text';
    this.buffer = []; this.pending = null; this.sequence = 1; this.connected = false;
    this.trace = trace; this.baudRate = baudRate;
  }
  async open() {
    if (this.connected) return;
    try { await this.port.open({ baudRate: this.baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 }); }
    catch (e) { throw new UpdateError('SERIAL_OPEN_FAILED', `${e.message} Close other serial tools and reconnect.`); }
    this.connected = true; this.closing = false;
    this.trace('EVENT', `Serial opened: ${this.baudRate} 8N1`);
    this.reader = this.port.readable.getReader(); this.writer = this.port.writable.getWriter();
    this.readTask = this.readLoop();
  }
  async reopenAt(baudRate) {
    if (!Number.isInteger(baudRate) || baudRate <= 0) throw new UpdateError('SERIAL_OPEN_FAILED', 'Invalid baud rate.');
    if (this.pending) throw new UpdateError('BUSY', 'Cannot change baud rate while a request is outstanding.');
    if (this.connected || this.reader || this.writer) await this.close();
    this.baudRate = baudRate;
    this.modeSet('text');
    this.trace('EVENT', `Serial baud switch: ${baudRate}`);
    await this.open();
  }
  modeSet(mode) { this.mode = mode; this.buffer = []; this.discard = false; }
  fail(error) {
    this.trace('EVENT', `Serial disconnected/error: ${error.message}`);
    this.connected = false; this.pending?.reject(error); this.onDisconnect(error);
  }
  async readLoop() {
    try {
      while (!this.closing) {
        const { value, done } = await this.reader.read();
        if (done) { if (!this.closing) this.fail(new UpdateError('SERIAL_DISCONNECTED')); break; }
        this.ingest(value);
      }
    } catch (e) { if (!this.closing) this.fail(new UpdateError('SERIAL_DISCONNECTED', e.message)); }
    finally { this.reader.releaseLock(); }
  }
  ingest(bytes) {
    for (const b of bytes) {
      const delimiter = this.mode === 'binary' ? 0 : 10;
      if (b === delimiter) {
        const data = Uint8Array.from(this.buffer); this.buffer = [];
        if (!this.discard && data.length) {
          try {
            const item = this.mode === 'binary' ? response(decodeFrame(data)) : new TextDecoder().decode(data);
            this.trace('RX', this.mode === 'binary' ? `${item.command === 255 ? 'NACK' : 'ACK'} ${commandName(item.request)} seq=${item.sequence} status=${item.status}/${ERRORS[item.status] || 'UNKNOWN'} state=${item.state} offset=${item.offset} length=${item.payload.length}` : item);
            if (this.pending?.predicate(item)) this.pending.resolve(item);
          } catch { this.trace('RX', `Invalid ${this.mode} frame (${data.length} bytes), discarded`); }
        }
        this.discard = false;
      } else if (!this.discard) {
        this.buffer.push(b);
        if (this.buffer.length > (this.mode === 'binary' ? 1043 : 2048)) { this.buffer = []; this.discard = true; }
      }
    }
  }
  async write(bytes) {
    if (!this.connected) throw new UpdateError('SERIAL_NOT_CONNECTED');
    let timer;
    try {
      await Promise.race([this.writer.write(bytes), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new UpdateError('SERIAL_DISCONNECTED', 'Serial write stalled. Reconnect before retrying.')), 10000);
      })]);
    } catch (e) { this.fail(e); throw e; }
    finally { clearTimeout(timer); }
  }
  async exchange(bytes, predicate, timeout) {
    if (this.pending) throw new UpdateError('BUSY', 'Only one request may be outstanding.');
    let timer;
    const result = new Promise((resolve, reject) => {
      const finish = fn => value => { clearTimeout(timer); this.pending = null; fn(value); };
      this.pending = { predicate, resolve: finish(resolve), reject: finish(reject) };
      timer = setTimeout(() => this.pending?.reject(new UpdateError('TRANSFER_TIMEOUT')), timeout);
    });
    // Attach before awaiting write, so disconnect/timeout cannot create an unhandled rejection.
    result.catch(() => {});
    try { await this.write(bytes); return await result; }
    catch (e) { this.pending?.reject(e); throw e; }
    finally { clearTimeout(timer); }
  }
  async text(command, predicate, timeout = 1800) {
    // Application console is always 230400. After a recovery session the same
    // granted Web Serial port may still be open at the legacy 115200 rate.
    // Switch back before querying application/runtime state; no permission
    // prompt is required because the SerialPort object is unchanged.
    if ((command.includes('ZN_INFO?') || command.includes('ZN_STATS?')) && this.baudRate !== 230400)
      await this.reopenAt(230400);
    this.trace('TX', command.replace(/\n/g,'\\n'));
    this.modeSet('text'); return this.exchange(new TextEncoder().encode(command), predicate, timeout);
  }
  async request(command, payload = new Uint8Array(), { timeout = 3000, retries = 2, sequence = this.sequence } = {}) {
    const bytes = frame(command, sequence, payload);
    this.modeSet('binary');
    for (let attempt = 0; ; attempt++) {
      try {
        const offset = command === CMD.DATA && payload.length >= 4 ? new DataView(payload.buffer,payload.byteOffset).getUint32(0,true) : null;
        this.trace('TX', `${commandName(command)} seq=${sequence} bytes=${payload.length}${offset === null ? '' : ` offset=${offset}`} attempt=${attempt+1}`);
        const r = await this.exchange(bytes, r => r.sequence === sequence && r.request === command &&
          (r.command === (command | 0x80) || r.command === 255), timeout);
        // Locally generated version/declared length are valid. LENGTH here is
        // command-level and consumes sequence; version/sequence failures do not.
        if (![1,7,21].includes(r.status)) this.sequence = (sequence + 1) & 65535;
        if (r.command === 255 || r.status) {
          const code = r.status === 8 ? 'OFFSET_ERROR' : r.status === 15 ? 'SIGNATURE_REJECTED' :
            r.status === 14 ? 'VERIFY_FAILED' : 'PROTOCOL_NACK';
          const error = new UpdateError(code, `${ERRORS[r.status] || 'UNKNOWN'} (${r.status}), state=${r.state}, offset=${r.offset}`);
          error.response = r; throw error;
        }
        return r;
      } catch (e) {
        this.trace('EVENT', `${commandName(command)} seq=${sequence}: ${e.message}`);
        // No HELLO/query/other command between timeout and identical replay.
        if (e.code !== 'TRANSFER_TIMEOUT' || attempt >= retries || !this.connected) throw e;
      }
    }
  }
  async hello() {
    // Deployed v1.1.0 units use a 115200 recovery bootloader, while current
    // recovery builds use 230400. Probe both on the already-authorized port.
    const rates = [...new Set([this.baudRate, 115200, 230400])];
    let lastError = null;
    for (const baudRate of rates) {
      try {
        if (this.baudRate !== baudRate) await this.reopenAt(baudRate);
        this.modeSet('binary'); await this.write(new Uint8Array([0]));
        const r = await this.request(1, undefined, { sequence: 0, timeout: 1800, retries: 0 });
        this.sequence = 1;
        this.trace('EVENT', `Recovery detected: ${baudRate} 8N1`);
        return r;
      } catch (e) {
        lastError = e;
        if (e.code !== 'TRANSFER_TIMEOUT' && e.code !== 'SERIAL_DISCONNECTED' && e.code !== 'SERIAL_OPEN_FAILED') throw e;
      }
    }
    throw lastError || new UpdateError('TRANSFER_TIMEOUT', 'Recovery bootloader not detected at 115200 or 230400.');
  }
  async close() {
    this.trace('EVENT', 'Serial close requested');
    this.closing = true; this.connected = false;
    this.pending?.reject(new UpdateError('SERIAL_DISCONNECTED'));
    try { await this.reader?.cancel(); } catch { /* Removed device. */ }
    await this.readTask;
    try { await this.writer?.abort(); } catch { /* Removed device. */ }
    try { this.writer?.releaseLock(); } catch { /* Already released. */ }
    try { await this.port.close(); } catch { /* Already closed/removed. */ }
    this.reader = this.writer = this.readTask = null;
  }
}
