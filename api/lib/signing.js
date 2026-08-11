import crypto from "crypto";

export function signPayload(payload, secret) {
  const body = JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(rawBody, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature || "", "hex");

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export function generateSharedSecret() {
  return "whsec_" + crypto.randomBytes(32).toString("hex");
}