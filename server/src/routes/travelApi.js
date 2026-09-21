const express = require("express");
const { requireTravelApiToken } = require("../middleware/travelApiAuth");
const travelApiService = require("../travelApiService");

const router = express.Router();

// Every route here matches the travel-api contract from the
// booking-agent/MCP implementation brief exactly: same paths, same
// unwrapped response shapes (no { profile: ... } / { flights: ... }
// envelopes like the browser-facing /api/* routes use).
router.use(requireTravelApiToken);

// GET /travelers/:travelerId -> get_my_profile(traveler_id)
router.get("/travelers/:travelerId", async (req, res) => {
  try {
    const traveler = await travelApiService.getTraveler(req.params.travelerId);
    if (!traveler) return res.status(404).json({ error: "traveler_not_found" });
    res.json(traveler);
  } catch (err) {
    console.error("travel-api get traveler failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /travelers/:travelerId/bookings -> list_my_bookings(traveler_id)
router.get("/travelers/:travelerId/bookings", async (req, res) => {
  try {
    const bookings = await travelApiService.getTravelerBookings(req.params.travelerId);
    res.json(bookings);
  } catch (err) {
    console.error("travel-api list bookings failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /flights/search?origin=&destination=&date= -> search_flights(...)
router.get("/flights/search", async (req, res) => {
  try {
    const { origin, destination, date } = req.query;
    const flights = await travelApiService.searchFlights({ origin, destination, date });
    res.json(flights);
  } catch (err) {
    console.error("travel-api flight search failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /bookings { traveler_id, flight_id, idempotency_key } -> book_flight(...)
router.post("/bookings", async (req, res) => {
  const travelerId = req.body.traveler_id; // ThunderID `sub` — a string, not this DB's numeric id
  const flightId = Number(req.body.flight_id);
  const idempotencyKey = req.body.idempotency_key;

  if (!travelerId || !flightId || !idempotencyKey) {
    return res.status(400).json({
      error: "invalid_request",
      message: "traveler_id, flight_id, and idempotency_key are all required.",
    });
  }

  try {
    const result = await travelApiService.bookFlight({ travelerId, flightId, idempotencyKey });

    if (result.error === "traveler_not_found") {
      return res.status(404).json({ error: "traveler_not_found" });
    }
    if (result.error === "flight_not_found") {
      return res.status(404).json({ error: "flight_not_found" });
    }
    if (result.error === "sold_out") {
      // Not specified in the contract's happy/duplicate cases, so this is
      // deliberately NOT 409 - that status is reserved for the
      // idempotency-replay case below, so a caller can tell "this is your
      // original booking, safe to treat as success" apart from "this
      // genuinely failed" by status code alone, not just body shape.
      return res.status(422).json({ error: "sold_out", message: "No seats left on this flight." });
    }

    if (result.duplicate) {
      // idempotency_key already used - return the ORIGINAL booking, 409,
      // per the contract ("409 if idempotency_key already used (return
      // the original booking)").
      return res.status(409).json(result.booking);
    }

    res.status(201).json(result.booking);
  } catch (err) {
    console.error("travel-api booking failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
