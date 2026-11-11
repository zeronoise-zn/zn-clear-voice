# Manutenzione del client web

La pagina viene servita direttamente dalla cartella `docs/`; non esiste un
bundle generato o un progetto npm da compilare. I moduli JS usano import ESM.
I file firmware pubblicati e i manifest non vengono aggiornati dai test.

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
