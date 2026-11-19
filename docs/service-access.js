/*
 * Copyright (c) 2026 Racing Force S.p.A.
 * All rights reserved.
 *
 * Author: Oscar Tofanelli
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * This software, excluding third-party libraries and components governed by
 * their respective license terms, is the exclusive property of Racing Force S.p.A.
 *
 * Any unauthorized use, modification, reproduction, distribution, disclosure,
 * publication, transfer, or sharing of this software, in whole or in part,
 * is strictly prohibited without the prior written consent of Racing Force S.p.A.
 *
 * This notice shall not alter or supersede the applicable license terms of any
 * third-party software, libraries, or components included in or used by this project.
 */

// Il browser conserva soltanto l'esito della sessione corrente. La password
// viene usata da WebCrypto e non viene salvata o inviata sulla porta seriale.
import { CMD } from './zn-protocol.js';
import { UpdateError } from './znfw.js';
const utf8 = (s) => new TextEncoder().encode(s);
const hex = (a) => Array.from(a, (v) => v.toString(16).padStart(2, '0')).join('');
function unhex(s, n) {
  if (typeof s !== 'string' || !new RegExp(`^[a-f0-9]{${n * 2}}$`, 'i').test(s))
    throw new UpdateError('SERVICE_CHALLENGE', 'Invalid service challenge.');
  return Uint8Array.from(s.match(/../g), (v) => parseInt(v, 16));
}
const concat = (...a) => Uint8Array.from(a.flatMap((v) => [...v]));
async function hmac(key, bytes) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bytes));
}
export function supportsService(info) {
  return (
    info?.product === 'HEADSET_BT' &&
    (info.mode === 'application'
      ? info.service_auth === 1
      : info.mode === 'bootloader' && !!(info.capabilities & 0x08000000))
  );
}
const serviceReply = (s) => s.trim().startsWith('[SERVICE]') || s.trim().startsWith('{"service":');
export async function serviceStatus(io, info) {
  if (!io?.connected || !supportsService(info)) return false;
  if (info.mode === 'application')
    return (await io.text('ZN_SERVICE_STATUS?\n', serviceReply)).trim() === '[SERVICE] OK';
  const r = await io.request(CMD.SERVICE_STATUS);
  return r.payload.length === 9 && r.payload[8] === 1;
}
export async function serviceLogout(io, info) {
  if (!io?.connected || !supportsService(info)) return;
  if (info.mode === 'application') await io.text('ZN_SERVICE_LOGOUT\n', serviceReply);
  else await io.request(CMD.SERVICE_LOGOUT);
}
export async function serviceLogin(io, info, username, password) {
  if (!io?.connected || !supportsService(info))
    throw new UpdateError(
      'SERVICE_UNAVAILABLE',
      'Connect a HEADSET_BT with service authentication.',
    );
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(username) || !password || password.length > 256)
    throw new UpdateError('SERVICE_DENIED', 'Invalid credentials.');
  let salt, nonce, uid, iterations, passwordKey, deviceKey, proof, passwordBytes;
  try {
    const host = crypto.getRandomValues(new Uint8Array(32));
    if (info.mode === 'application') {
      const line = await io.text(`ZN_SERVICE_CHALLENGE ${hex(host)}\n`, serviceReply);
      let c;
      try {
        c = JSON.parse(line);
      } catch {
        throw new UpdateError('SERVICE_DENIED');
      }
      salt = unhex(c.salt, 16);
      nonce = unhex(c.nonce, 32);
      uid = unhex(c.uid, 12);
      iterations = c.iterations;
    } else {
      const { payload: p } = await io.request(CMD.SERVICE_CHALLENGE, host);
      if (p.length !== 72) throw new UpdateError('SERVICE_CHALLENGE');
      salt = p.slice(8, 24);
      nonce = p.slice(24, 56);
      uid = p.slice(56, 68);
      iterations = new DataView(p.buffer, p.byteOffset, p.length).getUint32(68, true);
    }
    if (iterations !== 600000) throw new UpdateError('SERVICE_CHALLENGE');
    passwordBytes = utf8(password);
    const k = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
    passwordKey = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, k, 256),
    );
    deviceKey = await hmac(passwordKey, concat(utf8('DEVICE'), uid));
    proof = await hmac(deviceKey, concat(utf8('LOGIN'), nonce, utf8(username)));
    if (!io.connected) throw new UpdateError('SERIAL_DISCONNECTED');
    if (info.mode === 'application') {
      if (
        (await io.text(`ZN_SERVICE_LOGIN ${username} ${hex(proof)}\n`, serviceReply)).trim() !==
        '[SERVICE] OK'
      )
        throw new UpdateError('SERVICE_DENIED');
    } else await io.request(CMD.SERVICE_LOGIN, concat(utf8(username), proof));
    if (!(await serviceStatus(io, info))) throw new UpdateError('SERVICE_DENIED');
    return true;
  } finally {
    // Le stringhe JS non possono essere azzerate; i buffer sotto il nostro
    // controllo vengono cancellati e il modulo UI svuota sempre il campo.
    passwordBytes?.fill(0);
    passwordKey?.fill(0);
    deviceKey?.fill(0);
    proof?.fill(0);
  }
}

const copy = {
  it: [
    'Accesso assistenza',
    'Utente',
    'Password',
    'Accedi',
    'Esci',
    'Collega la cuffia, poi inserisci le credenziali di assistenza.',
    'Accesso in corsoâ€¦',
    'Accesso autorizzato.',
    'Accesso non riuscito. Controlla le credenziali e il collegamento; dopo cinque errori attendi un minuto.',
  ],
  en: [
    'Service access',
    'Username',
    'Password',
    'Sign in',
    'Sign out',
    'Connect the headset, then enter your service credentials.',
    'Signing inâ€¦',
    'Access granted.',
    'Sign-in failed. Check credentials and connection; wait one minute after five failures.',
  ],
  fr: [
    'AccÃ¨s assistance',
    'Utilisateur',
    'Mot de passe',
    'Connexion',
    'DÃ©connexion',
    'Connectez le casque, puis saisissez les identifiants.',
    'Connexionâ€¦',
    'AccÃ¨s autorisÃ©.',
    'Ã‰chec. VÃ©rifiez les identifiants et la connexion ; attendez une minute aprÃ¨s cinq Ã©checs.',
  ],
  de: [
    'Servicezugang',
    'Benutzername',
    'Passwort',
    'Anmelden',
    'Abmelden',
    'Headset verbinden und Zugangsdaten eingeben.',
    'Anmeldung lÃ¤uftâ€¦',
    'Zugriff erlaubt.',
    'Anmeldung fehlgeschlagen. Zugangsdaten und Verbindung prÃ¼fen; nach fÃ¼nf Fehlern eine Minute warten.',
  ],
  es: [
    'Acceso de asistencia',
    'Usuario',
    'ContraseÃ±a',
    'Acceder',
    'Salir',
    'Conecta los auriculares e introduce las credenciales.',
    'Accediendoâ€¦',
    'Acceso autorizado.',
    'Error de acceso. Comprueba las credenciales y la conexiÃ³n; espera un minuto tras cinco errores.',
  ],
};

/** Un solo proprietario della porta: anche login e logout partecipano a busy.
 * Il fieldset e disabilitato e nascosto fino alla conferma del dispositivo. */
export function mountServiceAccess({ getIo, getInfo, busy, language, changed }) {
  const $ = (id) => document.getElementById(id);
  let authorized = false,
    inFlight = false,
    bound = null,
    boundInfo = null,
    timer = null,
    failed = false;
  const lock = () => {
    authorized = false;
    bound = boundInfo = null;
    clearTimeout(timer);
  };
  const controller = {
    get busy() {
      return inFlight;
    },
    get authorized() {
      return authorized && getIo()?.connected && bound === getIo();
    },
    lock() {
      lock();
    },
    render() {
      if (
        !getIo()?.connected ||
        (bound && (bound !== getIo() || boundInfo !== getInfo())) ||
        !supportsService(getInfo())
      )
        lock();
      const c = copy[language()] || copy.en;
      [
        'serviceTitle',
        'serviceUserLabel',
        'servicePasswordLabel',
        'serviceLogin',
        'serviceLogout',
      ].forEach((id, i) => {
        if ($(id)) $(id).textContent = c[i];
      });
      if (!$('serviceTools')) return;
      $('serviceTools').hidden = !controller.authorized;
      $('serviceTools').disabled = !controller.authorized || !!busy();
      $('serviceForm').hidden = controller.authorized;
      $('serviceLogin').disabled = !!busy() || !getIo()?.connected || !supportsService(getInfo());
      $('serviceLogout').disabled = !!busy();
      $('serviceStatus').textContent = c[inFlight ? 6 : authorized ? 7 : failed ? 8 : 5];
    },
  };
  $('serviceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy()) return;
    lock();
    failed = false;
    inFlight = true;
    changed();
    const io = getIo(),
      info = getInfo();
    try {
      await serviceLogin(io, info, $('serviceUser').value.trim(), $('servicePassword').value);
      if (io !== getIo() || !io.connected || info !== getInfo())
        throw new UpdateError('SERIAL_DISCONNECTED');
      bound = io;
      boundInfo = info;
      authorized = true;
      timer = setTimeout(() => {
        lock();
        changed();
      }, 600000);
    } catch {
      failed = true;
      lock();
    } finally {
      $('servicePassword').value = '';
      inFlight = false;
      changed();
    }
  });
  $('serviceLogout')?.addEventListener('click', async () => {
    if (busy()) return;
    inFlight = true;
    lock();
    failed = false;
    changed();
    try {
      await serviceLogout(getIo(), getInfo());
    } catch {
      if (getIo()?.connected) await getIo().close();
    } finally {
      inFlight = false;
      changed();
    }
  });
  return controller;
}
