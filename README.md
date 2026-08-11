# MTech Cabinet

Physical casino cabinet product built from the proven MTech Originals online
casino (`mtech-casino-v2`). The machine — not a person — is the permanent
account: it authenticates itself with a machine key at boot, cash inserted
into the bill validator becomes credits on its balance, and all 12 Originals
games run unchanged on top of the existing game/wallet/RNG/payout code.

## Layout

- `api/` — Express 5 + Mongoose API (from the online project, minus the
  operator/embed/partner B2B layer, plus `/api/cabinet/*`).
- `web/` — React (Vite) kiosk frontend: boots as the machine, no login,
  lobby with live credits, all 12 games, `/admin` backoffice for staff.
- `launcher/` — Windows start scripts (`start-dev.ps1` for development).
- `tools/`, `data/` — portable MongoDB and its data directory (gitignored).
- `docs/api-conventions.md` — the game API rules inherited from the source
  project. Still authoritative for any new game.

## First-time setup

1. `npm install` in both `api/` and `web/`.
2. Portable MongoDB: unzip the official Windows zip into
   `tools/mongodb-win32-x86_64-windows-8.0.4/` (or point `MONGODB_URI` at any
   MongoDB instance).
3. `api/.env` — copy `api/.env.example`, set a fresh `JWT_SECRET`.
4. Create the machine and an admin:
   ```bash
   node api/scripts/seed.js cabinet CABINET-0001
   node api/scripts/seed.js admin admin@example.com <password>
   ```
5. Put the printed machine key into `web/public/cabinet.config.json`
   (copy the `.example` file). This file is the machine's identity and is
   gitignored.

## Run (dev)

```bash
powershell -File launcher/start-dev.ps1
```

or by hand: start mongod on port 27018, `npm run dev` in `api/`, `npm run
dev` in `web/`, open http://localhost:3000.

The kiosk boots straight into the lobby as the configured cabinet. Press
**F9** (or the DEV·CASH chip) to open the bill-validator simulator and insert
notes. `/admin` (staff login at `/login`) shows game configs, the bets feed,
totals and the audit trail.

## What the cabinet layer adds

- `POST /api/cabinet/session` — machine-key handshake → standard session JWT.
- `GET /api/cabinet/state` — cabinet id, credits, accepted denominations.
- `POST /api/cabinet/cash-in` — one accepted note → wallet credit + a
  `CashEvent` ledger row (the ledger reconciles against the physical cash box).
- `web/src/kiosk/` — `CabinetGate` (boot handshake, staff-path bypass) and
  `CashSimulator` (dev stand-in for the validator; the real driver will call
  the same endpoint).

## Not built yet (deliberately)

- Real bill-validator driver (waiting on hardware choice; the simulator
  defines the contract).
- Cash-out / redemption flow (attendant pay vs TITO — product decision).
- Production Windows kiosk launcher (Task Scheduler + browser `--kiosk`,
  watchdog, auto-login).
- Backoffice cabinets view (per-machine cash ledger, reconciliation,
  heartbeat) and multi-machine registration UI.
- In-game credits display and touch polish (on-screen numpad, bigger chrome
  buttons, attract screen).
