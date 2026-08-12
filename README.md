# MTech Cabinet

Physical casino cabinet software — a touch terminal that runs the MTech
Originals games. The **machine itself is the account**: it authenticates with
a machine key at boot, cash inserted into the bill validator becomes credits,
and every outcome, payout and balance is decided by the server's
provably-fair engine.

Twelve games (Mines, Plinko, Blackjack, Dice, Limbo, Keno, Tower, Chicken
Cross, Hi-Lo, War, Baccarat, Roulette) in one space-themed kiosk UI.

---

## Quick start — Linux

```bash
git clone https://github.com/cybor1gg/psyhical-machine.git
cd psyhical-machine
bash setup-linux.sh          # one time: deps, MongoDB, identity, build
bash run-linux.sh            # start the cabinet (opens fullscreen kiosk)
```

Stop it with `bash stop-linux.sh`.

**Requirements:** 64-bit Linux and Node.js 20+ (`sudo apt install -y nodejs npm`).
Setup downloads a private MongoDB binary into `runtime/` — no system install
and no apt repository needed. For kiosk mode install a browser:
`sudo apt install -y chromium-browser`.

If the database fails to start, it is almost always a missing library:
`sudo apt install -y libcurl4 openssl`.

### Set up a specific machine

```bash
bash setup-linux.sh CABINET-0007
```

Each machine generates its own random key in `web/public/cabinet.config.json`
(never committed) and its own `JWT_SECRET` in `api/.env` (never committed).

---

## Quick start — Windows

```powershell
npm install --prefix api
npm install --prefix web
npm run build --prefix web
powershell -File launcher/start-kiosk.ps1
```

`launcher/start-dev.ps1` runs the dev servers instead (Vite on :3000, API on
:5001) with hot reload.

---

## Using the cabinet

Everything is served on one port: **http://localhost:5001**

| | |
|---|---|
| **Add credits** | `INSERT CASH` on the menu, or the note button in-game (F9 also works) |
| **Play** | drag the game carousel, press PLAY |
| **Cash out** | the gold `CASHOUT` button — pays out through the attendant |
| **Backoffice** | `/admin` — `admin@cabinet.local` / `admin12345` |
| **Leave kiosk** | Alt+F4 |

Credits live in `data/db` — copy that folder to move a machine's state,
delete it to reset the machine to zero. Do not carry a `data/db` between
Windows and Linux; the machine re-registers itself automatically.

---

## Layout

```
api/      game server — rules, RNG, payouts, wallet, backoffice API
web/      kiosk UI (React + Vite); web/src/space is the space theme
launcher/ Windows start scripts
docs/     game API conventions (authoritative for new games)
```

The server can serve the built UI itself (`STATIC_DIR`), so a cabinet runs
**one process on one port** — no dev server, no CORS.

### How a round works

The client is pure choreography; the server decides everything:

1. Press BET → the stake leaves the credits instantly (optimistic, reconciled).
2. `POST /api/games/<game>/start` → the server draws from the provably-fair
   seed chain, settles, and returns the outcome.
3. The animation plays out the server's result (Plinko's ball and Roulette's
   ball are steered to the server's bucket/pocket).
4. The win lands on the credits **only when the animation reveals it**.

---

## Autostart on a real cabinet (Linux)

`/etc/systemd/system/cabinet.service`:

```ini
[Unit]
Description=MTech Cabinet
After=network.target

[Service]
Type=simple
User=cabinet
WorkingDirectory=/home/cabinet/psyhical-machine
ExecStart=/bin/bash /home/cabinet/psyhical-machine/run-linux.sh
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cabinet
```

---

## Not built yet

- Real bill-validator driver — the hardware is not chosen; the on-screen
  INSERT CASH panel already speaks the exact endpoint the driver will use
  (`POST /api/cabinet/cash-in`).
- Ticket printing / TITO — cash-out is attendant-paid today, and every
  movement is already recorded in the `CashEvent` ledger for reconciliation.
- Fleet view in the backoffice (per-machine cash ledger, heartbeat).
