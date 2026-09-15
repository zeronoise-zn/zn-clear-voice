# Authenticated ClearVoice firmware updater

WEB-01 replaces the former STM32 ROM/raw-BIN updater inside the existing page.
The HTML layout, branding, external links, languages, responsive styles and
release selector remain. There is one serial owner and one update controller.
This tool does not update RTX/FL7. It installs the STM32 application package.

## Start and browser support

From the repository root:

```powershell
py -m http.server 8080 -d docs
```

Open `http://localhost:8080` in desktop Chrome or Edge on Windows. Deployment
requires HTTPS; localhost is the secure-context development exception. Web
Serial and Web Crypto must be available. A serial permission prompt appears only
when Connect is clicked. Close other tools holding the FT234XD port first.
Web Serial does not expose the Windows COM name; the page reports USB serial
device. Branding images continue to use the original external Racing Force URLs.
No localhost or machine filesystem path is required by application code.

Browser Windows -> Web Serial -> USB -> FT234XD -> PA2/PA3 USART2 -> ClearVoice
bootloader, always 230400, 8 data bits, no parity, 1 stop bit, no flow control.
`docs/app.js` declares `appBaudRate` and `bootBaudRate` as 230400. The transport
opens at `appBaudRate` and retains it across application/recovery transitions;
both settings must remain equal. Standalone transport instances default to 230400.
There is no ST-Link, STM32 ROM sync, raw-address write, mass erase or raw BIN path.

Web Serial lifecycle reference: https://developer.chrome.com/docs/capabilities/serial
A continuous bounded read loop owns one reader; timeout affects only a waiter,
not a competing reader.read(). Explicit disconnect cancels the reader, releases
locks and closes the port. Cable/read/write failures invalidate the connection.
No DTR/RTS reset assumption or second UART owner is introduced.

## Sources of truth

Firmware source reviewed against commit `11a737c9361307cc9e7c1b6d470dd7a128f1ac65`:

- `docs/bootloader/UPDATE_PROTOCOL.md`, `ZNFW_FORMAT.md`, `APPLICATION_INTEGRATION.md`.
- `Bootloader/Inc/zn_update_protocol.h`, `zn_product.h`, `zn_boot_layout.h`.
- `Bootloader/Src/zn_update_codec.c`, `zn_update_protocol.c`, `zn_update_engine.c`.
- `Bootloader/Src/zn_crypto.c`, `zn_boot_core.c`, `zn_boot_main.c`, `zn_boot_handoff.c/.S`.
- `Core/Src/zn_app_console.c`, `zn_boot_request.c` and runtime/board safety sources.

Some historical firmware documentation still says production key pending.
Current code and actual GET_INFO capability/key flags govern this client.
No protocol is inferred from the old web documentation or the signer output.

## ZNFW128 inspection

Only filenames ending in `.znfw` are accepted. The page shows filename, total
size, complete package SHA256, payload size/hash, product, version, hardware
mask and minimum bootloader. Exactly one ArrayBuffer is retained; header and
payload are subarray views. A bounded chunk is allocated for each request.

All scalar fields are little endian:

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII ZNFW |
| 4 | 2 | format version 1 |
| 6 | 2 | header size 128 |
| 8 | 4 | product 0x48575643, CVWH / ClearVoice |
| 12 | 4 | hardware mask, REV01 bit 0 |
| 16,18,20,22 | 2 each | firmware major/minor/patch/build |
| 24 | 4 | payload length |
| 28 | 4 | semantic minimum bootloader, major:8/minor:8/patch:16 |
| 32 | 32 | payload SHA256 |
| 64 | 64 | Ed25519 signature |
| 128 | payload length | application image linked at 0x08008000 |

No flags or reserved bytes exist in ZNFW128 v1. Require exact file length,
nonzero HW mask, correct product, image 472..227328 bytes, matching Web Crypto
SHA256, valid MSP and 118 logical vectors. The browser rejects obvious empty
signature placeholders but does NOT verify Ed25519. Structure/hash VALID is not
an authenticity claim. BEGIN authenticates the header before any erase; END
rechecks complete payload hash, signature, vectors and constraints on device.
The bootloader is the final authority; no private key or signing code is used.

A size <=96256 fits the universal image-size threshold; this alone is not an
ELF-derived UNIVERSAL certification. GET_INFO supplies actual device capacity.
The R4 fixture's independently generated manifest certifies UNIVERSAL_256_512.

## Existing release selection

`firmware-manifest.json` remains empty until real releases are published.
Preserved release selection accepts only records with `format: "znfw"`, a
`.znfw` URL and a 64-hex-character package `sha256`. Other existing product files
elsewhere in this repository are not installable targets. A target also supplies
`product: "ClearVoice"`, `hardware` (e.g. `["REV01"]`), `version` and `changelog`.
There are no addresses or MCU ROM command IDs in the release contract.
Local files take precedence; release selection never overrides a selected file.
Same/older signed versions remain possible, subject to confirmation and device
acceptance. Version comparison is not an anti-rollback security policy.
Do not copy local production test packages into this repository.

## Entry and recovery

1. Connect opens 230400 8N1. Send LF + `ZN_INFO?` + LF to clear an old ASCII
   discard state and obtain the application JSON (product/hardware/firmware/git,
   dirty/shallow/flash_kb/bootloader compatibility contract).
2. If no application response arrives, send zero delimiter + HELLO seq0.
   A valid ACK must contain ZNBL/CVWH and the expected version/bounds. There is
   no unsolicited ASCII recovery banner. Read GET_INFO format2 and GET_STATUS.
3. Updating an application sends exact `ZN_BOOT\n`, waits for `ZN_BOOT_ACK\n`
   and then probes binary recovery. Application TC -> backup request ->
   NVIC_SystemReset is owned by firmware. Lost ASCII ACK alone is not success;
   only a valid HELLO establishes recovery. Baud/parity never change.
4. If the serial device transiently disappears, retry opening the same already
   authorized port within the entry/reset deadline. A fresh permission selection
   is never attempted automatically. On failure, use Connect explicitly.
5. Reconnecting does not resume by file offset. HELLO resets transport sync,
   not the transaction. RECEIVING requires explicit Abort before a new BEGIN;
   READY_TO_REBOOT requires Restart. No automatic destructive cleanup occurs.

GET_INFO checks format2/209 bytes, CVWH family, production key flag (reject TEST
or no-key), capabilities bits30/31, actual 256/512 geometry, HW mask, image
capacity and semantic minimum bootloader before BEGIN. No trust is placed in
an application compatibility string as the actual bootloader version.

## Binary transport

Raw frame: `[version:u8=1, command:u8, sequence:u16LE, length:u16LE, payload,
CRC32:u32LE]`, then COBS encoding and a zero delimiter. CRC32/ISO-HDLC covers
raw header+payload, reflected polynomial0xEDB88320, initial/final XOR0xffffffff.
Golden check: CRC("123456789")=0xcbf43926. HELLO seq0 wire bytes:
`03 01 01 01 01 01 05 b6 5b fe 47 00`.

| Command | ID | Request |
| --- | --- | --- |
| HELLO | 1 | empty, sequence0, preceded by zero |
| GET_INFO | 2 | empty |
| BEGIN_UPDATE | 3 | exact 128-byte package header |
| WRITE_DATA | 4 | relative offset LE32 +1024 image bytes, except final remainder |
| END_UPDATE | 5 | empty |
| GET_STATUS | 6 | empty |
| ABORT_UPDATE | 7 | empty |
| REBOOT | 8 | empty |

Max data1024, payload1028, raw1038, wire1044. Nonfinal short data chunks are
not allowed. Header goes in BEGIN, then all package payload bytes go in WRITE;
the package is transported according to the existing protocol, not as raw Flash
writes. Relative offsets are never hardware addresses. Browser progress uses
ACK next_offset, showing image bytes acknowledged; BEGIN accounts for header.

ACK command = request|0x80, NACK=0xff, sequence echoed. Both carry prefix8:
status LE16@0, engine state@2, original command@3, next image offset LE32@4.
One outstanding request only. Accepted requests consume sequence even on
command-level NACK. Unrelated sequence/command responses are ignored.

Retry ONLY on host response timeout, at most two identical raw/sequence retries,
without intervening HELLO/STATUS. This uses the last-request replay cache and
never deliberately reprograms the same doubleword. Lost END ACK is retried
identically. After reconnect/reset the cache is uncertain; do not claim resume.
Malformed or CRC-invalid responses are discarded within bounded accumulators.

Host timeouts (engineering settings, hardware qualification pending): query1800ms,
ASCII boot ACK3500ms, ordinary binary3000ms, DATA10000ms, BEGIN/END60000ms per
attempt, boot entry20000ms, post-reset application45000ms. Per-request work may
extend an outer deadline by one attempt. UART peripheral 10ms local waits are
not browser timeouts. Serial write stalls fail at10000ms.

END success must report state5/READY_TO_REBOOT and the final offset. It means
durable pending metadata, not confirmed boot. Send REBOOT explicitly; ACK TC
precedes reset. Lost REBOOT ACK is handled by looking for the application.
WEB-02 separates TRANSFER COMPLETE (all DATA acknowledged) from UPDATE COMPLETE.
After END state5 and explicit REBOOT, poll application ZN_INFO and ZN_STATS.
Require the full version, Git SHA, hardware, dirty and shallow identity to match
the package, then RUNTIME STATUS=RUNNING, FAULT=OK, CODE=0, UART_ERRORS=0 and
CONFIRMED=1, and finally recheck ZN_INFO. Only these observations plus accepted
END permit COMPLETE. This is not an independent bytewise readback or a guarantee
against a later hardware failure. An application response alone can precede
BootConfirm. Recovery after reboot is FAILED_RECOVERY / UPDATE NOT CONFIRMED.

The header has no Git SHA. The parser uniquely recognizes the current ARM32
clearvoice_identity_t ABI inside the hashed payload using bounded image-relative
pointers, version, full Git, hardware and build ID consistency. No filename or
fixed payload offset supplies identity. Missing/ambiguous identity blocks update
before device commands; future ABI changes require explicit parser support.
Accepted END evidence is retained only in this page session and for the same
SerialPort object. A different/uncertain port discards it; VID/PID cannot identify
an individual board and the current device protocol has no MCU unique ID.
Disconnect always clears the visible success status until the device is checked.

## State, abort and errors

UI controller state: IDLE, CONNECTING, CONNECTED, ENTERING_BOOTLOADER,
WAITING_BOOTLOADER, BEGIN_UPDATE, SENDING, TRANSFER_COMPLETE, VERIFYING, FINALIZING,
WAITING_FOR_APPLICATION, VERIFYING_INSTALLED_VERSION, WAITING_BOOT_CONFIRM,
COMPLETE, FAILED, FAILED_RECOVERY, DIAGNOSING, ABORTING, ABORTED. Package selection/inspection is separate
immutable data, with controls locked during inspection and transfer. Release
selector cannot enable an action while the controller is busy.

Abort during BEGIN/SENDING waits for the outstanding command response, then
sends ABORT. It cannot interrupt a synchronous erase/crypto operation. Once
VERIFYING starts the cancel action is disabled. ABORT after committed END
returns STATE6/READY_TO_REBOOT: display pending, never claim rollback. A timeout
or disconnect may leave a receiving or committed transaction; reconnect and
inspect it, rather than automatically starting again.

Device errors are preserved numerically:
0OK,1VERSION,2COMMAND,3LENGTH,4CRC,5COBS,6STATE,7SEQUENCE,8OFFSET,9SIZE,
10PRODUCT,11HARDWARE,12MIN_VERSION,13FLASH,14HASH,15SIGNATURE,16VECTOR,
17METADATA,18TARGET,19PENDING,20TIMEOUT,21SEQUENCE_CONFLICT,22INTERNAL,
23FRAME_TOO_LARGE,24UPDATE_ENGINE_NOT_AVAILABLE,25GEOMETRY,26UART_RX,
27UART_TX_TIMEOUT. Error20 is allocated; Flash BSY timeout currently traps
rather than returning that NACK.

UI maps device8 to OFFSET_ERROR,14 to VERIFY_FAILED,15 to SIGNATURE_REJECTED;
others to PROTOCOL_NACK including numeric ID/state/offset. Local codes include
INVALID_ZNFW, INVALID_HEADER, PAYLOAD_HASH_MISMATCH, SERIAL_NOT_CONNECTED,
SERIAL_DISCONNECTED, SERIAL_OPEN_FAILED, BOOTLOADER_TIMEOUT, TRANSFER_TIMEOUT,
DEVICE_RESET_TIMEOUT, PROTOCOL_MISMATCH, TARGET_MISMATCH and PROD_REQUIRED.
WEB-02 additionally distinguishes PACKAGE_IDENTITY_UNKNOWN,
INSTALLED_IDENTITY_MISMATCH, APPLICATION_HEALTH_FAILED, BOOTCONFIRM_TIMEOUT and
APPLICATION_DID_NOT_START. These are host diagnostics, not new firmware codes.
Local names are not invented firmware codes. Permission rejection and a busy
port leave update disabled and show the browser/open error.

## LTC_ENABLE power policy and reset limits

BOOTLOADER OWNS LTC_ENABLE HIGH. PB7 is asserted by ZN_POWER_HOLD_EARLY before
CRT/parity/recovery: enable GPIOB clock/readback, BSRR HIGH, push-pull/no-pull/
low-speed, then output MODER. No stack/HAL dependency. No later bootloader
BEGIN/DATA/END/ABORT/NACK/error/auth/metadata/handoff code releases PB7 or
resets/deinitializes GPIOB. Handoff preserves PB7. Application init preloads
HIGH before output init. ZN_BOOT ACK/TC/request/reset and RTX maintenance do
not run normal power-off; fatal AMP mute targets PA4 only. Normal application
shutdown/thermal has an intentional PB7 LOW outside this update policy.

Software cannot guarantee the electrical level during the physical reset GPIO
reset state. Reassertion is as early as software control permits. Measure PB7,
rail/reset transients and long recovery/update hold on hardware.

Watchdog clarification: direct CPU handoff preserves a running IWDG, whereas
ZN_BOOT invokes system reset. IWDG_SW=1 selects software start; an earlier
software start alone does not prove automatic restart after system reset.
Hardware IWDG option configuration can enable it automatically. The actual
option byte is not reported by the current protocol and must be checked in
hardware provisioning. Recovery contains no periodic feed; hardware auto-start
must not be assumed supported. No watchdog firmware change was made or proven
necessary for the software-start configuration. See ST's G4 clarification:
https://community.st.com/stm32-mcus-products-25/will-iwdg-stop-after-system-reset-before-next-time-initialization-if-option-byte-iwdg-sw-equal-true-166346

## Offline tests

Node.js 24 or another current Node with built-in Web Crypto, streams and test
runner; no npm dependencies or build step:

```powershell
npm test
# Optional full local-fixture and read-only firmware audit checks:
$env:ZNFW_TEST_FIXTURE = '<absolute path to the approved R4 .znfw>'
$env:STM32_SOURCE = '<absolute path to ClearvoicePUSTM32>'
npm test
```

The R4 fixture is never copied: expected82228 bytes, payload82100,
package SHA25667b319934bc2c237fb9fba108bc085f9458507afed8bc68c2140972a4f9060d2.
Tests cover invalid/truncated packages, payload hash, vectors, COBS/CRC golden,
chunks, fragmented/duplicate responses, retries, NACK, timeouts, disconnect,
abort, state reentrancy, END/REBOOT, wrong returned version, mock UI progress,
and PB7 source invariants. WEB-02 also covers unique compiled identity/full Git,
generic END rejection, an unconfirmed application returning to recovery,
healthy confirmation, diagnostics without mutation, stale success on reconnect,
and discarding END evidence when selecting another port. The mock UI is not a
graphical browser/HW test.

## Next single hardware update (requires separate authorization)

1. Confirm approved bootloader installation, device REV01/geometry/PROD trust,
   software-start watchdog option configuration and stable board power. Connect
   FT234XD; instrument PB7/rail/reset and USART2 if available. Close other COM users.
2. Serve/open the updated page and open Advanced / technical log. Connect, then
   Read diagnostics BEFORE updating. Export the timestamped log: validated HELLO,
   GET_INFO and GET_STATUS (or application ZN_INFO/ZN_STATS). Record active/target
   slot, volatile state/offset/error and boot identity. Metadata tokens, attempt
   count, per-slot image validity and bootloader reset cause are not exposed.
   Do not interpret 0xFF active slot as empty Flash. See [WEB-02 diagnosis](WEB02_DIAGNOSIS.md).
3. Select the approved signed R4 package from its external location. Verify
   82228 bytes and expected SHA256; no key/package copying to docs.
4. Perform ONE update. Record ZN_BOOT/ACK if starting in application (already
   recovery skips this reset), HELLO, BEGIN response, 81 DATA acknowledgements
   (80x1024 +180 final bytes), all NACKs/timeouts/retries, END response/state5/final
   offset82100 and REBOOT. Do not repeat the installation automatically.
5. Keep the cable connected. Capture the first response after reset, application
   ZN_INFO, ZN_STATS including any SYS reset flags/BAT lines and RUNTIME health,
   CONFIRMED transition and final full identity. The tool waits for confirmation;
   matching version alone is insufficient. Log disconnect/reopen if it occurs.
6. If recovery returns or confirmation times out, stop. Read diagnostics once
   and export the log; do not press Restart/Abort/Update to manufacture a result.
   Attempt count remains UNKNOWN unless obtained through separately authorized
   diagnostics. Reset flags, when SYS reports them, are latched and may combine
   causes. Preserve PB7/rail/reset measurements through the entire test.

The technical log records ISO timestamps, TX/RX ASCII, commands, sequence,
DATA offsets and ACK/NACK status/state/offset, disconnect and reopen. It does
not dump DATA contents. Export it before leaving the page (bounded to 512 KiB).
Read diagnostics sends queries only; it does not erase, install, abort or reboot.

## R4E optional BootConfirm visibility

Diagnostic application firmware adds BOOT_DIAG, HEALTH, SAI and RESET lines
before the unchanged RUNTIME response to ZN_STATS. The existing RX trace and
Advanced panel display their key/value fields verbatim. Each new ZN_STATS query
clears the previous optional snapshot to avoid mixing boots/queries. These
additional fields are visibility only, not new update-success criteria.
END accepted, full application identity match and observed healthy CONFIRMED=1
remain required. Older R4 firmware without these optional lines still works.

BOOT_CONFIRM_ATTEMPTED and BOOT_CONFIRM_RESULT distinguish NOT_CALLED from the
actual SUCCESS/ALREADY_CONFIRMED/NOT_PENDING/INVALID_METADATA/FLASH_ERROR/
INVALID_CONTEXT returns. Battery, RTX init/health age, telemetry, UART and SAI
errors explain the existing gate. META_VALID and HEALTH VALID qualify cached
data. BOOT_TRIAL describes entry admission, not a claim that a later confirmation
failed. Reset flags are captured/latched and can combine causes; they are not
necessarily a unique last-reset explanation. No additional Flash/I2C read or
watchdog feed is initiated by diagnostics.

For the next single diagnostic installation, use a separately authorized signed
clean diagnostic release: the existing R4 package lacks these fields. Keep USB
connected, export the log, capture confirmation or its blocker, then perform
one controlled normal MCU reset only after CONFIRMED=1. Do not use ZN_BOOT for
that persistence test: it explicitly requests recovery. If recovery returns,
read info/status once and stop without reinstalling. The Python diagnostics
tool can collect multiple one-second snapshots on one open port after the web
releases ownership; never open both tools on the same COM concurrently.

No real serial/HW operation was executed by WEB-01.
WEB-02 performed only the separately requested read-only recovery queries;
no update or reboot was executed. The next installation is still NOT_RUN.
