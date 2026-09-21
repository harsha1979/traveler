/**
 * Flight search & booking UI. Talks to the backend in server/ via
 * window.API_BASE_URL (see js/config.js).
 */
(function () {
  const API = window.API_BASE_URL;

  const els = {};

  function fmtDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtMoney(value) {
    return `$${Number(value).toFixed(2)}`;
  }

  async function searchFlights(params) {
    const query = new URLSearchParams();
    if (params.origin) query.set("origin", params.origin);
    if (params.destination) query.set("destination", params.destination);
    if (params.date) query.set("date", params.date);

    const res = await fetch(`${API}/api/flights/search?${query.toString()}`);
    if (!res.ok) throw new Error("Flight search failed");
    const data = await res.json();
    return data.flights;
  }

  const UNFILTERED_PREVIEW_LIMIT = 15;

  function renderFlights(flights, { wasFiltered }) {
    els.results.innerHTML = "";

    if (!flights.length) {
      els.results.innerHTML = `<p class="empty-state">No flights found for that search. Try different dates or airports.</p>`;
      return;
    }

    const authed = window.ThunderIDAuth.isAuthenticated();
    const toRender = wasFiltered ? flights : flights.slice(0, UNFILTERED_PREVIEW_LIMIT);

    if (!wasFiltered && flights.length > toRender.length) {
      const note = document.createElement("p");
      note.className = "empty-state";
      note.textContent = `Showing the next ${toRender.length} departures. Use the filters above to search a specific route or date.`;
      els.results.appendChild(note);
    }

    toRender.forEach((flight) => {
      const card = document.createElement("div");
      card.className = "flight-card";
      card.innerHTML = `
        <div class="flight-card-main">
          <div class="flight-route">
            <span class="airport">${flight.origin}</span>
            <span class="route-arrow">→</span>
            <span class="airport">${flight.destination}</span>
          </div>
          <div class="flight-meta">
            <span>${flight.airline} · ${flight.flight_number}</span>
            <span>${fmtDateTime(flight.departure_time)} — ${fmtDateTime(flight.arrival_time)}</span>
            <span>${flight.seats_available} seats left</span>
          </div>
        </div>
        <div class="flight-card-side">
          <div class="flight-price">${fmtMoney(flight.price)}</div>
          <button class="btn btn-primary btn-book" data-flight-id="${flight.id}">
            ${authed ? "Book" : "Sign in to book"}
          </button>
        </div>
      `;
      els.results.appendChild(card);
    });

    els.results.querySelectorAll(".btn-book").forEach((btn) => {
      btn.addEventListener("click", () => onBookClick(btn));
    });
  }

  async function onBookClick(btn) {
    if (!window.ThunderIDAuth.isAuthenticated()) {
      window.ThunderIDAuth.redirectToLogin("signin");
      return;
    }

    const flightId = Number(btn.dataset.flightId);
    btn.disabled = true;
    btn.textContent = "Booking…";

    try {
      const session = window.ThunderIDAuth.getSession();
      const res = await fetch(`${API}/api/me/bookings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ flightId }),
      });

      const data = await res.json();

      if (!res.ok) {
        showBookingMessage(data.message || data.error || "Booking failed.", true);
        btn.disabled = false;
        btn.textContent = "Book";
        return;
      }

      showBookingMessage(`Booked! Confirmation ${data.booking.booking_reference}.`, false);
      btn.textContent = "Booked";
      await refreshMyBookings();
      // Re-run the current search so seat counts reflect the new booking.
      els.searchForm.requestSubmit();
    } catch (err) {
      console.error(err);
      showBookingMessage("Couldn't reach the booking service.", true);
      btn.disabled = false;
      btn.textContent = "Book";
    }
  }

  function showBookingMessage(text, isError) {
    els.bookingMessage.textContent = text;
    els.bookingMessage.classList.remove("hidden");
    els.bookingMessage.classList.toggle("booking-message-error", isError);
    setTimeout(() => els.bookingMessage.classList.add("hidden"), 5000);
  }

  async function refreshMyBookings() {
    const authed = window.ThunderIDAuth.isAuthenticated();
    els.myBookingsSection.classList.toggle("hidden", !authed);
    if (!authed) return;

    const session = window.ThunderIDAuth.getSession();

    try {
      const [profileRes, bookingsRes] = await Promise.all([
        fetch(`${API}/api/me/profile`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
        fetch(`${API}/api/me/bookings`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
      ]);

      if (profileRes.ok) {
        const { profile } = await profileRes.json();
        if (profile) {
          document.getElementById("user-welcome").textContent = `Hi, ${profile.full_name || profile.email}`;
        }
      }

      if (!bookingsRes.ok) throw new Error("Could not load bookings");
      const { bookings } = await bookingsRes.json();
      renderMyBookings(bookings);
    } catch (err) {
      console.error("Failed to load account data:", err);
      els.myBookingsList.innerHTML = `<p class="empty-state">Couldn't load your bookings right now.</p>`;
    }
  }

  function renderMyBookings(bookings) {
    els.myBookingsList.innerHTML = "";

    if (!bookings.length) {
      els.myBookingsList.innerHTML = `<p class="empty-state">You haven't booked any flights yet.</p>`;
      return;
    }

    bookings.forEach((b) => {
      const row = document.createElement("div");
      row.className = "booking-row";
      row.innerHTML = `
        <div>
          <strong>${b.origin} → ${b.destination}</strong>
          <div class="flight-meta">
            <span>${b.airline} · ${b.flight_number}</span>
            <span>${fmtDateTime(b.departure_time)}</span>
          </div>
        </div>
        <div class="booking-row-side">
          <span class="booking-ref">${b.booking_reference}</span>
          <span>${fmtMoney(b.total_price)}</span>
        </div>
      `;
      els.myBookingsList.appendChild(row);
    });
  }

  function init() {
    els.searchForm = document.getElementById("flight-search-form");
    els.results = document.getElementById("flight-results");
    els.bookingMessage = document.getElementById("booking-message");
    els.myBookingsSection = document.getElementById("my-bookings-section");
    els.myBookingsList = document.getElementById("my-bookings-list");

    els.searchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(els.searchForm);
      const origin = formData.get("origin");
      const destination = formData.get("destination");
      const date = formData.get("date");
      const wasFiltered = Boolean(origin || destination || date);

      els.results.innerHTML = `<p class="empty-state">Searching…</p>`;
      try {
        const flights = await searchFlights({ origin, destination, date });
        renderFlights(flights, { wasFiltered });
      } catch (err) {
        console.error(err);
        els.results.innerHTML = `<p class="empty-state">Couldn't reach the flight search service. Is the backend running?</p>`;
      }
    });

    document.addEventListener("wayfare:authchanged", refreshMyBookings);

    // Initial load: show upcoming flights across all routes, and load
    // "My Bookings" if already signed in.
    els.searchForm.requestSubmit();
    refreshMyBookings();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
