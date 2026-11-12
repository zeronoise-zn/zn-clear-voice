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
 * Solo disposizione dei blocchi visivi dopo il caricamento dinamico del
 * selettore versioni. Non legge la porta USB e non decide alcun aggiornamento.
 */
(() => {
  'use strict';

  function arrangeReleasePanel() {
    const panel = document.getElementById('releasePanel');
    const hint = document.getElementById('firmwareVersionHint');
    if (!panel || !hint) return false;

    if (hint.parentElement !== panel || panel.firstElementChild !== hint) {
      panel.insertBefore(hint, panel.firstChild);
    }
    panel.classList.add('public-release-layout');
    return true;
  }

  function start() {
    const root = document.querySelector('.update-zone') || document.body;

    // Keep the public layout stable even if the firmware selector refreshes or
    // another script updates the status nodes after connection/version changes.
    const observer = new MutationObserver(() => arrangeReleasePanel());
    observer.observe(root, { childList: true, subtree: true });

    arrangeReleasePanel();
    requestAnimationFrame(arrangeReleasePanel);
    setTimeout(arrangeReleasePanel, 100);
    setTimeout(arrangeReleasePanel, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
