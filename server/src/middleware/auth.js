const pool = require("../db");

const THUNDERID_BASE_URL = process.env.THUNDERID_BASE_URL;
const USERINFO_PATH = process.env.THUNDERID_USERINFO_PATH || "/oauth2/userinfo";

/**
 * Verifies the caller's ThunderID access token by calling the IdP's
 * /oauth2/userinfo endpoint, then finds-or-creates a local `travelers`
 * row for that user. Attaches `req.traveler` ({ id, external_sub, email,
 * full_name }) on success.
 *
 * This is the "real" verification path (Option A from setup): it does a
 * network round-trip to ThunderID per request. For a production app,
 * consider verifying the access token as a signed JWT locally against
 * ThunderID's JWKS (see /oauth2/jwks) to avoid that round-trip — the
 * userinfo call is simpler to reason about for a demo.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "unauthorized", message: "Missing bearer access token." });
  }

  try {
    const response = await fetch(`${THUNDERID_BASE_URL}${USERINFO_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return res.status(401).json({ error: "unauthorized", message: "Access token rejected by ThunderID." });
    }

    const userinfo = await response.json();
    const sub = userinfo.sub;
    const email = userinfo.email || `${sub}@unknown.local`;
    const fullName = userinfo.name || [userinfo.given_name, userinfo.family_name].filter(Boolean).join(" ") || null;

    if (!sub) {
      return res.status(401).json({ error: "unauthorized", message: "ThunderID userinfo response missing `sub`." });
    }

    const [existing] = await pool.execute("SELECT id, external_sub, email, full_name FROM travelers WHERE external_sub = :sub", {
      sub,
    });

    let traveler;
    if (existing.length > 0) {
      traveler = existing[0];
      if (traveler.email !== email || traveler.full_name !== fullName) {
        await pool.execute("UPDATE travelers SET email = :email, full_name = :fullName WHERE id = :id", {
          email,
          fullName,
          id: traveler.id,
        });
        traveler = { ...traveler, email, full_name: fullName };
      }
    } else {
      const [result] = await pool.execute(
        "INSERT INTO travelers (external_sub, email, full_name) VALUES (:sub, :email, :fullName)",
        { sub, email, fullName }
      );
      traveler = { id: result.insertId, external_sub: sub, email, full_name: fullName };
    }

    req.traveler = traveler;
    next();
  } catch (err) {
    console.error("Auth verification failed:", err);
    return res.status(502).json({ error: "idp_unreachable", message: "Could not reach ThunderID to verify the access token." });
  }
}

module.exports = { requireAuth };
