const express = require("express");

const router = express.Router();

const THUNDERID_BASE_URL = process.env.THUNDERID_BASE_URL;
const TOKEN_PATH = process.env.THUNDERID_TOKEN_PATH || "/oauth2/token";

/**
 * POST /api/auth/token — exchanges an OAuth2 authorization code for
 * tokens, on behalf of the browser.
 *
 * Why this exists: ThunderID's /oauth2/token endpoint does not send
 * CORS headers (confirmed: an OPTIONS preflight to it returns 405, no
 * Access-Control-Allow-Origin), so a browser can never call it directly
 * — the request gets blocked by the browser itself before it even
 * reaches ThunderID. This is common for OIDC token endpoints; the fix
 * is a small server-side proxy like this one, since CORS is a
 * browser-only restriction and doesn't apply to this server calling
 * ThunderID.
 *
 * Body: { code, redirect_uri, client_id, code_verifier, client_secret? }
 * (all values the frontend already has — none of them are secret for a
 * public/PKCE client, so there's nothing sensitive added by proxying
 * this call through the backend).
 *
 * If the ThunderID application was registered as a *confidential*
 * client (requires client_secret_post/basic instead of "none"), set
 * THUNDERID_CLIENT_SECRET in this server's .env instead of ever putting
 * it in js/config.js — it stays server-side only, which is exactly
 * where a real secret belongs. A client_secret sent in the request body
 * (there isn't one today - the frontend leaves it blank) would still
 * take precedence if ever needed.
 */
router.post("/token", express.json(), async (req, res) => {
  const { code, redirect_uri, client_id, code_verifier, client_secret } = req.body || {};

  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return res.status(400).json({
      error: "invalid_request",
      message: "code, redirect_uri, client_id, and code_verifier are all required.",
    });
  }

  const effectiveClientSecret = client_secret || process.env.THUNDERID_CLIENT_SECRET;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri,
    client_id,
    code_verifier,
  });
  if (effectiveClientSecret) {
    body.set("client_secret", effectiveClientSecret);
  }

  try {
    const response = await fetch(`${THUNDERID_BASE_URL}${TOKEN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("ThunderID token exchange rejected:", response.status, data);
      return res.status(response.status).json(
        data || { error: "token_exchange_failed", message: "ThunderID rejected the token exchange." }
      );
    }

    res.json(data);
  } catch (err) {
    console.error("ThunderID token exchange failed (network):", err);
    res.status(502).json({ error: "idp_unreachable", message: "Could not reach ThunderID to exchange the code." });
  }
});

module.exports = router;
