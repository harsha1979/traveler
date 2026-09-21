const pool = require("./db");

/**
 * Core business logic, shared by the browser-facing /api/me/* routes and
 * the /internal/* routes meant for a future MCP server. Keeping this in
 * one place means both call surfaces behave identically.
 */

function generateBookingReference() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let ref = "WF";
  for (let i = 0; i < 6; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

/** search_flights(origin, destination, date) */
async function searchFlights({ origin, destination, date }) {
  const conditions = [];
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
  conditions.push("seats_available > 0");

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.execute(
    `SELECT id, flight_number, airline, origin, destination, departure_time, arrival_time, price, seats_available
     FROM flights
     ${where}
     ORDER BY departure_time ASC
     LIMIT 100`,
    params
  );

  return rows;
}

/** get_my_profile(traveler_id) */
async function getProfile(travelerId) {
  const [rows] = await pool.execute("SELECT id, email, full_name, created_at FROM travelers WHERE id = :id", {
    id: travelerId,
  });
  return rows[0] || null;
}

/** list_my_bookings(traveler_id) */
async function listBookings(travelerId) {
  const [rows] = await pool.execute(
    `SELECT b.id, b.booking_reference, b.seats_booked, b.total_price, b.status, b.booked_at,
            f.id AS flight_id, f.flight_number, f.airline, f.origin, f.destination, f.departure_time, f.arrival_time
     FROM bookings b
     JOIN flights f ON f.id = b.flight_id
     WHERE b.traveler_id = :travelerId
     ORDER BY f.departure_time ASC`,
    { travelerId }
  );
  return rows;
}

/** book_flight(traveler_id, flight_id) */
async function bookFlight(travelerId, flightId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

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

    const reference = generateBookingReference();

    const [result] = await conn.execute(
      `INSERT INTO bookings (booking_reference, traveler_id, flight_id, seats_booked, total_price, status)
       VALUES (:reference, :travelerId, :flightId, 1, :price, 'CONFIRMED')`,
      { reference, travelerId, flightId, price: flight.price }
    );

    await conn.execute("UPDATE flights SET seats_available = seats_available - 1 WHERE id = :flightId", { flightId });

    await conn.commit();

    return {
      booking: {
        id: result.insertId,
        booking_reference: reference,
        traveler_id: travelerId,
        flight_id: flightId,
        seats_booked: 1,
        total_price: flight.price,
        status: "CONFIRMED",
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { searchFlights, getProfile, listBookings, bookFlight };
