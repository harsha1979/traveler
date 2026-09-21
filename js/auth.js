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

  function base64UrlEncode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest("SHA-256", data);
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
