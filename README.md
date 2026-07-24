# ZeroNoise Clear Voice Systems

The ZeroNoise Clear Voice Systems are a range of products that revolutionize rally communication through the seamless integration of wired and wireless technologies.

The range includes:

* WW System
* Fearless System
* Pit-Link System
* OffRoad System

Crystal-clear audio ensures that every critical note and instruction is heard and understood, even in the loudest vehicle environments.

Bluetooth connectivity also keeps the team in contact with support staff and team management, ensuring that everyone remains synchronized, informed, and ready to adapt to the dynamic demands of rally racing.

## Key Features and Benefits

Depending on the system, all or a subset of the following features may be available:

* **Wired and Wireless Technology (WW):** Provides reliable, delay-free communication. The seamless transition between connection modes ensures uninterrupted communication in all situations.

* **Advanced Noise Cancelling (ALL):** Noise cancellation technology filters out unwanted background noise and guarantees clear communication.

* **Automatic Switching Between Connection Modes (WW):** Ensures a stable connection and automatically switches between wired and wireless modes, guaranteeing continuous communication during stages and road sections.

* **Keyboard and Touchscreen Display (ALL):** Displays system information, such as battery level and connection status, and allows users to fine-tune audio parameters for optimal performance under all conditions.

* **Compatibility with Helmets and Headsets (ALL, Headsets for WW):** High-performance wireless connectivity is available with Bell MAG-10 Rally Carbon WW and HP10 Rally WW helmets, as well as ZeroNoise WW headsets. The intercom is also compatible with helmets and headsets equipped with a female Nexus connector.

* **Wireless Mode for Driver and Co-Driver Freedom (WW):** Allows users to communicate inside the vehicle or move around it without losing connectivity. This flexibility is particularly useful when a quick exit from the vehicle is required, such as during a tire change.

* **Customizable Sound Settings (ALL):** Audio settings are fully customizable to provide maximum clarity and allow precise tuning for specific stage environments and personal preferences.

* **Bluetooth Connectivity for Team Communication (ALL except OffRoad):** Supports communication with service crews and team management for strategy discussions and team coordination.

* **Stage Mode for Focused Communication (ALL except Pit-Link):** Limits communication to the driver and co-driver during competitive stages, preventing external interactions and helping the crew remain focused.

* **Audio Output for In-Car Camera Use (ALL except OffRoad):** Supports direct recording of driver and co-driver communication through an in-car camera system.

* **Audio Input/Output for Radio Connection (ALL except OffRoad):** Supports direct team communication through an external radio system.

## CAN Database

### ZN_CAN_FEARLESS_v1_08

`ZN_CAN_FEARLESS_v1_08.dbc` is the CAN database file used to describe the communication interface of the ZeroNoise Fearless system.

The DBC file defines the CAN messages, signals, bit positions, data lengths, scaling factors, limits, units, and enumerated values required to decode and generate Fearless CAN communication.

The database includes the following standard 11-bit CAN messages:

| CAN ID  | Message Name         | Description                                                                      |
| ------- | -------------------- | -------------------------------------------------------------------------------- |
| `0x410` | `Intercom_Status`    | Reports the current operating status and configuration of the Fearless intercom. |
| `0x411` | `Intercom_Command_0` | Controls the main intercom functions and audio parameters.                       |
| `0x412` | `Intercom_Command_1` | Controls additional intercom functions and configuration parameters.             |

All messages use an 8-byte CAN payload.

Version `v1_08` is provided as a standard raw DBC file and can be imported into compatible CAN tools, including Vector CANdb++, CANoe, CANalyzer, PCAN-Explorer, BusMaster, SavvyCAN, and other DBC-compatible software.

The database can also be used to generate software structures and encode/decode functions for embedded applications, test tools, diagnostic software, and CAN monitoring systems.
