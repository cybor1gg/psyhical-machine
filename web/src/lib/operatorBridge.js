// Cabinet stub of the old operator iframe bridge. The online product posted
// balance updates to a host casino via postMessage; a cabinet has no host, so
// every reporter is a no-op. The game components keep their call sites — the
// sequence numbers still order optimistic balance updates locally.

let seq = 0;

export function nextBalanceSeq() {
  return ++seq;
}

export function seedBalance() {}
export function reportBalance() {}
export function reportStakeDebit() {}
export function reportRoundEnd() {}
