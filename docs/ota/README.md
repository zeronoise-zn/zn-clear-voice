# ZN HEADSET OTA catalog

The Android app reads `manifest.json` over HTTPS, compares the actual MCU/DSP
versions, downloads the selected file and asks for confirmation before BLE OTA.
The file is an original **encrypted Microchip OTA DFU Use** export. It is not
the USB `.znbt` package. No OTA keys, USB keys or service credentials belong here.

Generate this catalog from the selected image in the private HEADSET_BT build,
then run `tools/stage_web_release.py --ota-only` from a clean build/checkout.
Never replace the export with a General Use image or a factory STM32 image.
The app checks product, transport, size, SHA-256, bank layout and embedded code
versions. The headset performs native OTA CRC validation using its existing key.

A matching MCU/DSP version does not identify the audio configuration. REV6
uses the same code versions as earlier configurations. The app explains this
and allows an optional confirmed installation; it never flashes on connection.

Current native export: `BT_REV6_119A.HEX`. The General Use source
`BT_REV6_0FC0.HEX` stays in the private firmware repository and must never be
published here. The USB catalog uses the separately encrypted `BT_REV6.znbt`.
