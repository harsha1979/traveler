/**
 * ThunderID (IdP) configuration
 * ---------------------------------------------------------------
 * Docs: https://thunderid.dev/docs/next/getting-started/get-thunderid/
 *
 * baseUrl below points at a real, running ThunderID instance. What's
 * still a placeholder is `clientId`: register this app as an OAuth2
 * application in the ThunderID console first —
 *   1. Open <baseUrl>/console and sign in.
 *   2. Create an application (type: Single Page Application / public
 *      client), redirect URI: <this site's origin>/callback.html
 *      (e.g. http://localhost:5757/callback.html).
 *   3. Set token endpoint auth method to "none" (public client) — this
 *      app already does PKCE, so no client secret is needed.
 *   4. Copy the generated Client ID into `clientId` below.
 */
window.THUNDER_ID_CONFIG = {
  // Base URL of the ThunderID instance
  baseUrl: "https://default-idp.amp.18.217.217.55.sslip.io",

  // OAuth2 client id registered in the ThunderID console (see steps above)
  clientId: "6QSudNFKoL3cdxkH1uG3yA",

  // Only needed if the app is registered as a *confidential* client.
  // Leave blank for a public client (recommended for a browser app) -
  // PKCE alone secures the flow. See auth.js: the secret is only sent
  // if this is non-empty.
  clientSecret: "M8jUKAYB7iDGDmoTQcYj47560bll_9wf7WbXzrJsXZc",

  // Where ThunderID should send the user back to after login
  redirectUri:
    window.location.origin +
    window.location.pathname.replace(/index\.html$/, "") +
    "callback.html",

  // Where to send the user after a successful logout
  postLogoutRedirectUri:
    window.location.origin +
    window.location.pathname.replace(/index\.html$/, ""),

  // Standard OIDC scopes
  scope: "openid profile email",

  // Confirmed against <baseUrl>/.well-known/openid-configuration
  endpoints: {
    authorize: "/oauth2/authorize",
    token: "/oauth2/token",
    logout: "/oauth2/logout",
    userinfo: "/oauth2/userinfo",
  },
};

// Base URL of the backend flight-booking API (server/ directory).
//
// Local dev serves the frontend (python3 -m http.server, port 5757) and
// the backend (npm start, port 4000) separately, so the frontend needs
// an explicit cross-origin URL. Any other deployment (EC2, a real
// domain, ...) is expected to run behind a reverse proxy (nginx) that
// proxies API paths on the SAME origin the page was loaded from, so an
// empty string there resolves fetch("" + "/api/...") to a same-origin
// relative path — no per-environment edits needed.
window.API_BASE_URL =
  window.location.hostname === "localhost" && window.location.port === "5757" ? "http://localhost:4000" : "";
