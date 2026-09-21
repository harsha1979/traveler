const pool = require("./db");

/**
 * Backs the travel-api REST contract from the booking-agent/MCP
 * implementation brief:
 *   GET  /travelers/{traveler_id}
 *   GET  /travelers/{traveler_id}/bookings
 *   GET  /flights/search?origin=&destination=&date=
 *   POST /bookings { traveler_id, flight_id, idempotency_key }
 *
 * IMPORTANT: `traveler_id` here is `travelers.external_sub` (the
 * ThunderID `sub` claim), NOT this database's internal auto-increment
 * `travelers.id`. Per the brief's own architecture, an MCP tool never
 * accepts a traveler_id argument from the model — it derives one from
 * the validated (possibly delegated) token's subject and passes THAT
 * to travel-api. That subject is the IdP's `sub`, which is exactly what
 * `external_sub` stores. Using the internal numeric id here would be
 * meaningless to that caller, since it never sees it.
 */

function generateBookingReference() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let ref = "WF";
  for (let i = 0; i < 6; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

/** GET /travelers/{traveler_id} */
async function getTraveler(travelerId) {
  const [rows] = await pool.execute(
    `SELECT external_sub AS traveler_id, full_name AS name, email, home_airport, tier, policy_max_fare_usd
     FROM travelers
     WHERE external_sub = :travelerId`,
    { travelerId }
  );
  return rows[0] || null;
}

/** GET /travelers/{traveler_id}/bookings */
async function getTravelerBookings(travelerId) {
  const [rows] = await pool.execute(
    `SELECT b.booking_reference AS booking_id, f.id AS flight_id, f.origin, f.destination,
            f.departure_time AS depart_at, f.fare_class, b.total_price AS price_usd, b.status
     FROM bookings b
     JOIN travelers t ON t.id = b.traveler_id
     JOIN flights f ON f.id = b.flight_id
     WHERE t.external_sub = :travelerId
     ORDER BY f.departure_time ASC`,
    { travelerId }
  );
  return rows;
}

/** GET /flights/search?origin=&destination=&date= */
async function searchFlights({ origin, destination, date }) {
  const conditions = ["seats_available > 0"];
  const params = {};

  if (origin) {
    conditions.push("origin = :origin");
    params.origin = origin.toUpperCase();
  }
  if (destination) {
    conditions.push("destination = :destination");
    params.destination = destination.toUpperCase();
  }
  if (date) {
    conditions.push("DATE(departure_time) = :date");
    params.date = date;
  }

  const [rows] = await pool.execute(
    `SELECT id AS flight_id, airline AS carrier, origin, destination,
            departure_time AS depart_at, arrival_time AS arrive_at,
            fare_class, price AS price_usd, fare_rules_text
     FROM flights
     WHERE ${conditions.join(" AND ")}
     ORDER BY departure_time ASC
     LIMIT 100`,
    params
  );
  return rows;
}

/**
 * POST /bookings
 * Returns one of:
 *   { duplicate: true,  booking: {...} }   -> idempotency_key already used; caller returns 409 + this booking
 *   { duplicate: false, booking: {...} }   -> newly created; caller returns 201 + this booking
 *   { error: "traveler_not_found" | "flight_not_found" | "sold_out" }
 */
async function bookFlight({ travelerId, flightId, idempotencyKey }) {
  // Idempotent replay check up front, before touching seat inventory.
  const [existing] = await pool.execute(
    `SELECT booking_reference AS booking_id, status, total_price AS price_usd
     FROM bookings WHERE idempotency_key = :idempotencyKey`,
    { idempotencyKey }
  );
  if (existing.length > 0) {
    return { duplicate: true, booking: existing[0] };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [travelerRows] = await conn.execute("SELECT id FROM travelers WHERE external_sub = :travelerId FOR UPDATE", {
      travelerId,
    });
    if (travelerRows.length === 0) {
      await conn.rollback();
      return { error: "traveler_not_found" };
    }
    const internalTravelerId = travelerRows[0].id;

    const [flightRows] = await conn.execute(
      "SELECT id, price, seats_available FROM flights WHERE id = :flightId FOR UPDATE",
      { flightId }
    );
    if (flightRows.length === 0) {
      await conn.rollback();
      return { error: "flight_not_found" };
    }

    const flight = flightRows[0];
    if (flight.seats_available < 1) {
      await conn.rollback();
      return { error: "sold_out" };
    }

    const bookingId = generateBookingReference();

    await conn.execute(
      `INSERT INTO bookings (booking_reference, traveler_id, flight_id, seats_booked, total_price, status, idempotency_key)
       VALUES (:bookingId, :internalTravelerId, :flightId, 1, :price, 'CONFIRMED', :idempotencyKey)`,
      { bookingId, internalTravelerId, flightId, price: flight.price, idempotencyKey }
    );

    await conn.execute("UPDATE flights SET seats_available = seats_available - 1 WHERE id = :flightId", { flightId });

    await conn.commit();

    return {
      duplicate: false,
      booking: { booking_id: bookingId, status: "CONFIRMED", price_usd: flight.price },
    };
  } catch (err) {
    await conn.rollback();
    // Two concurrent requests with the same idempotency_key can both pass
    // the up-front check before either commits. The unique index catches
    // the race; treat the loser as a duplicate instead of a 500.
    if (err && err.code === "ER_DUP_ENTRY") {
      const [raceRows] = await pool.execute(
        `SELECT booking_reference AS booking_id, status, total_price AS price_usd
         FROM bookings WHERE idempotency_key = :idempotencyKey`,
        { idempotencyKey }
      );
      if (raceRows.length > 0) {
        return { duplicate: true, booking: raceRows[0] };
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { getTraveler, getTravelerBookings, searchFlights, bookFlight };
