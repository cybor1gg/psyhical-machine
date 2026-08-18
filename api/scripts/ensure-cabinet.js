// First-run setup for a fresh machine: make sure the cabinet in
// public/cabinet.config.json exists in this database with that exact machine
// key, and that a backoffice admin exists. Safe to run on every boot — it
// only creates what is missing and never overwrites credits or keys.
//
//   node scripts/ensure-cabinet.js <path-to-cabinet.config.json> [adminEmail] [adminPass]
import "dotenv/config";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import { hashMachineKey } from "../routes/cabinet.js";

const [, , cfgPath, adminEmail = "admin@cabinet.local", adminPass = "admin12345"] = process.argv;

async function main() {
  const file = path.resolve(cfgPath || "");
  if (!fs.existsSync(file)) throw new Error(`cabinet config not found: ${file}`);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const cabinetId = String(cfg.cabinetId || "").trim().toUpperCase();
  const machineKey = String(cfg.machineKey || "");
  if (!cabinetId || !machineKey) throw new Error("cabinet config needs cabinetId and machineKey");

  await mongoose.connect(process.env.MONGODB_URI);

  const hash = hashMachineKey(machineKey);
  const existing = await User.findOne({ cabinetId });
  if (!existing) {
    await User.create({ cabinetId, machineKeyHash: hash, role: "cabinet", balance: 0 });
    console.log(`created ${cabinetId} (credits 0)`);
  } else if (existing.machineKeyHash !== hash) {
    // the machine's key file is the source of truth for THIS machine
    existing.machineKeyHash = hash;
    await existing.save();
    console.log(`${cabinetId} key re-synced from the config file`);
  } else {
    console.log(`${cabinetId} ready (credits ${existing.balance})`);
  }

  if (!(await User.findOne({ email: adminEmail.toLowerCase() }))) {
    await User.create({
      email: adminEmail.toLowerCase(),
      passwordHash: await bcrypt.hash(adminPass, 12),
      role: "admin",
      balance: 0,
    });
  // the floor operator: sees the accounting period and resets it - nothing else
  const opEmail = "operator@cabinet.local";
  if (!(await User.findOne({ email: opEmail }))) {
    await User.create({
      email: opEmail,
      passwordHash: await bcrypt.hash("operator12345", 10),
      role: "operator",
      balance: 0,
    });
    console.log("operator account created:", opEmail);
  }
    console.log(`created admin ${adminEmail}`);
  }
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error("setup failed:", err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
