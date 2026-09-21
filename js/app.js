/**
 * Landing page wiring: Sign Up / Sign In / Logout button behavior.
 * Dispatches a `wayfare:authchanged` event on document whenever the
 * signed-in state might have changed, so js/flights.js can refresh
 * "My Bookings" and re-enable/disable the Book buttons.
 */
(function () {
  function updateAuthUI() {
    const signUpBtn = document.getElementById("btn-signup");
    const signInBtn = document.getElementById("btn-signin");
    const logoutBtn = document.getElementById("btn-logout");
    const welcomeEl = document.getElementById("user-welcome");

    const authed = window.ThunderIDAuth.isAuthenticated();

    signUpBtn.classList.toggle("hidden", authed);
    signInBtn.classList.toggle("hidden", authed);
    logoutBtn.classList.toggle("hidden", !authed);
    welcomeEl.classList.toggle("hidden", !authed);

    if (authed) {
      welcomeEl.textContent = "You're signed in";
    }

    document.dispatchEvent(new CustomEvent("wayfare:authchanged", { detail: { authed } }));
  }

  function init() {
    updateAuthUI();

    document.getElementById("btn-signup").addEventListener("click", function () {
      window.ThunderIDAuth.redirectToLogin("signup");
    });

    document.getElementById("btn-signin").addEventListener("click", function () {
      window.ThunderIDAuth.redirectToLogin("signin");
    });

    document.getElementById("btn-logout").addEventListener("click", function () {
      // logout() navigates away (to postLogoutRedirectUri), which reloads
      // this page and re-runs updateAuthUI() in the signed-out state.
      window.ThunderIDAuth.logout(false);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
