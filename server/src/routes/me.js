const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getProfile, listBookings, bookFlight } = require("../flightService");

const router = express.Router();

// All routes here require a valid ThunderID bearer access token.
router.use(requireAuth);

// GET /api/me/profile -> get_my_profile(traveler_id)
router.get("/profile", async (req, res) => {
  const profile = await getProfile(req.traveler.id);
  res.json({ profile });
});

// GET /api/me/bookings -> list_my_bookings(traveler_id)
router.get("/bookings", async (req, res) => {
  const bookings = await listBookings(req.traveler.id);
  res.json({ bookings });
});

// POST /api/me/bookings { flightId } -> book_flight(traveler_id, flight_id)
router.post("/bookings", async (req, res) => {
  const flightId = Number(req.body.flightId);
  if (!flightId) {
    return res.status(400).json({ error: "invalid_flight_id" });
  }

  try {
    const result = await bookFlight(req.traveler.id, flightId);
    if (result.error === "flight_not_found") {
      return res.status(404).json({ error: "flight_not_found" });
    }
    if (result.error === "sold_out") {
      return res.status(409).json({ error: "sold_out", message: "No seats left on this flight." });
    }
    res.status(201).json(result);
  } catch (err) {
    console.error("Booking failed:", err);
    res.status(500).json({ error: "booking_failed" });
  }
});

module.exports = router;
