# BM83 via HEADSET_BT USB/UART

## Programmazione TEST / SPI, bridge v3

Il nuovo percorso `bm83-flash.js` programma direttamente la Flash SST26VF016B
(JEDEC BF2641) tramite i comandi HCI vendor della ROM BM83. La pagina seleziona
TEST e 921600 baud come default; le altre velocita restano selezionabili.
Il baud dei comandi audio nell'applicazione non viene modificato.
Le altre Flash vengono rifiutate prima di cancellare. E richiesto bridge v3.

Il caricamento non esegue piu il backup completo da 2 MiB e non salva copie
in IndexedDB. Legge solo i settori previsti dal piano per saltare quelli gia
identici (BM83_COMPARING), scartando subito i vecchi dati. Conserva in RAM
solo gli 8 KiB di calibrazione per confrontarli dopo la scrittura. Restano
verifica dei settori, rilettura finale delle regioni e ripristino BPR.
Il pulsante Scarica backup precedente permette di esportare solo copie gia
salvate dalle versioni precedenti; nessun backup viene creato dal caricamento.

Piano fisico: MCU primario 10000-8FFFF, DSP/VP nelle regioni descritte dal file,
CONFIG 6000-7FFF inclusivo del marcatore iniziale; runtime 4000-5FFF cancellato
quando si aggiorna CONFIG, come previsto dalla guida isUpdate. Calibrazione
2000-3FFF e area 8000-FFFF restano fuori dal piano. I settori gia identici alla lettura iniziale
non vengono riscritti. Gli header 0000-1FFF vengono aggiornati per ultimi,
prima quello alternativo e poi quello primario del Rehex.

Il programmatore usa solo SPI 03 (lettura), 05 (stato), 06 (Write Enable),
02 (Page Program), 20 (Sector Erase), 42/72 (BPR volatile), 04 (Write Disable).
Nessun chip erase, global unlock o comando OTP/security viene inviato.
Il bitmap BPR modifica solo i write lock dei settori coinvolti; il blocco
calibrazione resta protetto. Il BPR iniziale viene ripristinato e verificato.
Ogni settore scritto viene riletto e confrontato byte per byte; la verifica
finale ripete il confronto di tutte le regioni e della calibrazione, registrando
gli hash. Dopo la verifica si rilascia TEST (Q1 spento) e si resetta in Embedded Mode.
La UART APP puo essere disabilitata: nessun comando APP o accensione UART
e richiesto dopo TEST. COMPLETE certifica la Flash riletta e la calibrazione,
non il funzionamento audio. Il collaudo operativo usa MFB, Bluetooth e audio.

Le letture SPI usano blocchi da 240 byte. Le scritture usano 32 byte senza
attraversare le pagine fisiche da 256 byte. Sulla ROM BT5511_002 i tentativi
con 48/64/128 byte non completano la sequenza in modo affidabile; il settore
CONFIG a 32 byte e stato programmato e verificato sul dispositivo reale.
Il baud nominale non e il throughput utile: confronto, ACK, cancellazioni e
riletture contribuiscono al tempo totale.

`ZN_BM83_GUARD ON/OFF` resta compatibile come stato della sessione TEST.
Dallo STM32 1.0.10 non mantiene il modulo in reset dopo la sessione:
CLOSE, disconnessione, timeout ed errore rilasciano TEST e RESET, con Q1/Q2
spenti. PA5/PA6 LOW lasciano flottanti i pin BM83 tramite i transistor.
RESET viene azionato solo per l'impulso esplicito o il cambio TEST/Embedded.
INFO espone HOLD=0; fuori sessione GUARD=0. La sola ricarica USB non aziona
il reset e non impedisce l'uso audio. Un'immagine interrotta puo richiedere
un nuovo caricamento TEST; i backup precedenti restano disponibili nel browser.
La diagnostica UART applicativa resta opzionale e separata dal caricamento;
`ZN_BM83_APP_BAUD` modifica solo il baud dello STM32, senza scrivere parametri
nel BM83. I fault di ricezione fuori sessione vengono puliti e non compromettono
lo stato di salute STM32; durante una sessione rimangono bloccanti.
Una perdita di alimentazione non e una transazione atomica: se l'immagine e
parziale, va riprogrammata tramite TEST. Il bootloader STM32 resta disponibile.

La rilettura MSPK2 v1.3.5 identifica MCU 1.03.0506, DSP 1.04.0412, isUpdate 3.16,
Config GUI 1.3.25 e SPKCommandSetTool 206.008. Il file utente BT_HEADSET_V0_11A8
contiene invece MCU 1.03.0406 e DSP 1.04.0411, anche secondo i commenti di origine
nel file. Nessuna immagine o cartella BM83 locale e aggiunta a Git.

Il limite 115200 del vecchio percorso MCU DFU e un'impostazione del client,
non un limite assoluto del BM83: AudioUART 2.09, par. 4.3, ammette baud
applicativi fino a 921600 configurati nel modulo. Per conservare il baud audio
si usa il nuovo percorso TEST. Il problema originale MCU DFU CONFIG resta
distinto: sia il test mirato includendo il marker (624 byte), sia quello senza
padding (614 byte dopo il marker) ricevono stato 3 a Image_Validate. Non e
stata applicata una correzione arbitraria al parser MCU DFU.

Fonti: documentazione MSPK2 v1.3.5 locale, User Guide isUpdate V2.32 e note 3.16;
[SST26VF016B DS20005262F, sezioni 4.5, 5.20, 5.33-5.34 e tabella 5-6](https://ww1.microchip.com/downloads/en/DeviceDoc/SST26VF016B-2.5V-3.0V-16-Mbit-Serial-Quad-IO-SQI-Flash-Memory-Data-Sheet-DS20005262F.pdf).

## Storico del percorso MCU DFU applicativo

Applicazione STM32 compilata, rigenerata con CubeMX e installata via USB sulla
scheda. Bridge UART, reset e lettura versioni verificati sul BM83 reale. Pagina
verificata in Chrome con seriale simulata; i suoi moduli JS sono stati provati
anche verso la scheda tramite un adattatore seriale di test Python.
Il ciclo completo di **scrittura Flash BM83 tramite MCU DFU** non e riuscito:
il trasferimento MCU DFU raggiunge CONFIG ma Image_Validate restituisce stato 3.
La funzione resta in collaudo; END non viene inviato dopo il rifiuto.

### Aggiornamento log e UART v2

Il collaudo dell'utente ha segnalato `Command_Ack` per 0x49 con stato 3.
In AudioUARTCommandSet v2.10, sezione 7.1, **3 = Parameters error**;
1 = Command disallow e 2 = Unknown command. Il precedente messaggio generico
"Put the module in standby and retry" era errato. Il successivo log identifica
Image_Validate / CONFIG come fase del rifiuto; la causa del NACK resta aperta.

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
Local Version risponda identico alla nuova velocita. Esegue poi 32 letture delle
identita ROM (FC20) e JEDEC Flash (FCA4, SPI Read ID 9F), richiedendo risposte
valide e identiche. FC20 non ha un byte status dopo l'opcode; FCA4 lo ha.
Poi chiude TEST e applica reset. Se manca l'ACK, non cambia la UART; errori del
bridge o identita instabili impediscono di dichiarare verificata la velocita.

Questa sequenza e stata confrontata offline con la routine 0x409030 di
isUpdate incluso in AT v1.0.1 del pacchetto ufficiale locale Turnkey 1.3.1;
SHA-256 dell'eseguibile
`50a5cfdcb2179e10741a8fe714525e400c2eabb6bafa98982a48659439914957`.
Esempio a 921600: `01 5D FC 04 00 10 0E 00`, risposta attesa
`04 0E 04 01 5D FC 00`. Nessun eseguibile vendor e stato avviato.
Il manuale isUpdate nel pacchetto 1.2.0 dichiara 921600 come massimo a pagina 4
e distingue la programmazione UART in TEST a pagina 6.

**La prova TEST veloce non accelera il caricamento MCU DFU 0x49**: quest'ultimo
rimane a 115200. La nuova programmazione TEST/SPI e descritta sopra ed e un
percorso distinto dalla prova del collegamento.
Non viene modificata la configurazione UART persistente dell'applicazione BM83.
Il cambio TEST a 921600 e verificato da test di protocollo e pagina con seriale
simulata; il successivo log di collaudo dell'utente lo conferma anche sulla
scheda reale (vedi sotto).

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
`RUNNING`, `CONFIRMED=1` e `UART_ERRORS=0`. Nessuna Flash BM83 scritta durante
questa installazione STM32.

### Riscontro dal log utente e preparazione standby

Il log dell'11 novembre 2026 conferma il cambio a 921600 sulla scheda:
ACK FC5D `04 0E 04 01 5D FC 00`, poi nuova risposta HCI Local Version
`04 0E 0C 01 01 10 00 08 00 02 08 39 00 00 02` alla velocita alta.
Identita invariata `0800020839000002`, nessuna scrittura Flash in questa prova.

Nei successivi tre tentativi il file selezionato e `BT_HEADSET_V0_11A8.HEX`,
SHA-256 `a8b8306c8f36bb35bbfd39f98d855fb6e3b024a14916c0d88d87c0d097c90b88`:
MCU/DSP hanno gli stessi CRC della REV01, configurazione da 624 byte,
totale 782528 byte. Il file non e stato copiato nel repository pubblico.
Il BM83 risponde a Read_Link_Status con `00 00 00 00 00 00 00`:
**stato 0 = Power OFF logico**, pur con processore e UART alimentati.
Il preflight si arresta prima di qualunque comando 0x49. Questi tentativi non
identificano la fase del precedente NACK 3 e non ne dimostrano la causa.

La pagina ora prepara lo standby quando si avvia il caricamento: se OFF,
invia MMI 0x02 con `[00,51]` (Power On Press), poi `[00,52]` (Release).
Se entra in pairing, invia una sola volta `[00,6B]` (Exit Pairing).
Aspetta uno stato interrogato 2 prima del primo comando DFU. Sono consentite
al massimo 32 interrogazioni con pausa 250 ms; ACK persi o NACK interrompono
la sequenza senza ritentare le azioni. Connessioni HF/A2DP/SPP esistenti
producono un errore specifico e non vengono disconnesse automaticamente.
Il log registra Power_On_Press, Power_On_Release e STANDBY_READY.
Se resta OFF viene chiesta l'accensione tramite il tasto del modulo.

La sequenza di accensione e documentata in
[DS50002896A, sezione 4.6.2, pagina 26](https://ww1.microchip.com/downloads/aemDocuments/documents/OTH/ProductDocuments/UserGuides/BM83_Host_MCU_Firmware_Development_Guide_DS50002896A.pdf)
ed e presente nel sorgente PIC32 AT v1.0.1 del pacchetto Microchip locale.
La modifica riguarda soltanto il client web e funziona col bridge v2 installato.

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

## Hardware e RPC bridge v3 (v1/v2 per le funzioni precedenti)

PA2=USART2_TX verso RX BM83, PA3=USART2_RX da TX BM83, 115200 8N1.
PA5 HIGH accende Q1 e tira P3_4 LOW; PA6 HIGH accende Q2 e tira RST_N LOW.
PA5/PA6 inizialmente LOW. Ricezione a interrupt, ring 4096 byte (4095 utili).
USART2 IRQ priorita 0 e conservato nel progetto CubeMX. Il bridge imposta USB
a priorita 1: la ricezione UART puo interrompere USB anche a 921600 baud.
USART2 del C071 non ha FIFO. Sul firmware precedente il test HCI breve passa,
ma le identificazioni ROM/Flash riproducono ORE (0x00000008). La correzione
delle priorita elimina l'overrun nel test esteso reale di 32 letture ripetute.

USB CDC 230400, comandi ASCII terminati LF. I byte UART sono incapsulati in
HEX per conservare il controllo della pagina. Non e una seriale trasparente
direttamente compatibile con isUpdate.exe.

| Comando | Risposta |
| --- | --- |
| `ZN_BM83_INFO?` | `[BM83] BRIDGE=3 ACTIVE=... MODE=APP/TEST BAUD=... MAX_BAUD=921600 RX_BYTES=... UART_ERRORS=... GUARD=0/1 HOLD=0/1` |
| `ZN_BM83_OPEN APP` | `[BM83] OPEN=OK BRIDGE=3`, senza reset, rifiutato in HOLD |
| `ZN_BM83_OPEN TEST` | come sopra, con P3_4 LOW e reset hardware |
| `ZN_BM83_TX <hex>` | `[BM83] TX=OK`: accettato dal bridge, non ACK del BM83 |
| `ZN_BM83_RX?` | `[BM83] DATA=<hex>`, fino a 512 byte, anche vuoto |
| `ZN_BM83_RESET` | `[BM83] RESET=OK`, reset hardware esplicito in sessione APP |
| `ZN_BM83_CLOSE` | `[BM83] CLOSED=OK` |
| `ZN_BM83_BAUD <rate>` | `[BM83] BAUD=<rate>`, solo TEST e bridge v2 |
| `ZN_BM83_GUARD ON/OFF` | `[BM83] GUARD=ON/OFF`, solo TEST e bridge v3 |
| `ZN_BM83_APP_BAUD <rate>` | `[BM83] BAUD=<rate>`, solo APP e bridge v3, adattamento host senza scritture BM83 |

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

MCU DFU 0x49 e TEST/ROM usano protocolli diversi. Con guard disattivato,
CLOSE TEST, perdita DTR o 30 s senza comandi rilasciano TEST e applicano reset.
Dallo STM32 1.0.10 il bridge rilascia RESET e TEST fuori sessione, anche con guard attivo.
Queste condizioni richiedono STM32 alimentato; RTS/CTS, MFB e alimentazione
BM83 non sono comandabili.

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

## Nuova immagine Embedded e documentazione isUpdate 3.16

Il file locale `BT_USB_REV0_0FDC.HEX` e accettato dal parser: MCU 1.03.0506,
DSP 1.04.0412, CONFIG. SHA-256
`6aef2dd01f15f066ecfccde32b7812450e84c0732dc437edb332b542388c826e`.
Il log GUI HEADSET_BT_rev0 indica UART Command Disable e accensione MFB.
Non va imposto un controllo UART APP per dichiarare riuscita la programmazione.
Le note isUpdate 2.26 introducono 921600/460800/230400; dalla 2.97
la voce Rehex BM83 UART DFU Use si chiama BM83 Full Image for general DFU.
La guida V2.32 e precedente a questa rinomina. Full HEX si seleziona da solo.
L aggiornamento CONFIG azzera runtime, ma calibrazione e pairing sono preservati.
I test fisici sul precedente HEX hanno verificato tutte le regioni Flash;
il successivo controllo UART APP ha segnalato un fault. Nessuna verifica
audio e dichiarata. La nuova immagine resta locale e non viene pubblicata.

## Blocchi da 4096 byte nello STM32 1.0.11

INFO espone SPI_BATCH=4096. Il client usa automaticamente il percorso locale
per letture e programmazione; i firmware precedenti restano sul percorso browser.
TRANSFER_MODE registra usbBlock=4096 ed executor=STM32, visibili anche nella pagina.

Un settore da 4096 byte viene caricato in RAM con SECTOR + otto CHUNK da 512;
PROGRAM verifica CRC-32 prima di qualsiasi cancellazione. Lo STM32 esegue
WREN/erase/program/status e confronto byte per byte della rilettura senza
round trip del browser per ogni comando. PROGRAM restituisce OK e CRC solo
dopo verifica. La rilettura finale delle regioni dell'immagine resta attiva.
READ accetta fino a 4096 byte e li legge localmente con comandi ROM da 240.
Il client accetta risposte testuali limitate a 8256 byte, frammentate via USB.

Non e una scrittura fisica singola da 4096: la Flash SST26VF016B ha pagine
Page Program da 256 byte e settori da 4096. Il trasporto ROM FCA4 mantiene
programmi da 32 byte (gia collaudati), eseguiti ora nello STM32. Non si aumenta
alla cieca il payload UART: il guadagno deriva dall'eliminazione delle attese
browser fra i comandi. Il turnaround ROM da 2 ms e mantenuto.

RPC solo TEST: ZN_BM83_SECTOR <address8hex>, ZN_BM83_CHUNK <offset4hex> <hex>,
ZN_BM83_PROGRAM <crc8hex>, ZN_BM83_READ <address8hex> <length4hex>.
Mutazioni richiedono GUARD e un settore ammesso: header, runtime/config,
MCU primario o DSP/VP primario. Calibrazione, pairing e bank MCU alternativo
sono esclusi. Offset errati, CRC errato, target diverso da BF2641, reply UART
invalida o verifica fallita interrompono il percorso; nessuna mutazione e ritentata.
CLOSE/disconnessione/errore rilasciano Q1/Q2 come nella 1.0.10.

Il buffer aggiunge 4096 byte di RAM. Build: BSS circa 12.4 KiB e almeno 8 KiB
riservati allo stack. Un buffer da 8192 consumerebbe questa riserva nel layout
attuale; non offre una pagina Flash maggiore. I test C simulano la vera
implementazione con errori/CRC/offset/rilettura/disconnessione; il test Chrome
verifica il percorso pagina, assenza di backup automatici e risposte USB da 4096 byte.
La nuova velocita utile va misurata sulla scheda: non viene dichiarato un fattore
prima del collaudo hardware.
