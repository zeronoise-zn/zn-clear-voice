# ZeroNoise Clear Voice Systems

ZeroNoise Clear Voice Systems are designed to improve rally communication through the integration of wired and wireless technologies.

The product range includes:

- WW System
- Fearless System
- Pit-Link System
- OffRoad System
- Fury

Crystal-clear audio ensures that critical notes and instructions are heard and understood, even in high-noise vehicle environments. Bluetooth connectivity also keeps the crew in contact with support staff and team management.

## Key Features and Benefits

Depending on the selected system, all or a subset of the following features may be available:

- **Wired and Wireless Technology (WW):** Provides reliable, delay-free communication and seamless switching between wired and wireless modes.
- **Advanced Noise Cancelling (All systems):** Filters unwanted background noise to ensure clear communication.
- **Automatic Connection Switching (WW):** Automatically switches between wired and wireless modes during stages and road sections.
- **Keyboard and Touchscreen Display (All systems):** Displays system information, including battery level and connection status, and allows audio parameter adjustment.
- **Helmet and Headset Compatibility:** Supports Bell MAG-10 Rally Carbon WW and HP10 Rally WW helmets, ZeroNoise WW headsets, and devices equipped with a female Nexus connector.
- **Driver and Co-Driver Wireless Freedom (WW):** Maintains communication when users leave the vehicle, for example during a tire change.
- **Customizable Sound Settings (All systems):** Allows audio tuning for different stage conditions and personal preferences.
- **Bluetooth Team Communication (All except OffRoad):** Supports communication with service crews and team management.
- **Stage Mode (All except Pit-Link):** Restricts communication to the driver and co-driver during competitive stages.
- **In-Car Camera Audio Output (All except OffRoad):** Supports direct recording of driver and co-driver communication.
- **External Radio Audio Input/Output (All except OffRoad):** Supports direct communication through an external radio system.

## CAN Database Files

The repository contains two CAN database files:

| File | System | Description |
|:---|:---|:---|
| `ZN_CAN_WW_v1_08.dbc` | WW | Includes the common intercom messages and the WW wireless-device status message. |
| `ZN_CAN_FEARLESS_v1_08.dbc` | Fearless | Includes the common intercom status and command messages without the WW-specific status message. |

Both databases use:

- Standard 11-bit CAN identifiers
- 8-byte CAN payloads
- Intel/little-endian signal encoding
- Signal definitions aligned with the corresponding C header files

Version `v1_08` is aligned with the header definitions for CAN IDs, DLC, signal start bits, signal lengths, factors, offsets, valid ranges, signal names, and reserved-bit allocation.

## ZN_CAN_WW_v1_08

`ZN_CAN_WW_v1_08.dbc` describes the CAN communication interface of the ZeroNoise WW system.

| CAN ID | Message Name | Description |
|:---:|:---|:---|
| `0x40F` | `Intercom_Status_1` | Reports wireless connection, battery, charging, pairing, and autocharge status. |
| `0x410` | `Intercom_Status_0` | Reports intercom operating status, audio settings, PTT status, and configuration. |
| `0x411` | `Intercom_Command_0` | Controls the main intercom functions, operating modes, filters, and volume parameters. |
| `0x412` | `Intercom_Command_1` | Controls additional audio volumes and persistent functions. |

The WW-specific message `0x40F` includes:

- Driver and co-driver connection status
- Driver and co-driver headset connection status
- Driver and co-driver battery level
- Charging status for supported wireless devices
- Autocharge status

## ZN_CAN_FEARLESS_v1_08

`ZN_CAN_FEARLESS_v1_08.dbc` describes the CAN communication interface of the ZeroNoise Fearless system.

| CAN ID | Message Name | Description |
|:---:|:---|:---|
| `0x410` | `Intercom_Status` | Reports intercom operating status, audio settings, PTT status, and configuration. |
| `0x411` | `Intercom_Command_0` | Controls the main intercom functions, operating modes, filters, and volume parameters. |
| `0x412` | `Intercom_Command_1` | Controls additional audio volumes and persistent functions. |

The Fearless database does not include the WW-specific message `0x40F`.

## Changes in v1_08

The following updates are included in both databases where applicable:

- `STS_External_PTT` assigned to bit 38 of message `0x410`
- `STS_CAN_PTT` assigned to bit 39 of message `0x410`
- Noise and voice filter ranges set from `1` to `5`
- Signal names aligned with the corresponding C header definitions
- Associated `VAL_` enumerations and `CM_` comments updated
- Reserved fields maintained only in unused payload areas
- No signal overlaps

## Compatible Tools

The DBC files are standard raw ASCII databases and can be imported into:

- Vector CANdb++
- Vector CANoe
- Vector CANalyzer
- PEAK PCAN-Explorer
- BusMaster
- SavvyCAN
- Other DBC-compatible tools

The databases can also be used for embedded code generation, diagnostics, automated testing, and CAN monitoring.
