/**
 * Seeds the `flights` table with availability for the next SEED_DAYS days
 * across a small set of routes. Safe to re-run: it wipes and re-inserts
 * flights (bookings reference flights by id, so this is meant for fresh
 * environments only — don't run against a DB with real bookings).
 *
 * Usage:
 *   node db/seed.js
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

const SEED_DAYS = Number(process.env.SEED_DAYS || 90);

const ROUTES = [
  { origin: "JFK", destination: "LAX", airline: "Wayfare Air", durationHours: 6, basePrice: 320 },
  { origin: "LAX", destination: "JFK", airline: "Wayfare Air", durationHours: 5, basePrice: 310 },
  { origin: "JFK", destination: "LHR", airline: "Atlantic Wings", durationHours: 7, basePrice: 540 },
  { origin: "LHR", destination: "JFK", airline: "Atlantic Wings", durationHours: 8, basePrice: 560 },
  { origin: "SFO", destination: "SEA", airline: "Pacific Air", durationHours: 2, basePrice: 140 },
  { origin: "SEA", destination: "SFO", airline: "Pacific Air", durationHours: 2, basePrice: 135 },
  { origin: "ORD", destination: "MIA", airline: "Wayfare Air", durationHours: 3, basePrice: 210 },
  { origin: "MIA", destination: "ORD", airline: "Wayfare Air", durationHours: 3, basePrice: 205 },
  { origin: "ATL", destination: "DFW", airline: "Southern Skies", durationHours: 2.5, basePrice: 175 },
  { origin: "DFW", destination: "ATL", airline: "Southern Skies", durationHours: 2.5, basePrice: 180 },
];

// A handful of departure times per day; each route gets 1-2 of these.
const DAILY_SLOTS = [
  { hour: 6, minute: 15 },
  { hour: 11, minute: 30 },
  { hour: 16, minute: 45 },
  { hour: 20, minute: 10 },
];

function pad(n) {
  return String(n).padStart(2, "0");
}

function toMysqlDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function flightNumberFor(airline, index) {
  const prefix = airline
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return `${prefix}${100 + (index % 900)}`;
}

async function main() {
  const pool = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log(`Seeding flights for the next ${SEED_DAYS} days...`);

  await pool.query("DELETE FROM bookings");
  await pool.query("DELETE FROM flights");
  await pool.query("ALTER TABLE flights AUTO_INCREMENT = 1");
  await pool.query("ALTER TABLE bookings AUTO_INCREMENT = 1");

  const rows = [];
  let seq = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let dayOffset = 1; dayOffset <= SEED_DAYS; dayOffset++) {
    const day = new Date(today);
    day.setDate(day.getDate() + dayOffset);

    for (const route of ROUTES) {
      // Each route flies 2 of the 4 daily slots, alternating by day so the
      // schedule isn't identical every single day.
      const slotsToday = dayOffset % 2 === 0 ? [DAILY_SLOTS[0], DAILY_SLOTS[2]] : [DAILY_SLOTS[1], DAILY_SLOTS[3]];

      for (const slot of slotsToday) {
        seq++;
        const departure = new Date(day);
        departure.setHours(slot.hour, slot.minute, 0, 0);

        const arrival = new Date(departure.getTime() + route.durationHours * 60 * 60 * 1000);

        // Small deterministic price/seat variation so results aren't all identical.
        const priceJitter = ((seq % 7) - 3) * 6; // -18..+18
        const price = Math.max(49, route.basePrice + priceJitter);
        const seatsTotal = 150;
        const seatsAvailable = seatsTotal - ((seq * 13) % 140); // leaves at least 10 seats

        rows.push([
          flightNumberFor(route.airline, seq),
          route.airline,
          route.origin,
          route.destination,
          toMysqlDateTime(departure),
          toMysqlDateTime(arrival),
          price.toFixed(2),
          seatsTotal,
          Math.max(seatsAvailable, 5),
        ]);
      }
    }
  }

  const insertSql =
    "INSERT INTO flights (flight_number, airline, origin, destination, departure_time, arrival_time, price, seats_total, seats_available) VALUES ?";

  // Batch insert in chunks to keep the query size reasonable.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await pool.query(insertSql, [rows.slice(i, i + CHUNK)]);
  }

  console.log(`Inserted ${rows.length} flights across ${ROUTES.length} routes.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
