// Kiosk lockdown — the page only responds to what a player is supposed to
// touch. Installed by CabinetGate on machine sessions (never staff pages).
// Together with body.kiosk-lock CSS (no selection/drag, touch-action:
// manipulation) this blocks: right-click menu, drag-and-drop, ctrl+wheel and
// keyboard zoom, pinch gestures, find/print/save/view-source shortcuts and
// browser-history side swipes. The production launcher's --kiosk flags cover
// what a web page can't (browser chrome, F11/Alt-F4, edge swipes).

// Keyboard shortcuts that must die inside the page: zoom (+ - = 0 with
// ctrl/meta) and browser features a player should never open.
const BLOCKED_CTRL_KEYS = new Set(["+", "-", "=", "0", "p", "s", "u", "f", "g", "j", "o", "h"]);

export function installKioskLockdown() {
  const body = document.body;
  body.classList.add("kiosk-lock");

  const isTypable = (t) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");

  const onContextMenu = (e) => e.preventDefault();
  const onDragStart = (e) => e.preventDefault();
  const onWheel = (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && BLOCKED_CTRL_KEYS.has(e.key.toLowerCase())) e.preventDefault();
  };
  // Double/triple-click must never start an image or text selection — only
  // the first click of a burst reaches the UI as a plain click anyway.
  const onMouseDown = (e) => { if (e.detail > 1 && !isTypable(e.target)) e.preventDefault(); };
  // Belt over the user-select CSS: nothing outside a typable field ever
  // starts a selection.
  const onSelectStart = (e) => { if (!isTypable(e.target)) e.preventDefault(); };
  // Middle-click (auxclick) opens links in new tabs on some setups.
  const onAuxClick = (e) => { if (e.button !== 0) e.preventDefault(); };
  // Safari-style pinch gesture events (harmless elsewhere).
  const onGesture = (e) => e.preventDefault();

  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("selectstart", onSelectStart);
  document.addEventListener("auxclick", onAuxClick);
  document.addEventListener("gesturestart", onGesture);
  document.addEventListener("gesturechange", onGesture);

  window.__kioskLockdown = true;

  return () => {
    body.classList.remove("kiosk-lock");
    document.removeEventListener("contextmenu", onContextMenu);
    document.removeEventListener("dragstart", onDragStart);
    document.removeEventListener("wheel", onWheel);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("selectstart", onSelectStart);
    document.removeEventListener("auxclick", onAuxClick);
    document.removeEventListener("gesturestart", onGesture);
    document.removeEventListener("gesturechange", onGesture);
    window.__kioskLockdown = false;
  };
}
