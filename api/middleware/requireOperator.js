import { getOperatorFromRequest } from "../lib/operators.js";

export async function requireOperator(req, res, next) {
  const operator = await getOperatorFromRequest(req);
  if (!operator) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  req.operator = operator;
  next();
}