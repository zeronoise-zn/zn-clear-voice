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
