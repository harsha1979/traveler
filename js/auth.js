/**
 * ThunderID authentication helper
 * ---------------------------------------------------------------
 * Implements the OAuth2 Authorization Code + PKCE flow against the
 * ThunderID IdP (config in js/config.js) and keeps a small local
 * "session" so the landing page can show/hide Sign Up / Sign In /
 * Logout buttons.
 */
(function () {
  const CFG = window.THUNDER_ID_CONFIG;
  const SESSION_KEY = "tb_session";
  const PKCE_KEY = "tb_pkce_verifier";
  const STATE_KEY = "tb_oauth_state";

  // ---------- small utils ----------

  function randomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
  }

  function base64UrlEncode(bytesOrBuffer) {
    const bytes = bytesOrBuffer instanceof Uint8Array ? bytesOrBuffer : new Uint8Array(bytesOrBuffer);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /**
   * Pure-JS SHA-256 (FIPS 180-4), verified byte-for-byte against Node's
   * crypto module for empty/short/block-boundary/long inputs before
   * being wired in here.
   *
   * Why this exists: crypto.subtle (the Web Crypto API) is only
   * available in a "secure context" - https:// or http://localhost.
   * This app also needs to run over plain http:// on a bare IP (no
   * domain name means no Let's Encrypt cert, so no easy TLS), where
   * crypto.subtle is simply undefined. ThunderID only accepts the
   * S256 PKCE method (no "plain" fallback), so a real SHA-256 has to
   * happen somehow - this is that fallback, used only when
   * crypto.subtle isn't there.
   */
  function sha256Pure(bytes) {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);

    const l = bytes.length;
    const paddedLen = Math.ceil((l + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[l] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 8, Math.floor(l / 0x20000000));
    view.setUint32(paddedLen - 4, (l * 8) >>> 0);

    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const w = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }

      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }

      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i]);
    return out;
  }

  async function sha256(plain) {
    const data = new TextEncoder().encode(plain);
    if (window.isSecureContext && window.crypto && window.crypto.subtle) {
      return crypto.subtle.digest("SHA-256", data);
    }
    console.warn(
      "crypto.subtle unavailable (not a secure context - this page isn't served over https:// or localhost); " +
        "using a pure-JS SHA-256 fallback for the PKCE challenge."
    );
    return sha256Pure(data);
  }

  async function createPkcePair() {
    const verifier = randomString(64);
    const challengeBuffer = await sha256(verifier);
    const challenge = base64UrlEncode(challengeBuffer);
    return { verifier, challenge };
  }

  // ---------- session storage ----------

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function isAuthenticated() {
    return !!getSession();
  }

  // ---------- authorization code flow ----------

  /**
   * Redirects the browser to ThunderID's hosted authorize page.
   * @param {"signin"|"signup"} mode - purely informational; ThunderID's
   *   hosted page is expected to offer a "create account" link from
   *   the sign-in screen, but if your ThunderID console exposes a
   *   dedicated query param for jumping straight to registration,
   *   set it below.
   */
  async function redirectToLogin(mode) {
    const { verifier, challenge } = await createPkcePair();
    const state = randomString(32);

    sessionStorage.setItem(PKCE_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem("tb_auth_mode", mode || "signin");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: CFG.clientId,
      redirect_uri: CFG.redirectUri,
      scope: CFG.scope,
      state: state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    // Best-effort hint for ThunderID to show the registration screen.
    // Remove/replace with the real param name if your deployment differs.
    if (mode === "signup") {
      params.set("screen_hint", "signup");
    }

    window.location.href = `${CFG.baseUrl}${CFG.endpoints.authorize}?${params.toString()}`;
  }

  /**
   * Called from callback.html once ThunderID redirects back with
   * ?code=...&state=.... Exchanges the code for tokens.
   */
  async function handleRedirectCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      throw new Error(url.searchParams.get("error_description") || errorParam);
    }

    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(PKCE_KEY);

    if (!code) {
      throw new Error("Missing authorization code in callback URL.");
    }
    if (!expectedState || returnedState !== expectedState) {
      throw new Error("OAuth state mismatch - possible CSRF or stale session.");
    }

    // The exchange goes through our own backend (POST /api/auth/token),
    // not straight to ThunderID from the browser: ThunderID's /oauth2/token
    // endpoint doesn't support CORS (confirmed - an OPTIONS preflight to
    // it returns 405 with no Access-Control-Allow-Origin), so a direct
    // browser fetch is blocked before it ever reaches ThunderID. None of
    // these values are secret for a public/PKCE client, so proxying this
    // through our backend adds no exposure.
    const payload = {
      code: code,
      redirect_uri: CFG.redirectUri,
      client_id: CFG.clientId,
      code_verifier: verifier,
    };
    if (CFG.clientSecret) {
      payload.client_secret = CFG.clientSecret;
    }

    const response = await fetch(`${window.API_BASE_URL}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const tokens = await response.json().catch(() => null);

    if (!response.ok || !tokens || !tokens.access_token) {
      const detail = tokens && (tokens.error_description || tokens.message || tokens.error);
      throw new Error(detail ? `ThunderID rejected the sign-in: ${detail}` : "ThunderID rejected the sign-in.");
    }

    setSession({
      loggedInAt: new Date().toISOString(),
      accessToken: tokens.access_token,
      idToken: tokens.id_token || null,
      raw: tokens,
    });

    sessionStorage.removeItem(PKCE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }

  /**
   * Logs the user out: clears the local session and, if configured,
   * redirects through ThunderID's logout endpoint to end the IdP
   * session too.
   */
  function logout(redirectThroughIdp) {
    clearSession();

    if (redirectThroughIdp) {
      const params = new URLSearchParams({
        client_id: CFG.clientId,
        post_logout_redirect_uri: CFG.postLogoutRedirectUri,
      });
      window.location.href = `${CFG.baseUrl}${CFG.endpoints.logout}?${params.toString()}`;
    } else {
      window.location.href = CFG.postLogoutRedirectUri;
    }
  }

  window.ThunderIDAuth = {
    redirectToLogin,
    handleRedirectCallback,
    logout,
    isAuthenticated,
    getSession,
    clearSession,
  };
})();
