/**
 * Sidebar-mode helpers. Kept pure (no DOM, no extension calls beyond what is
 * passed in) so the decisions can be unit tested.
 *
 * The same popup.html serves both the toolbar popup and the Firefox sidebar.
 * The difference is behavioural: a popup is opened deliberately on one tab and
 * dies on blur; a sidebar stays open while the user browses, so it has to
 * notice when the active tab changes and follow it.
 */

/** Is this window the extension's sidebar panel rather than its popup? */
export function isSidebarView(ext, win) {
  try {
    const views = ext && ext.extension && typeof ext.extension.getViews === 'function'
      ? ext.extension.getViews({ type: 'sidebar' })
      : [];
    if (Array.isArray(views) && views.includes(win)) return true;
  } catch {
    // Older builds without a sidebar view type fall through to the URL check.
  }
  try {
    const params = new URLSearchParams(win.location.search || '');
    return params.get('mode') === 'sidebar' || win.location.hash === '#sidebar';
  } catch {
    return false;
  }
}

/** Should the sidebar start a scan for what it just detected? */
export function shouldRescan(prevAddress, detection, settings) {
  if (!detection || !detection.ok || !detection.address) return false;
  // Several tokens on the page and nothing singling one out: show the choice,
  // do not scan whichever sorted first.
  if (detection.confidence === 'ambiguous') return false;
  if (!settings || settings.autoScanInSidebar === false) return false;
  return detection.address !== prevAddress;
}

/**
 * tabs.onUpdated fires for every title change too - and a trading page rewrites
 * its title with the live market cap every few seconds. Only navigation counts.
 */
export function isNavigationUpdate(changeInfo) {
  if (!changeInfo) return false;
  return changeInfo.url !== undefined || changeInfo.status === 'complete';
}

export function debounce(fn, ms, timers = { set: setTimeout, clear: clearTimeout }) {
  let handle = null;
  return (...args) => {
    if (handle !== null) timers.clear(handle);
    handle = timers.set(() => {
      handle = null;
      fn(...args);
    }, ms);
  };
}
