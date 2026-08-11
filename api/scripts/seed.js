// One-time setup for a fresh cabinet database:
//
//   node scripts/seed.js cabinet CABINET-0001
//     → creates the machine and prints its machine key ONCE. Put the key in
//       the machine's web/public/cabinet.config.json.
//
//   node scripts/seed.js admin admin@example.com <password>
//     → creates a backoffice admin (role admin) for /admin.
//
// Safe to re-run: existing cabinetId/email refuses instead of overwriting.
import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import { hashMachineKey } from "../routes/cabinet.js";

const [, , kind, a, b] = process.argv;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  if (kind === "cabinet") {
    const cabinetId = (a || "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,}$/.test(cabinetId)) {
      throw new Error("Usage: node scripts/seed.js cabinet CABINET-0001");
    }
    if (await User.findOne({ cabinetId })) {
      throw new Error(`${cabinetId} already exists — refusing to overwrite its key.`);
    }
    const machineKey = "cab_" + crypto.randomBytes(24).toString("hex");
    await User.create({ cabinetId, machineKeyHash: hashMachineKey(machineKey), role: "cabinet", balance: 0 });
    console.log(`Created ${cabinetId}`);
    console.log(`Machine key (save it now — it is stored only as a hash):`);
    console.log(`  ${machineKey}`);
    return;
  }

  if (kind === "admin") {
    const email = (a || "").toLowerCase().trim();
    const password = b || "";
    if (!email.includes("@") || password.length < 8) {
      throw new Error("Usage: node scripts/seed.js admin admin@example.com <password min 8 chars>");
    }
    if (await User.findOne({ email })) {
      throw new Error(`${email} already exists.`);
    }
    await User.create({ email, passwordHash: await bcrypt.hash(password, 12), role: "admin", balance: 0 });
    console.log(`Created admin ${email}`);
    return;
  }

  throw new Error("Usage: node scripts/seed.js cabinet <CABINET-ID> | admin <email> <password>");
}

main()
  .then(() => mongoose.disconnect())
  .catch((err) => {
    console.error(err.message);
    return mongoose.disconnect().then(() => process.exit(1));
  });
