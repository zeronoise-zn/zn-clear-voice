# ZeroNoise Clear Voice Web Updater Protocol

This document describes the application-side UART handshake expected by `docs/app.js` before the browser switches to the STM32 ROM bootloader protocol.

## Hardware target

- MCU: STM32G474CEU6
- USB/UART bridge: FT234XD-R
- Factory FTDI USB VID/PID: `0x0403 / 0x6015`
- Browser transport: Web Serial
- Application UART: `USART2`, `115200 8N1`
- STM32 ROM bootloader UART: autobaud synchronization followed by `8E1` (the web updater opens it at 115200 baud)
- STM32G47x/G48x bootloader PID: `0x469`

### Confirmed FT234XD / STM32 wiring

The Clear Voice PCB uses the USART2 pin mapping supported directly by the STM32G47x/G48x ROM bootloader:

```text
FT234XD TXD  -> STM32 PA3 / USART2_RX
FT234XD RXD  <- STM32 PA2 / USART2_TX
```

ST AN2606 explicitly lists PA3 as `USART2_RX` and PA2 as `USART2_TX` for the STM32G47xxx/48xxx system-memory bootloader. Therefore the existing FT234XD UART connection can be reused for firmware update; no second UART is required.

## Application commands

### Device information

Browser sends:

```text
ZN_INFO?\n
```

Recommended firmware response:

```json
{"product":"ClearVoice","hardware":"REV01","version":"1.02.03","serial":"ZN000123","mcu":"STM32G474CEU6"}
```

A key/value response is also accepted, for example:

```text
PRODUCT=ClearVoice
HW=REV01
FW=1.02.03
SERIAL=ZN000123
MCU=STM32G474CEU6
```

The response should be sent within 1 second.

### Enter STM32 system-memory bootloader

Browser sends:

```text
ZN_BOOT\n
```

The application should then transfer control to the STM32 system-memory bootloader.

For STM32G47x/G48x the system-memory bootloader starts at `0x1FFF0000`. ST AN2606 allows entering the bootloader by a software jump from user code. Before the jump the application must, at minimum:

1. Stop/de-initialize application peripherals.
2. Disable peripheral clocks that are in use.
3. Disable the PLL(s) used by the application.
4. Disable interrupts and clear pending interrupts.
5. Stop SysTick.
6. Remap system memory to `0x00000000` as required for dual-bank boot operation.
7. Load MSP from the system-memory vector table and branch to its reset handler.

The exact implementation must be validated on the production option-byte configuration. A hardware BOOT0 control is not required for the normal web-update path when the software jump is implemented correctly.

After the transition, the web updater:

1. Reopens the same FT234XD serial port as `115200 8E1`.
2. Sends bootloader synchronization byte `0x7F`.
3. Expects ACK `0x79`.
4. Issues `Get ID` and requires PID `0x469`.
5. Erases the flash region required by the firmware image.
6. Programs the firmware at `0x08000000` in blocks of up to 256 bytes.
7. Reads the programmed image back and byte-compares it.
8. Sends `GO 0x08000000`.

> Production note: avoid a full mass erase if calibration, serial-number, configuration, EEPROM-emulation or other persistent data is stored elsewhere in internal flash. In that case the updater must erase only the application pages/banks that belong to the firmware image.

## Firmware manifest

The web page reads `docs/firmware-manifest.json`.

A production target should look like this:

```json
{
  "schema": 1,
  "repository": "zeronoise-zn/zn-clear-voice",
  "targets": [
    {
      "product": "ClearVoice",
      "hardware": ["REV01"],
      "version": "1.02.03",
      "mcu_id": 1129,
      "address": 134217728,
      "url": "https://github.com/zeronoise-zn/zn-clear-voice/releases/download/clearvoice-v1.02.03/clearvoice_v1.02.03.bin",
      "sha256": "PUT_THE_REAL_SHA256_HERE",
      "changelog": "Improved audio processing and system stability."
    }
  ]
}
```

Notes:

- Decimal `1129` is hexadecimal `0x469`.
- Decimal `134217728` is hexadecimal `0x08000000`.
- Do not publish a target until the exact binary and SHA-256 are known.
- Prefer immutable GitHub Release assets over files taken from the moving `master` branch.

## Recommended release workflow

1. Build the STM32 production binary.
2. Compute SHA-256.
3. Create an immutable GitHub Release/tag.
4. Upload the `.bin` as a release asset.
5. Update `firmware-manifest.json` with product, hardware revision, version, MCU PID, URL and SHA-256.
6. Publish GitHub Pages from `/docs` on the default branch.

## Hardware integration status

The FT234XD UART connection is confirmed compatible with the STM32G474 ROM bootloader:

- `PA2 = USART2_TX`
- `PA3 = USART2_RX`

The remaining integration work is firmware-side: implement and bench-test `ZN_INFO?`, `ZN_BOOT`, and the system-memory jump before enabling production firmware targets in the manifest.
