const express = require("express");
const { searchFlights } = require("../flightService");

const router = express.Router();

// GET /api/flights/search?origin=JFK&destination=LAX&date=2026-10-01
// Public — browsing flights doesn't require sign-in; booking does.
router.get("/search", async (req, res) => {
  try {
    const { origin, destination, date } = req.query;
    const flights = await searchFlights({ origin, destination, date });
    res.json({ flights });
  } catch (err) {
    console.error("Flight search failed:", err);
    res.status(500).json({ error: "search_failed" });
  }
});

module.exports = router;
