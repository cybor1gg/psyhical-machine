import { verifyToken } from "../lib/auth.js";
import Operator from "../models/Operator.js";

// Partner-portal realm. Reads its OWN cookie (op_token) and REQUIRES the
// kind claim — a player/admin token in this cookie is rejected, and the
// portal token can't be replayed against player routes (no userId claim).
// operatorId always comes from the token, never from the request.
export async function requireOperatorPortal(req, res, next) {
  const token = req.cookies?.op_token;
  const payload = token ? verifyToken(token) : null;

  if (!payload || payload.kind !== "operator") {
    return res.status(401).json({ error: "Not logged in" });
  }

  const operator = await Operator.findById(payload.operatorId).select("name active");
  if (!operator || !operator.active) {
    return res.status(403).json({ error: "Operator inactive" });
  }

  req.operatorId = operator._id;
  req.operatorName = operator.name;
  req.operatorUserId = payload.operatorUserId;
  next();
}
