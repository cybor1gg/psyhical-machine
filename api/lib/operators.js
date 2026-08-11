import crypto from "crypto";
import Operator from "../models/Operator.js";

export function generateApiKey() {
  return "opk_" + crypto.randomBytes(32).toString("hex");
}

export function hashApiKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function getOperatorFromRequest(request) {
  const key = request.headers["x-api-key"];
  if (!key) return null;

  const operator = await Operator.findOne({
    apiKeyHash: hashApiKey(key),
    active: true,
  });

  return operator;
}