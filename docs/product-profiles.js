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

/**
 * Contratti espliciti dei prodotti: indirizzo app, capienza, vettori e politica
 * di firma. Non dedurre un prodotto dalla sola dimensione Flash o disabilitare
 * i controlli ClearVoice per accettare i pacchetti HEADSET_BT.
 */
// Explicit profiles: no density/product guessing and no weakening of legacy guards.
export const PRODUCT_PROFILES = Object.freeze([
  Object.freeze({
    id: 0x48575643,
    name: 'ClearVoice',
    family: 'CVWH',
    base: 0x08008000,
    maxImage: 0x37800,
    ramEnd: 0x20020000,
    vectorWords: 118,
    flashKb: Object.freeze([256, 512]),
    mcu: 'STM32G474',
    signatureRequired: true,
  }),
  Object.freeze({
    id: 0x48575442,
    name: 'HEADSET_BT',
    family: 'BTWH',
    base: 0x08005000,
    maxImage: 0xa800,
    ramEnd: 0x20005fe0,
    vectorWords: 48,
    flashKb: Object.freeze([64]),
    mcu: 'STM32C071G8U6',
    signatureRequired: false,
  }),
]);
export const profileById = (id) => PRODUCT_PROFILES.find((p) => p.id === id);
export const profileByName = (name) => PRODUCT_PROFILES.find((p) => p.name === name);
export const profileByFamily = (family) => PRODUCT_PROFILES.find((p) => p.family === family);
