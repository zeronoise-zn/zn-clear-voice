# ClearVoice production firmware

This folder is the public firmware catalog consumed by the ClearVoice Web Updater.

Only signed production packages are published here.

Naming convention:

`ClearVoice_<version>_PROD.znfw`

Example:

`ClearVoice_1.1.0.72_PROD.znfw`

The updater reads this folder through the GitHub Contents API, extracts versions from filenames, sorts them numerically, selects the newest version by default, and keeps previous published versions selectable.

Do not publish BIN, HEX, ELF, private key or unsigned packages
