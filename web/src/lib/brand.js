// Operator white-labeling for in-game brand marks (card backs). The embed
// exchange hands us the operator's name; direct site play keeps the MTech
// mark. Kept in sessionStorage alongside the session so an in-iframe refresh
// stays branded; storage can throw in strict privacy modes — then memory-only.
const KEY = "mtb_brand";
let brand = null;
try { brand = window.sessionStorage.getItem(KEY); } catch { /* memory-only */ }

export function setBrandName(name) {
  brand = (typeof name === "string" && name.trim()) ? name.trim() : null;
  try {
    if (brand) window.sessionStorage.setItem(KEY, brand);
    else window.sessionStorage.removeItem(KEY);
  } catch { /* memory-only */ }
}

// Uppercased for the card back; bounded so exotic names can't wreck the mark.
export function getBrandMark() {
  return (brand || "MTech").toUpperCase().slice(0, 14);
}

// Try-mode flag, same discipline as the brand: the embed exchange sets it,
// the shared game chrome reads it (the DEMO chip in the bottom bar), and
// sessionStorage keeps it across an in-iframe refresh.
const DEMO_KEY = "mtb_demo";
let demoMode = false;
try { demoMode = window.sessionStorage.getItem(DEMO_KEY) === "1"; } catch { /* memory-only */ }

export function setDemoMode(on) {
  demoMode = !!on;
  try {
    if (demoMode) window.sessionStorage.setItem(DEMO_KEY, "1");
    else window.sessionStorage.removeItem(DEMO_KEY);
  } catch { /* memory-only */ }
}

export function isDemoMode() {
  return demoMode;
}
