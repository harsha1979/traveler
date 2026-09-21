/**
 * Guards the travel-api contract routes (src/routes/travelApi.js) from
 * the booking-agent/MCP implementation brief. Callers there — the future
 * traveler-mcp and flights-mcp servers — authenticate with a single
 * shared service credential, TRAVEL_API_KEY, sent as a standard bearer
 * token:
 *
 *   Authorization: Bearer <TRAVEL_API_KEY>
 *
 * IMPORTANT BOUNDARY: this is a service-to-service credential, not a
 * per-user token, and it proves "this call comes from the trusted MCP
 * layer" — not "this call is on behalf of traveler X." Per the brief's
 * own architecture, resolving and verifying the actual end-user identity
 * (including delegated `act`/`sub` tokens) is the MCP servers' job: they
 * validate the caller's OAuth token and derive traveler_id from its
 * subject *before* ever calling this API. Re-implementing that same
 * check here isn't meaningful against a single shared static key — there
 * is no per-call subject in it to compare against. For real
 * defense-in-depth at this layer too, replace TRAVEL_API_KEY with
 * per-caller signed tokens (mTLS client certs, or JWTs the MCP layer
 * mints) and validate a genuine subject claim here instead.
 */
function requireTravelApiToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  const expected = process.env.TRAVEL_API_KEY;

  if (!expected || expected === "replace-with-a-long-random-value") {
    return res.status(500).json({ error: "server_misconfigured", message: "TRAVEL_API_KEY is not set." });
  }

  if (scheme !== "Bearer" || token !== expected) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid or missing bearer token." });
  }

  next();
}

module.exports = { requireTravelApiToken };
