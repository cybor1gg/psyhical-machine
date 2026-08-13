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

Four steps, in this order. (Commands shown for **Fedora / RHEL / Rocky**;
see the table below for other distros.)

### 1. Install git and Node.js

Both are needed before you can clone or build:

```bash
sudo dnf install -y git nodejs npm
```

Check what you got — Node must be **20 or newer**:

```bash
git --version
node -v
```

If Node is older than 20, install a current one with
[nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22
```

### 2. Download the cabinet

```bash
git clone https://github.com/cybor1gg/psyhical-machine.git
cd psyhical-machine
```

### 3. Set it up — once per machine

```bash
bash setup-linux.sh
```

Installs dependencies, downloads the MongoDB build for your distro into
`runtime/`, generates this machine's identity and secrets, and builds the
kiosk. Takes a couple of minutes. Re-running it is safe.

### 4. Start it

```bash
bash run-linux.sh
```

The cabinet opens fullscreen. Stop it with `bash stop-linux.sh`.

---

### Installing the prerequisites on other distros

| Distro | Step 1 command |
|---|---|
| Fedora / RHEL / Rocky / Alma | `sudo dnf install -y git nodejs npm` |
| Debian / Ubuntu / Mint | `sudo apt install -y git nodejs npm` |
| Arch / Manjaro | `sudo pacman -S --noconfirm git nodejs npm` |
| openSUSE | `sudo zypper install -y git nodejs npm` |

Setup also needs `curl` and `tar` — present by default on all of the above;
if not, it tells you the exact command.

Alpine/musl is **not** supported: the official MongoDB builds require glibc.

### Browser for kiosk mode

`run-linux.sh` uses whichever it finds, in order: Chrome / Chromium / Brave /
Vivaldi / Opera / Edge (system or flatpak), then **Firefox** (`--kiosk`, from
Firefox 71), then your default browser (press F11 for fullscreen). Firefox
usually ships with Fedora, so nothing to do — otherwise:

```bash
sudo dnf install -y firefox
flatpak install flathub org.chromium.Chromium   # works on any distro
```

If the database fails to start it is almost always a missing system library.
The script prints the right command for your distro; on Fedora/RHEL that is
`sudo dnf install -y openssl-libs libcurl cyrus-sasl-lib`.

### Set up a specific machine

```bash
bash setup-linux.sh CABINET-0007
```

Each machine generates its own random key in `web/public/cabinet.config.json`
(never committed) and its own `JWT_SECRET` in `api/.env` (never committed).

---

## Development

The stack is plain Node + Vite, so you can develop on any OS:

```bash
npm install --prefix api && npm install --prefix web
npm run dev --prefix api      # API on :5001
npm run dev --prefix web      # kiosk with hot reload on :3000
```

You need a MongoDB on `mongodb://127.0.0.1:27018/cabinet` (or point
`MONGODB_URI` elsewhere) and an `api/.env` — `setup-linux.sh` writes one, or
copy `api/.env.example`. **Cabinets themselves run Linux**; that is the only
target the launchers support.

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
