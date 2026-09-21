# Wayfare Flights

A minimal flight search & booking engine: static frontend, Node.js/Express
API, MySQL storage (local for dev, AWS RDS for real use), ThunderID as the
identity provider. Booking is the only feature — search flights, sign in
with ThunderID, book a seat, see your bookings. A chat launcher is present
in the corner but not wired to any logic yet.

## Architecture

```
Browser (index.html, js/*.js)
  │  ThunderID OAuth2 Authorization Code + PKCE (sign in/up/out)
  │  fetch() calls
  ▼
Node.js API (server/) ── verifies bearer tokens via ThunderID /oauth2/userinfo
  │
  ▼
MySQL (travelers, flights, bookings)
```

Two call surfaces on the same backend:
- **Browser-facing** (`/api/me/*`, `/api/flights/*`): the frontend calls
  these with the signed-in user's ThunderID access token. Wrapped JSON
  responses (`{ profile: {...} }`, `{ flights: [...] }`).
- **travel-api contract** (`/travelers/{id}`, `/travelers/{id}/bookings`,
  `/flights/search`, `/bookings`): this is the exact REST contract from
  a separate booking-agent/MCP implementation brief — this server plays
  the role that brief calls `travel-api`, so a future `traveler-mcp` and
  `flights-mcp` can call it directly. Bare (unwrapped) JSON responses,
  matching that contract precisely. See **travel-api contract** below.

## travel-api contract (for the booking-agent/MCP project)

| Endpoint | Maps to | Auth |
|---|---|---|
| `GET /travelers/{traveler_id}` | `get_my_profile(traveler_id)` | `Authorization: Bearer <TRAVEL_API_KEY>` |
| `GET /travelers/{traveler_id}/bookings` | `list_my_bookings(traveler_id)` | same |
| `GET /flights/search?origin=&destination=&date=` | `search_flights(...)` | same |
| `POST /bookings` `{traveler_id, flight_id, idempotency_key}` | `book_flight(...)` | same |

**`traveler_id` is `travelers.external_sub` (the ThunderID `sub` claim),
not this database's internal numeric id.** Per that brief's own design, an
MCP tool never lets the model supply a traveler_id — it derives one from
the validated (possibly delegated) token's subject and passes that
straight through. That subject is the IdP's `sub`, so that's what this
contract's `traveler_id` has to mean too; a numeric row id would be
meaningless to a caller that never sees it. A traveler only exists here
once they've signed in at least once through the browser flow (that's
what creates the `travelers` row in the first place).

**Auth boundary, deliberately shallow here.** `TRAVEL_API_KEY` is one
shared service credential for "this call comes from the trusted MCP
layer" — it has no per-request subject to check `traveler_id` against.
Verifying that the *end user* actually is the traveler being accessed
(including delegated `act`/`sub` tokens) is the MCP servers' job in that
architecture, done before they ever call this API. See the comment at
the top of `server/src/middleware/travelApiAuth.js` for the full
reasoning and how to harden this later if needed.

**Status codes**: `404` for an unknown traveler or flight, `422` for a
sold-out flight, `400` for a missing required field, `201` for a newly
created booking, and `409` — reserved specifically for the idempotency
case — when `idempotency_key` was already used, returning the *original*
booking's `{ booking_id, status, price_usd }` rather than creating a
duplicate (verified: two calls with the same key produce one row).

`get_my_profile`'s `home_airport` / `tier` / `policy_max_fare_usd` have no
real source yet — ThunderID doesn't carry loyalty data — so new travelers
get placeholder defaults (`NULL`, `'Standard'`, `1500.00`). Set real
values with a manual `UPDATE travelers SET ... WHERE external_sub = '...'`
until there's a proper source for them.

## Directory layout

```
index.html, callback.html    Frontend pages
css/styles.css                 Styling
js/config.js                   ThunderID + API base URL config
js/auth.js                     OAuth2 Authorization Code + PKCE flow
js/app.js                      Sign Up / Sign In / Logout button wiring
js/flights.js                  Flight search, booking, "My Bookings" UI
js/chat.js                     Chat widget UI only (logic is a TODO)

server/
  src/index.js                 Express app
  src/db.js                    MySQL connection pool
  src/flightService.js         Core logic for the browser-facing routes
  src/travelApiService.js      Core logic for the travel-api contract routes
  src/middleware/auth.js       Verifies ThunderID access tokens (browser flow)
  src/middleware/travelApiAuth.js  Bearer/TRAVEL_API_KEY guard (travel-api contract)
  src/routes/flights.js        GET /api/flights/search
  src/routes/me.js             GET/POST /api/me/profile, /api/me/bookings
  src/routes/travelApi.js      /travelers/*, /flights/search, /bookings (travel-api contract)
  db/schema.sql                Table definitions (fresh database)
  db/migrate_travel_api.sql    One-time migration for a pre-existing database
  db/seed.js                   Generates flight availability for the
                                next SEED_DAYS days across 10 routes
  infra/iam-policy.json        Minimal IAM policy needed to run create-rds.sh
  infra/create-rds.sh          Provisions a small MySQL RDS instance
```

## Two things need doing once before this is fully live

### 1. Register this app in ThunderID (a few minutes)

The instance at `https://default-idp.amp.18.217.217.55.sslip.io` is real
and running (confirmed via its `.well-known/openid-configuration`), but
`js/config.js` still has a placeholder `clientId` — dynamic client
registration requires an admin session token that's only obtainable
through the console's hosted login, so this one step has to be done in
the UI rather than scripted:

1. Open `https://default-idp.amp.18.217.217.55.sslip.io/console` and
   sign in with the admin credentials.
2. Create a new application — type **Single Page Application** (public
   client).
3. Redirect URI: `http://localhost:5757/callback.html` (add your real
   deployed URL too, later).
4. Token endpoint auth method: **none** — this app already implements
   PKCE, so no client secret is needed or used.
5. Copy the generated **Client ID** into `js/config.js` →
   `THUNDER_ID_CONFIG.clientId`.

### 2. Provision the RDS MySQL instance

The AWS credentials available here (`harsha-agent-mcp-deploy`) can't read
or modify IAM, EC2, or RDS in this account — confirmed by direct calls
(`iam:GetUser`, `ec2:DescribeVpcs`, `rds:DescribeDBInstances` all denied).
To provision the database:

1. Have someone with IAM admin rights attach the policy in
   `server/infra/iam-policy.json` to `harsha-agent-mcp-deploy` (or run
   the next step themselves with their own credentials).
2. Run `server/infra/create-rds.sh` (needs AWS CLI v2, `jq`, `curl`,
   `openssl`). It creates a `db.t4g.micro`, single-AZ, 20GB MySQL 8
   instance, a security group scoped to just the machine that ran the
   script, and prints the generated master password once — save it.
3. Load the schema and seed data against the new instance:
   ```bash
   mysql -h <endpoint> -u wayfare_app -p wayfare < server/db/schema.sql
   cd server && npm install && npm run seed
   ```

## Running locally today (already verified working)

This was tested end-to-end against a local MySQL container (Docker) and
the real ThunderID instance's token-verification endpoint — search,
booking, seat-decrementing, and the get_my_profile / list_my_bookings /
search_flights / book_flight operations all work. Only the browser login
redirect needs step 1 above before a real user can sign in through the UI.

```bash
# 1. MySQL (swap for RDS later by changing server/.env)
docker run -d --name wayfare-mysql -p 3306:3306 \
  -e MYSQL_DATABASE=wayfare -e MYSQL_USER=wayfare_app \
  -e MYSQL_PASSWORD=devpass123 -e MYSQL_ROOT_PASSWORD=rootpass \
  mysql:8.0

mysql -h127.0.0.1 -uwayfare_app -pdevpass123 wayfare < server/db/schema.sql
# Already had these tables from before the travel-api contract columns
# were added? Run server/db/migrate_travel_api.sql once instead (plain
# MySQL has no ADD COLUMN IF NOT EXISTS, so schema.sql assumes a clean slate).

# 2. Backend
cd server
cp .env.example .env   # fill in DB_* to match the container above
npm install
npm run seed
npm start               # listens on :4000

# 3. Frontend (separate terminal, from the project root)
python3 -m http.server 5757
# open http://localhost:5757/index.html
```

## Security notes carried over from the demo

- The frontend uses PKCE for the OAuth2 flow, so no client secret needs
  to live in browser JS (`js/config.js` leaves `clientSecret` blank).
- The travel-api contract routes use a single static `TRAVEL_API_KEY` —
  fine for a demo, but replace with per-caller credentials before a real
  MCP server or any other backend depends on it (see the boundary note
  in `server/src/middleware/travelApiAuth.js`).
- `server/src/middleware/auth.js` calls ThunderID's `/oauth2/userinfo`
  per request to verify tokens. For lower latency at scale, verify the
  access token locally as a signed JWT against ThunderID's JWKS
  (`/oauth2/jwks`) instead.
