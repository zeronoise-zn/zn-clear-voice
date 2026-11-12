# First installation from a public page

Only password-protected `.znfi` containers belong in this directory. The build
creates AES-256-GCM packages with a fresh nonce and PBKDF2-SHA256 salt, using the
existing service username and password from the private firmware repository.
Never publish the factory HEX/BIN, keys, password, or a test-password encryption
of a real factory image. Test fixtures must contain only synthetic firmware.

Chrome/Edge WebUSB access requires HTTPS, user permission and a compatible USB
driver (WinUSB on Windows). Selecting ST DFU does not prove a HEADSET_BT board:
the operator must select the intended headset. The installer then checks C071
device ID, 64 KiB size, UID and the complete Flash before programming.

The flow writes board firmware first, verifies it, commits boot vectors last,
and leaves DFU. It then checks the same UID, firmware version and boot health
through Web Serial before starting the existing encrypted Bluetooth updater.
New serial permissions may require a second click. Already authorized ports
are reused only when unambiguous, and still checked by UID.
Factory metadata grants 120 seconds per trial for the new serial permission;
this is not a health confirmation. Ordinary updates retain the shorter trial.

No mass erase, unprotect, option-byte writes or keys in JavaScript are used.
A programmed board is rejected. Interrupted initial programming may resume
only while boot vectors remain erased and every already written double-word
matches the selected authenticated image. Other partial images require recovery.
Power interruption during the final vector write is not an atomicity guarantee.

Service credentials grant access to the full factory plaintext in the browser;
authorized provisioning operators can therefore extract its embedded keys.
This protects public downloads, not against an authorized operator or physical
Flash extraction. Passwords and plaintext must never enter logs or storage.

Validation includes WebUSB simulation, interrupted writes, wrong devices,
wrong credentials, tamper detection and Python/WebCrypto interoperability.
A full first-installation cycle still requires a physically blank HEADSET_BT
and a real browser/driver test; simulations do not certify that hardware path.
