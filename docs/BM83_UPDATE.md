# BM83 via HEADSET_BT USB/UART

## Stato e uso

Applicazione STM32 compilata, rigenerata con CubeMX e installata via USB sulla
scheda. Bridge UART, reset e lettura versioni verificati sul BM83 reale. Pagina
verificata in Chrome con seriale simulata; i suoi moduli JS sono stati provati
anche verso la scheda tramite un adattatore seriale di test Python.
Il ciclo completo di **scrittura Flash BM83** non e ancora stato eseguito:
la funzione resta in collaudo.

### Aggiornamento log e UART v2

Il collaudo dell'utente ha segnalato `Command_Ack` per 0x49 con stato 3.
In AudioUARTCommandSet v2.10, sezione 7.1, **3 = Parameters error**;
1 = Command disallow e 2 = Unknown command. Il precedente messaggio generico
"Put the module in standby and retry" era errato. Non e ancora nota la fase
del rifiuto reale e non si dichiara risolta la causa del NACK.

La pagina ora mostra un log BM83 dedicato e consente di scaricarlo come JSONL.
Registra identita STM32, SHA del file, dimensioni e CRC dei componenti, stato
BM83 prima del DFU (0x0D / evento 0x1E), fase e sottocomando DFU, offset,
lunghezze, anteprima del pacchetto TX, ACK e stato, tempi e snapshot del bridge
in caso di errore. Sono conservati fino a 8 MiB con contatore esplicito dei
record rimossi; a video restano gli ultimi 140 record. I dati firmware TX sono
limitati ai primi 96 byte per pacchetto. Il comando fallito non viene ritentato.
La velocita utile media e il tempo trascorso sono mostrati durante il DFU.

Il nuovo firmware STM32 espone `bm83_bridge: 2`. Il comando
`ZN_BM83_BAUD <115200|230400|460800|921600>` e ammesso **solo in TEST**.
Attende TX completo, aggiorna USART2/BRR e huart2 a runtime, svuota la ricezione
al confine esplicito di protocollo e riporta la velocita in `ZN_BM83_INFO?`.
CLOSE, disconnessione e lease scaduta rilasciano TEST/reset e ripristinano
la UART STM32 a 115200. Il progetto CubeMX conserva l'avvio a 115200.

Il pulsante **Verifica UART veloce** esegue solo una prova senza scrittura Flash:
entra in TEST, legge HCI Local Version (0x1001), chiede la velocita al BM83 con
HCI vendor FC5D e baud a 32 bit little endian, attende Command Complete a
velocita iniziale, attende 1000 ms, cambia la UART del bridge e verifica che
Local Version risponda identico alla nuova velocita. Poi chiude TEST e applica
reset. Se manca l'ACK, non cambia la UART e non dichiara la velocita verificata.

Questa sequenza e stata confrontata offline con la routine 0x409030 di
isUpdate incluso in AT v1.0.1 del pacchetto ufficiale locale Turnkey 1.3.1;
SHA-256 dell'eseguibile
`50a5cfdcb2179e10741a8fe714525e400c2eabb6bafa98982a48659439914957`.
Esempio a 921600: `01 5D FC 04 00 10 0E 00`, risposta attesa
`04 0E 04 01 5D FC 00`. Nessun eseguibile vendor e stato avviato.
Il manuale isUpdate nel pacchetto 1.2.0 dichiara 921600 come massimo a pagina 4
e distingue la programmazione UART in TEST a pagina 6.

**La prova TEST veloce non accelera il caricamento MCU DFU 0x49**: quest'ultimo
rimane a 115200. Il programmatore Flash isUpdate/TEST non e implementato.
Non viene modificata la configurazione UART persistente dell'applicazione BM83.
Il cambio TEST a 921600 e verificato da test di protocollo e pagina con seriale
simulata; non e ancora stato provato sulla scheda reale.

Per usare subito il log basta ricaricare la pagina locale con Ctrl+F5;
e compatibile con il bridge v1 gia installato. La prova UART veloce richiede
il pacchetto STM32 `HEADSET_BT_BM83_LOG_UART_V2_DEV.znfw`.
I pacchetti DEV citati sono artefatti locali di collaudo, non release del
catalogo pubblico. Il catalogo puo contenere firmware STM32 precedenti privi
del bridge: per questo collaudo usare il firmware v2 gia installato.

Il pacchetto v2 e stato successivamente installato via USB sulla scheda reale:
21.660 byte di payload, SHA-256 del pacchetto
`946726bc242c1c89e42738f0f32ed68baf0503e0f583b0f23338f3e5de0553b1`.
Verificati `bm83_bridge: 2`, END accettato, riavvio con identita corrispondente,
`RUNNING`, `CONFIRMED=1` e `UART_ERRORS=0`. La prova HCI a 921600 sulla scheda
rimane distinta e ancora da eseguire. Nessuna Flash BM83 scritta durante
questa installazione STM32.

La sezione BM83 appare per HEADSET_BT in applicazione. SerialTransport conserva
l'unico reader Web Serial; diagnostica, update STM32 e BM83 sono esclusivi.

1. Installare HEADSET_BT con `bm83_bridge: 1` o `2` in ZN_INFO.
2. Collegarsi in Chrome/Edge desktop e verificare il collegamento BM83.
3. Mantenere il modulo alimentato e in standby, senza chiamate/riproduzione.
4. Selezionare il Rehex **BM83 General Use** generato con isUpdate, come in
   AN3118 appendice R, figura 112. I file OTA cifrati e gli input raw MCU/config
   con indirizzi 0x200000 / 0xFD000000 non sono supportati.
5. Caricare il firmware: comando 0x49, ACK, Image_Validate per componente,
   END/reset, nuova risposta UART e confronto versioni MCU/DSP del file.

I checksum HEX vengono verificati e lo SHA-256 del file viene calcolato nel browser.
I CRC dei componenti vengono calcolati prima del trasferimento e validati sul
BM83 durante la procedura; la sola selezione del file non valida la Flash BM83.
Il numero UART 2.7 non e la versione del firmware audio. Le versioni MCU/DSP
sono lette separatamente con 0x08/type 3 e 4; il confronto non e un hash della
Flash. Per la configurazione non e disponibile un'identita interrogabile.

## File REV01 e piano verificato

`Firmware/Bluethoot/BM83_CLEARVOICE_REV01.HEX` e gia un Rehex General Use adatto
a costruire il piano MCU DFU. I tag FB/FC/FD appartengono al percorso OTA e non
sono richiesti per il DFU MCU documentato nell'appendice R.

Il file e rimasto invariato: 5.877.978 byte, 2.088.960 byte di dati HEX,
SHA-256 `61054f6e77c7dcfeb8253779d6c61d28b10e88b291630bad657a9bd1ffc84d7f`.
L'area calibrazione 0x2000-0x3FFF e assente e non viene trasferita.

| Componente | Origine nel Rehex | Byte | CRC Microchip | Versione attesa (byte) |
| --- | --- | ---: | --- | --- |
| MCU | 0x010000-0x08FFFF, banco completo | 524288 | 0xD6B6 | 01 03 04 06 |
| DSP/VP | 0x110000-0x14EE4F, coda FF ridotta/allineata a 16 | 257616 | 0xF754 | 01 04 04 11 |
| Configurazione | 0x006001-0x006280, escluso marcatore iniziale | 640 | 0x5A66 | non esposta |

Totale 782.544 byte; informazioni Flash DSP: 756 byte. Il piano non trasferisce
calibrazione o aree runtime. Nessuna immagine BM83 e memorizzata nella Flash STM32.

Il comportamento e stato confrontato offline con SPKCommandSetTool 206.009 del
pacchetto ufficiale IS2083 Turnkey 1.3.0, SHA-256
`d123b999d6cd024d97630a64f2360338213522c2907f50316cd2f490a84ec9a8`.
Sono stati verificati caricamento General Use, banco MCU intero, DSP allineato,
config senza marcatore, offset relativi e campi big endian. I CRC della tabella
sono stati ottenuti emulando esclusivamente la routine CRC del tool, senza
avviare l'eseguibile o accedere a porte seriali. Il sito riproduce i risultati.
Questo confronto non sostituisce il collaudo reale della scrittura.

CRC: polinomio riflesso 0x8408, init FFFF, inversione finale dei 16 bit, senza
XOR finale. Vettore `123456789` = 0x89F6; stesso algoritmo del sorgente MBA.

## Hardware e RPC bridge v1

PA2=USART2_TX verso RX BM83, PA3=USART2_RX da TX BM83, 115200 8N1.
PA5 HIGH accende Q1 e tira P3_4 LOW; PA6 HIGH accende Q2 e tira RST_N LOW.
PA5/PA6 inizialmente LOW. Ricezione a interrupt, ring 4096 byte (4095 utili).
USART2 IRQ priorita 1 e conservato nel progetto CubeMX.

USB CDC 230400, comandi ASCII terminati LF. I byte UART sono incapsulati in
HEX per conservare il controllo della pagina. Non e una seriale trasparente
direttamente compatibile con isUpdate.exe.

| Comando | Risposta |
| --- | --- |
| `ZN_BM83_INFO?` | `[BM83] BRIDGE=2 ACTIVE=... MODE=APP/TEST BAUD=... MAX_BAUD=921600 RX_BYTES=... UART_ERRORS=...` |
| `ZN_BM83_OPEN APP` | `[BM83] OPEN=OK BRIDGE=2`, senza reset |
| `ZN_BM83_OPEN TEST` | come sopra, con P3_4 LOW e reset hardware |
| `ZN_BM83_TX <hex>` | `[BM83] TX=OK`: accettato dal bridge, non ACK del BM83 |
| `ZN_BM83_RX?` | `[BM83] DATA=<hex>`, fino a 512 byte, anche vuoto |
| `ZN_BM83_RESET` | `[BM83] RESET=OK`, reset hardware esplicito in sessione APP |
| `ZN_BM83_CLOSE` | `[BM83] CLOSED=OK` |
| `ZN_BM83_BAUD <rate>` | `[BM83] BAUD=<rate>`, solo TEST e bridge v2 |

TX massimo 512 byte, validato interamente prima di trasmettere. PE/FE/NE/ORE,
overflow ring (bit 31), timeout TX (bit 30) bloccano i trasferimenti fino a nuova
sessione. DTR e asserito esplicitamente. ZN_BOOT e rifiutato durante il bridge;
il watchdog continua a funzionare. Il polling mantiene la sessione anche nelle
operazioni lente (Image_Validate fino a 120 s). Comandi DFU con ACK perso non
sono ritentati: l'ACK 0x49 non ha sequenza/sub-opcode, la mutazione e ambigua.

Reset hardware: RST_N LOW 20 ms, ricezione silenziata nei 200 ms successivi per
escludere transitori elettrici su TX. Dopo riavvio intenzionale il client attende
3 s e apre una nuova sessione. CLOSE APP non resetta; il pulsante Riavvia BM83
lo fa esplicitamente e richiede una nuova risposta UART.

Il percorso web e MCU DFU 0x49 in applicazione. TEST/ROM usa un diverso protocollo
vendor, il cui programmatore non e implementato nel sito. CLOSE TEST, perdita
DTR o 30 s senza comandi rilasciano TEST e applicano reset se lo STM32 rimane
alimentato. Dopo perdita di alimentazione MCU non si puo garantire un reset
BM83 via software. RTS/CTS, MFB e alimentazione BM83 non sono comandabili.

## Collaudo hardware dell'11 novembre 2026

STM32C071G8U6/REV01, COM7: installata via USB la build di sviluppo
`1.0.5-28ce11051c62-dirty`, 21.216 byte, END accettato e
RUNNING/CONFIRMED=1, UART_ERRORS=0. Pacchetto
`HEADSET_BT_BM83_BRIDGE_FINAL_DEV.znfw`, SHA-256
`f72368dd37e92eaad62747f5b6b25069c1d76e6803965c0d3f56f298ef46c279`.

OPEN APP, comando `AA00020800F6`, ACK `AA0003000800F5`, evento versione
frammentato `AA000418000207DB`, ACK evento e CLOSE: verificati. BM83 UART 2.7.
Reset hardware e nuova lettura UART: verificati dopo la correzione dei transitori.
Letture type 3/4: MCU `01 00 00 18`, DSP `01 03 00 0A`, diverse dal file REV01.
Nessuna di queste prove ha scritto la Flash BM83.

## Fonti primarie

- [AN3118C, appendice R, figura 112](https://ww1.microchip.com/downloads/en/Appnotes/00003118C.pdf).
- [IS2083 Turnkey 1.3.0](https://ww1.microchip.com/downloads/en/DeviceDoc/IS2083_Turnkey_1.3.0.zip):
  SPKCommandSetTool 206.009 e AudioUARTCommandSet_v2.10.pdf, DFU 0x49 e ACK 0x00.
- [IS2083 Turnkey 1.2.0](https://ww1.microchip.com/downloads/en/DeviceDoc/IS2083_Turnkey_1.2.0.zip):
  sorgente MBA Android, CRC e percorso OTA distinto.
- [DS70005403C, sezione 7.3](https://ww1.microchip.com/downloads/en/DeviceDoc/70005403C.pdf):
  TEST su P3_4 e Flash SQI da 2 MiB.

Le risorse sono documentazione tecnica; eseguibili Microchip e sorgenti SDK non
sono incorporati nel firmware STM32 o nei file pubblicati del sito.
