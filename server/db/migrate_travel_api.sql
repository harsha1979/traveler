-- One-time migration for a database that already has the travelers /
-- flights / bookings tables from BEFORE the travel-api contract columns
-- were added (i.e. you ran the old schema.sql at some point). Run this
-- once, instead of re-running schema.sql (which won't touch existing
-- tables — CREATE TABLE IF NOT EXISTS is a no-op if they already exist):
--
--   mysql -h <host> -u <user> -p <database> < migrate_travel_api.sql
--
-- Safe to run only once. Running it twice will error on the duplicate
-- column/key names (harmless — just means it already applied).

ALTER TABLE travelers
  ADD COLUMN home_airport CHAR(3) NULL,
  ADD COLUMN tier VARCHAR(20) NOT NULL DEFAULT 'Standard',
  ADD COLUMN policy_max_fare_usd DECIMAL(10,2) NOT NULL DEFAULT 1500.00;

ALTER TABLE flights
  ADD COLUMN fare_class VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
  ADD COLUMN fare_rules_text TEXT NULL;

ALTER TABLE bookings
  ADD COLUMN idempotency_key VARCHAR(191) NULL,
  ADD UNIQUE KEY uq_bookings_idempotency_key (idempotency_key);
