(() => {
  'use strict';

  function arrangeReleasePanel() {
    const panel = document.getElementById('releasePanel');
    const hint = document.getElementById('firmwareVersionHint');
    if (!panel || !hint) return false;

    if (hint.parentElement !== panel) panel.insertBefore(hint, panel.firstChild);
    panel.classList.add('public-release-layout');
    return true;
  }

  function start() {
    if (arrangeReleasePanel()) return;

    const root = document.querySelector('.update-zone') || document.body;
    const observer = new MutationObserver(() => {
      if (arrangeReleasePanel()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });

    setTimeout(() => observer.disconnect(), 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
