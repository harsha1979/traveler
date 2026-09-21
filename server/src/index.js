require("dotenv").config();
const express = require("express");
const cors = require("cors");

const flightsRouter = require("./routes/flights");
const meRouter = require("./routes/me");
const authRouter = require("./routes/auth");
const travelApiRouter = require("./routes/travelApi");

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Browser-facing API (uses the caller's ThunderID session)
app.use("/api/flights", flightsRouter);
app.use("/api/me", meRouter);
// Server-side proxy for the OAuth2 token exchange (ThunderID's token
// endpoint has no CORS support, so the browser can't call it directly)
app.use("/api/auth", authRouter);

// travel-api contract for the future booking-agent/MCP project (see
// server/README.md) — unprefixed paths (/travelers/..., /flights/search,
// /bookings), exactly as specified in that project's implementation brief.
app.use("/", travelApiRouter);

app.use((req, res) => res.status(404).json({ error: "not_found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`Wayfare flight booking API listening on port ${PORT}`);
});
