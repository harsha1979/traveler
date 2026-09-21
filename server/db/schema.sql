-- Wayfare Flight Booking — minimal MySQL schema
-- Run once against a FRESH target database (local MySQL or AWS RDS):
--   mysql -h <host> -u <user> -p <database> < schema.sql
--
-- If a database already has these tables from before this revision (no
-- home_airport/tier/policy_max_fare_usd/fare_class/fare_rules_text/
-- idempotency_key columns), don't re-run this file — run
-- migrate_travel_api.sql instead (see that file's header). Plain MySQL
-- has no ADD COLUMN IF NOT EXISTS, so this file assumes a clean slate.

CREATE TABLE IF NOT EXISTS travelers (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  external_sub          VARCHAR(191) NOT NULL,      -- ThunderID `sub` claim (stable user id from IdP)
  email                 VARCHAR(255) NOT NULL,
  full_name             VARCHAR(255) NULL,
  -- Used by the travel-api contract's get_my_profile(). ThunderID has no
  -- concept of these, so they default to placeholders until real
  -- business/loyalty data is wired up (e.g. a manual UPDATE per traveler).
  home_airport          CHAR(3) NULL,
  tier                  VARCHAR(20) NOT NULL DEFAULT 'Standard',
  policy_max_fare_usd   DECIMAL(10,2) NOT NULL DEFAULT 1500.00,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_travelers_external_sub (external_sub),
  UNIQUE KEY uq_travelers_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flights (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  flight_number     VARCHAR(10) NOT NULL,
  airline           VARCHAR(100) NOT NULL,
  origin            CHAR(3) NOT NULL,           -- IATA airport code, e.g. JFK
  destination       CHAR(3) NOT NULL,           -- IATA airport code, e.g. LAX
  departure_time    DATETIME NOT NULL,
  arrival_time      DATETIME NOT NULL,
  price             DECIMAL(10,2) NOT NULL,
  seats_total       INT NOT NULL DEFAULT 150,
  seats_available   INT NOT NULL,
  -- Used by the travel-api contract's search_flights(). fare_rules_text is
  -- also where a future prompt-injection test payload could be planted per
  -- the agent brief — none is planted here, the column just needs to exist.
  fare_class        VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
  fare_rules_text   TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_route_date (origin, destination, departure_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bookings (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  booking_reference   VARCHAR(12) NOT NULL,
  traveler_id         INT NOT NULL,
  flight_id           INT NOT NULL,
  seats_booked        INT NOT NULL DEFAULT 1,
  total_price         DECIMAL(10,2) NOT NULL,
  status              ENUM('CONFIRMED','CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
  booked_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Used by the travel-api contract's POST /bookings. NULL for bookings
  -- made through the browser flow (/api/me/bookings), which doesn't send
  -- an idempotency key — a unique index allows unlimited NULLs while still
  -- enforcing uniqueness among the non-null values travel-api callers send.
  idempotency_key     VARCHAR(191) NULL,
  UNIQUE KEY uq_bookings_reference (booking_reference),
  UNIQUE KEY uq_bookings_idempotency_key (idempotency_key),
  KEY idx_bookings_traveler (traveler_id),
  KEY idx_bookings_flight (flight_id),
  CONSTRAINT fk_bookings_traveler FOREIGN KEY (traveler_id) REFERENCES travelers(id),
  CONSTRAINT fk_bookings_flight FOREIGN KEY (flight_id) REFERENCES flights(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
