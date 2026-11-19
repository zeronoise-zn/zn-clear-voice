# Manutenzione del client web

La pagina viene servita direttamente dalla cartella `docs/`; non esiste un
bundle generato o un progetto npm da compilare. I moduli JS usano import ESM.
I file firmware pubblicati e i manifest non vengono aggiornati dai test.

HEADSET_BT: `secure-package.js` interpreta solo metadati e record cifrati;
`bm83-secure.js` delega autenticazione/decifratura allo STM32. Non aggiungere
chiavi al sito. Il repository HEADSET_BT genera `build/public` e il comando
`tools/stage_web_release.py` prepara i soli pacchetti cifrati nel sito dopo
verifica MAC e coerenza della build. Il file `build/private/HEADSET_BT_FACTORY.hex`
e riservato a SWD e non va pubblicato. Il catalogo non va editato per cambiare
solo uno SHA: deve provenire dal packaging della relativa immagine.

Per i nuovi sorgenti del team usare il testo di
[`COPYRIGHT_HEADER.txt`](../COPYRIGHT_HEADER.txt), adattando solo i delimitatori
dei commenti al linguaggio. Conservare avvisi e licenze dei componenti di terze
parti. I file JSON non ammettono commenti e le immagini firmware restano inalterate.

L'[audit del sistema HEADSET_BT](https://github.com/zeronoise-zn/Headset_BT/blob/master/docs/AUDIT_CODICE_2026-11-11.md)
riporta problemi corretti, verifiche e collaudi ancora necessari.
La [guida per leggere e modificare il codice](https://github.com/zeronoise-zn/Headset_BT/blob/master/docs/ARCHITETTURA_E_MANUTENZIONE.md)
descrive STM32, BM83 USB e Android OTA e il ruolo di ciascun file.
I moduli del client hanno commenti in italiano sulle responsabilita e sui
confini che non devono essere confusi.

## Seguire una azione

1. `updater-ui.js` gestisce il pulsante e controlla se un motore e occupato.
2. `fw-updater.js` aggiorna STM32; `bm83-auto.js` scarica il riferimento BM83 e
   `bm83-flash.js` confronta e programma la sua Flash. Sono flussi distinti.
3. `serial-transport.js` e l'unico proprietario dei reader/writer USB. I motori
   non devono aprire un secondo reader o cambiare modalita mentre una richiesta
   e in attesa.
4. `zn-protocol.js` e `znfw.js` descrivono STM32; `bm83-image.js` interpreta HEX
   General Use. Il file OTA cifrato Android non e un file General Use.

Le etichette visive e il contenuto di sessionStorage/localStorage non provano
che un firmware sia installato. Il successo STM32 richiede END, identita esatta
e BootConfirm; quello BM83 TEST richiede la rilettura dei byte e conservazione
della calibrazione. Il confronto automatico usa versioni MCU/DSP e contenuto
config dichiarato, escludendo marker, padding e runtime mutabile.

## Verifiche

Da questa cartella repository, con Node recente:

```powershell
node --test tests/*.test.mjs
```

Per includere il pacchetto ARM reale HEADSET_BT, dopo build e test nel repository
firmware:

```powershell
$env:HEADSET_TEST_PACKAGE = 'C:/Github/Headset_BT/build/HEADSET_BT_TEST.znfw'
node --test tests/*.test.mjs
```

Senza questa variabile il relativo test e saltato. `ZNFW_TEST_FIXTURE` e invece
un campione R4 storico con hash esatto: non usare una release diversa al suo posto.
Le prove dei motori usano trasporti simulati e non scrivono sulla scheda.
I test della UI sono con DOM/Serial simulati, non un collaudo fisico Web Serial.

Stile: Prettier 3.6.2 e `.prettierrc.json`. Esempio per un file modificato:

```powershell
npx --yes prettier@3.6.2 --write docs/serial-transport.js
```

Conservare UUID, indirizzi, identificativi prodotto e numeri opcode/status.
Prima di introdurre un retry verificare se il dispositivo distingue un replay:
ZNBL lo fa con sequenza e cache; AudioUART/HCI non concedono quel riutilizzo per
una mutazione incerta. Una richiesta concorrente deve fallire prima di cambiare
buffer, formato, porta o baud.

Il backup completo BM83 e stato rimosso. `bm83-backup.js` permette soltanto di
leggere quelli storici gia salvati; non reinserire creazione dump nel flusso.
TEST e RESET vengono rilasciati dal firmware STM32 a fine sessione, anche su errore.

## Service login

The public update flow requires no service login. HEADSET_BT service tools
require username/password verified by the connected device using a single-use
HMAC challenge and PBKDF2-SHA256 (600000 iterations). Credentials and the
verifier belong only to the private firmware repository. Never put them in
this public repository. service-access.js uses WebCrypto and keeps no stored
password. Serial traces redact service exchanges. The device also restricts
raw UART/Flash commands; hiding HTML alone is not the protection. Legacy
firmware/ClearVoice without this capability cannot unlock this service area.
A static page cannot hide its downloaded HTML/JS or provide server-side HTTP
authentication. Session expiry, disconnect and logout lock the controls again.
