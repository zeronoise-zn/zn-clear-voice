# First installation from a public page

Only password-protected `.znfi` containers belong in this directory. The build
creates AES-256-GCM packages with a fresh nonce and PBKDF2-SHA256 salt, using the
existing service username and password from the private firmware repository.
Never publish the factory HEX/BIN, keys, password, or a test-password encryption
of a real factory image. Test fixtures must contain only synthetic firmware.

Chrome/Edge WebUSB access requires HTTPS, user permission and a compatible USB
driver (WinUSB on Windows). Selecting ST DFU does not prove a HEADSET_BT board:
the operator must select the intended headset. The installer accepts only the
observed C071 ROM USB memory-target profile (bcdDevice 0x0220), then checks the real 64 KiB
size register, UID and complete Flash before programming. Other ROM revisions
or memory maps fail closed pending validation. The ROM's generic Flash target
advertises 128 KiB even on G8: it is not the density check.

The configuration has four alternate settings and one shared DFU functional
descriptor after alternate 3. The transfer size is read from that descriptor.
DBGMCU_IDCODE at 0x40015800 cannot be addressed by this ROM DFU (errVENDOR),
so it is never requested. VID/PID and USB target strings alone cannot prove
the headset PCB, package or ownership; operators must select the correct board.
On a new manual session an inherited dfuERROR is cleared with CLRSTATUS,
which only clears protocol state. Writes are never replayed on error.

Failures show the installation phase and a controlled error code, without
printing credentials, arbitrary exception text or decrypted firmware.
Download failures are distinguished from USB open failures. Cancelling the
USB chooser returns to Ready; losing the device after selection is an error.

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
