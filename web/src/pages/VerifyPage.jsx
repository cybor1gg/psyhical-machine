import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["♣", "♦", "♥", "♠"];

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeCard(serverSeed, clientSeed, nonce) {
  const hmac = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  const int = parseInt(hmac.slice(0, 8), 16);
  const roll = int / 0x100000000;
  const index = Math.floor(roll * 52);
  return {
    index,
    roll,
    label: RANKS[index % 13] + SUITS[Math.floor(index / 13)],
    // Dragon Tower projections: the singleton tile per row width. Same roll,
    // different scaling — one verifier serves every game.
    positions: { 2: Math.floor(roll * 2), 3: Math.floor(roll * 3), 4: Math.floor(roll * 4) },
    // Dice: the roll scaled to 0.00–99.99 (10,000 outcomes).
    dice: Math.floor(roll * 10000) / 100,
    // Plinko: the left/right decision for this nonce's row.
    plinko: Math.floor(roll * 2),
    // Roulette: the winning pocket 0..36.
    roulette: Math.floor(roll * 37),
    // Limbo: the crash-style result at the platform default edge (1%). An
    // operator RTP override changes (1 − edge) — the round receipt shows it.
    limbo: Math.max(1, Math.floor((0.99 / (1 - roll)) * 100) / 100),
    // Chicken Cross: a lane is deadly iff roll < death — shown for every
    // difficulty's death chance so one verifier covers all four.
    chicken: {
      easy: roll < 0.05,
      medium: roll < 0.12,
      hard: roll < 0.24,
      daredevil: roll < 0.45,
    },
  };
}

// Mines draws WITHOUT replacement: the k-th roll picks from the tiles that
// remain. Feed it the round's rolls in nonce order.
function minesFromRolls(rolls) {
  const remaining = Array.from({ length: 25 }, (_, i) => i);
  return rolls.map((f) => {
    const idx = Math.floor(f * remaining.length);
    const tile = remaining[idx];
    remaining.splice(idx, 1);
    return tile;
  });
}

// Keno: the same removal rule over the numbers 1..40.
function kenoFromRolls(rolls) {
  const remaining = Array.from({ length: 40 }, (_, i) => i + 1);
  return rolls.map((f) => {
    const idx = Math.floor(f * remaining.length);
    const n = remaining[idx];
    remaining.splice(idx, 1);
    return n;
  });
}

// Which game the nonces belong to. The math is IDENTICAL for every game —
// one HMAC(serverSeed, clientSeed:nonce) per card — the game only changes how
// you READ the chain. Blackjack has a published draw order; Hi-Lo is simply
// one card per action (table card, guesses, skips) in play order.
const GAME_INFO = {
  hilo: {
    label: "Hi-Lo",
    note: "One card per action, in play order: the table card first, then every guess and skip.",
    role: () => null,
  },
  blackjack: {
    label: "Blackjack",
    note: "Draw order per round: your two cards, the dealer's up-card, the dealer's HOLE card (committed before you act), then hits and dealer draws in play order. Start the nonce range at the round's first card.",
    role: (k) => ["Your card 1", "Your card 2", "Dealer up", "Dealer hole"][k] || "In play order",
  },
  war: {
    label: "War",
    note: "Draw order per round: your card, the dealer's card, and if you went to war, your war card then the dealer's war card. Start the nonce range at the round's first card.",
    role: (k) => ["Your card", "Dealer card", "Your war card", "Dealer war card"][k] || "Next round",
  },
  tower: {
    label: "Dragon Tower",
    note: "One nonce per row, bottom to top (9 rows per round). The roll picks a tile index: floor(roll × tiles). That index is the dragon on easy/medium/hard, or the single safe egg on expert/master. The positions shown below are that index for each row width.",
    role: (k) => (k < 9 ? `Row ${k + 1}` : "Next round"),
  },
  dice: {
    label: "Dice",
    note: "One nonce per roll: the number is floor(roll × 10000) / 100: exactly 10,000 equally likely outcomes from 0.00 to 99.99. Over wins strictly above your target, under strictly below.",
    role: () => null,
  },
  limbo: {
    label: "Limbo",
    note: "One nonce per roll: result = (1 − houseEdge) / (1 − roll), truncated to 2 decimals (minimum 1.00×). Shown here at the 1% platform default; your round receipt shows the exact edge it played under.",
    role: () => null,
  },
  mines: {
    label: "Mines",
    note: "One nonce per mine, drawn WITHOUT replacement: the k-th roll picks floor(roll × tilesRemaining) from the tiles not yet taken (of 25). Set the nonce range to exactly the round's mine draws (first nonce + number of mines); the positions below apply the removal rule in order.",
    role: (k) => `Mine ${k + 1}`,
  },
  chicken: {
    label: "Chicken Cross",
    note: "One nonce per lane, left to right — every lane is claimed atomically at bet time. A lane is DEADLY iff roll < death, the difficulty's per-lane death chance: Easy 5% (24 lanes), Medium 12% (22), Hard 24% (18), Daredevil 45% (13). Set the range to the round's lanes (nonceStart + lanes) and read the row for the difficulty you played.",
    role: (k) => `Lane ${k + 1}`,
  },
  plinko: {
    label: "Plinko",
    note: "One nonce per row: direction = floor(roll × 2): 0 bounces LEFT, 1 bounces RIGHT. The bucket is simply the count of rights. Set the range to the round's rows (nonceStart + rows) and compare with the path you watched.",
    role: (k) => `Row ${k + 1}`,
  },
  keno: {
    label: "Keno",
    note: "Ten nonces per round, drawn WITHOUT replacement from 1..40: the k-th roll picks floor(roll × numbersRemaining) from the numbers not yet drawn. Set the range to exactly the round's 10 draws; the numbers below apply the removal rule in order.",
    role: (k) => (k < 10 ? `Draw ${k + 1}` : "Next round"),
  },
  roulette: {
    label: "Roulette",
    note: "One nonce per spin: pocket = floor(roll × 37) → 0..36. 37 equal pockets, one green zero, so the edge is exactly 2.70% on every bet.",
    role: () => null,
  },
  baccarat: {
    label: "Baccarat",
    note: "Six card nonces per coup, positional: Player 1&2, Banker 1&2, then Player third and Banker third (used only if that hand draws under the fixed tableau). Set the range to the coup's first nonce + 6. Card = index 0..51, rank = index % 13 (0=Two .. 12=Ace).",
    role: (k) => ["Player 1", "Player 2", "Banker 1", "Banker 2", "Player 3rd", "Banker 3rd"][k] || "Next coup",
  },
};

export default function VerifyPage() {
  const [game, setGame] = useState("hilo");
  const [serverSeed, setServerSeed] = useState("");
  const [expectedHash, setExpectedHash] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [nonceFrom, setNonceFrom] = useState(0);
  const [nonceTo, setNonceTo] = useState(5);
  const [hashResult, setHashResult] = useState(null);
  const [cards, setCards] = useState([]);
  const [authed, setAuthed] = useState(false);
  const navigate = useNavigate();

  // The whole site is players-only. Embed players pass too: the Fair Play link
  // opens this page in a new tab and their session cookie (set at token
  // exchange) rides along on the /api/me call.
  useEffect(() => {
    apiGet("/api/me").then(({ ok }) => {
      if (!ok) return navigate("/login");
      setAuthed(true);
    });
  }, []);

  if (!authed) return <p className="text-center mt-24">Loading...</p>;

  async function verify() {
    setHashResult(null);
    setCards([]);

    if (expectedHash.trim()) {
      const computed = await sha256Hex(serverSeed.trim());
      setHashResult(computed === expectedHash.trim().toLowerCase());
    }

    const from = Number(nonceFrom);
    const to = Number(nonceTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 200) return;

    const results = [];
    for (let n = from; n <= to; n++) {
      const card = await computeCard(serverSeed.trim(), clientSeed.trim(), n);
      results.push({ nonce: n, ...card });
    }
    // Mines / Keno: apply the without-replacement rule across the range, in order.
    if (game === "mines") {
      const tiles = minesFromRolls(results.map((r) => r.roll));
      results.forEach((r, k) => (r.mineTile = tiles[k]));
    }
    if (game === "keno") {
      const nums = kenoFromRolls(results.map((r) => r.roll));
      results.forEach((r, k) => (r.kenoNumber = nums[k]));
    }
    setCards(results);
  }

  return (
    <main className="max-w-lg mx-auto mt-12 px-4">
      <h1 className="text-2xl font-bold mb-2">Verify a round</h1>
      <p className="text-sm text-gray-600 mb-6">
        All computation happens in your browser. Rotate your seed to reveal the
        server seed, then check it against the hash you were shown before playing.
      </p>

      {/* game selector — same math either way; it changes how the chain reads */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {Object.entries(GAME_INFO).map(([key, info]) => (
          <button key={key} onClick={() => setGame(key)}
            style={{
              padding: "8px 18px", borderRadius: 6, cursor: "pointer",
              fontWeight: 700, fontSize: 14,
              border: game === key ? "2px solid #2563eb" : "1px solid #cbd5e1",
              background: game === key ? "#2563eb" : "transparent",
              color: game === key ? "#fff" : "inherit",
            }}>
            {info.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-gray-600 mb-4">{GAME_INFO[game].note}</p>

      <div className="space-y-3">
        <input
          value={serverSeed}
          onChange={(e) => setServerSeed(e.target.value)}
          placeholder="Revealed server seed"
          className="w-full border rounded px-3 py-2 font-mono text-sm"
        />
        <input
          value={expectedHash}
          onChange={(e) => setExpectedHash(e.target.value)}
          placeholder="Server seed hash (shown before playing)"
          className="w-full border rounded px-3 py-2 font-mono text-sm"
        />
        <input
          value={clientSeed}
          onChange={(e) => setClientSeed(e.target.value)}
          placeholder="Client seed"
          className="w-full border rounded px-3 py-2 font-mono text-sm"
        />
        <div className="flex gap-3 items-center">
          <label className="text-sm">Nonces</label>
          <input
            type="number"
            value={nonceFrom}
            onChange={(e) => setNonceFrom(e.target.value)}
            className="border rounded px-2 py-1 w-24"
          />
          <span>to</span>
          <input
            type="number"
            value={nonceTo}
            onChange={(e) => setNonceTo(e.target.value)}
            className="border rounded px-2 py-1 w-24"
          />
        </div>
        <button
          onClick={verify}
          className="bg-blue-600 text-white px-6 py-2 rounded font-semibold"
        >
          Verify
        </button>
      </div>

      {hashResult !== null && (
        <p className={`mt-6 font-semibold ${hashResult ? "text-green-600" : "text-red-600"}`}>
          {hashResult
            ? "✓ Hash matches. The server committed to this seed before you played"
            : "✗ Hash does NOT match. This seed is not the one committed"}
        </p>
      )}

      {cards.length > 0 && (
        <div className="mt-6">
          <h2 className="font-semibold mb-2">
            {game === "tower" ? "Recomputed tile positions"
              : game === "chicken" ? "Recomputed lanes"
              : game === "dice" ? "Recomputed rolls"
              : game === "limbo" ? "Recomputed results"
              : game === "mines" ? "Recomputed mine positions"
              : game === "plinko" ? "Recomputed bounce directions"
              : game === "keno" ? "Recomputed drawn numbers"
              : game === "roulette" ? "Recomputed pockets"
              : "Recomputed cards"}
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {cards.map((c, k) => {
              const role = GAME_INFO[game].role(k);
              return (
                <div key={c.nonce} className="border rounded p-2 text-center">
                  <div className="text-xs text-gray-500">#{c.nonce}</div>
                  {game === "tower" ? (
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.6 }}>
                      <div>2 tiles → #{c.positions[2]}</div>
                      <div>3 tiles → #{c.positions[3]}</div>
                      <div>4 tiles → #{c.positions[4]}</div>
                    </div>
                  ) : game === "chicken" ? (
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.6 }}>
                      <div>Easy (5%) → {c.chicken.easy ? "DEADLY" : "safe"}</div>
                      <div>Medium (12%) → {c.chicken.medium ? "DEADLY" : "safe"}</div>
                      <div>Hard (24%) → {c.chicken.hard ? "DEADLY" : "safe"}</div>
                      <div>Daredevil (45%) → {c.chicken.daredevil ? "DEADLY" : "safe"}</div>
                    </div>
                  ) : game === "dice" ? (
                    <div className="text-xl font-bold">{c.dice.toFixed(2)}</div>
                  ) : game === "limbo" ? (
                    <div className="text-xl font-bold">{c.limbo.toFixed(2)}×</div>
                  ) : game === "mines" ? (
                    <div className="text-xl font-bold">tile {c.mineTile}</div>
                  ) : game === "plinko" ? (
                    <div className="text-xl font-bold">{c.plinko === 1 ? "RIGHT" : "LEFT"}</div>
                  ) : game === "keno" ? (
                    <div className="text-xl font-bold">{c.kenoNumber}</div>
                  ) : game === "roulette" ? (
                    <div className="text-xl font-bold">{c.roulette}</div>
                  ) : game === "baccarat" ? (
                    <div className="text-xl font-bold">{c.label}</div>
                  ) : (
                    <div className="text-xl font-bold">{c.label}</div>
                  )}
                  {role && <div className="text-xs text-gray-500" style={{ marginTop: 2 }}>{role}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}