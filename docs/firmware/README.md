# Firmware catalog

This folder is the public firmware catalog consumed by the ClearVoice Web Updater.

ClearVoice requires signed production packages. HEADSET_BT uses unsigned
packages with SHA-256 integrity checks and an explicit BTWH bootloader policy.

ClearVoice naming convention:

`ClearVoice_<version>_PROD.znfw`

Example:

`ClearVoice_1.1.0.72_PROD.znfw`

The updater reads this folder through the GitHub Contents API, extracts versions from filenames, sorts them numerically, selects the newest version by default, and keeps previous published versions selectable.

Do not publish BIN, HEX, ELF, private keys or unsigned ClearVoice packages.

HEADSET_BT uses unsigned SHA-256 packages named `HEADSET_BT_<version>_USB.znfw`.
Its policy is selected by the BTWH product profile; ClearVoice still requires
signed `_PROD.znfw` packages. BIN/HEX/ELF and private keys are not catalog entries.
