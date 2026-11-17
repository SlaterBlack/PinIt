# PinIt

PinIt is an Angular application for visual collaboration and digital
whiteboards, inspired by Miro. Its cream and dusty-rose palette supports both
the standard and retro themes used across the related applications.

## Setup

Install the frontend dependencies:

```bash
cd frontend
npm install
```

Copy the example environment file and replace every placeholder with values
for the machine running PinIt:

```bash
cd frontend && cp -n .env.example .env
```

`frontend/.env` is ignored by Git. It contains the StoreIt API URL, frontend
bind address and port, Nginx hostname, and systemd service account and path.
The development and production servers load this file and proxy `/api`
requests and WebSocket upgrades to StoreIt.

Configure board storage in the **StoreIt backend's** local `.env`:

```dotenv
PINIT_BOARD_ROOT=/path/to/board-data
PINIT_ALLOWED_ORIGINS=https://pinit.example.com
```

Set `PINIT_BOARD_ROOT` to a directory writable by the StoreIt service account.
PinIt boards are stored there as JSON files. `PINIT_ALLOWED_ORIGINS` must
include the PinIt site's origin for live collaboration. The StoreIt backend
environment example uses generic placeholders; keep machine-specific values
in the ignored backend `.env`. After deploying the backend schema changes, run
`npm run db:migrate` from the StoreIt backend directory.

Start the development server:

```bash
npm start
```

## Build and checks

Run these commands from `frontend/`:

```bash
npm run build
npm test
npm run lint
```

The production Angular output is written to `frontend/dist/pinit/browser`.
`npm run serve` hosts that build and proxies `/api`; build first and configure
`frontend/.env` before using it.

## Production hosting

The production frontend server listens on `FRONTEND_HOST` and `FRONTEND_PORT`
from the local `.env`. Configure the machine's Nginx virtual host to proxy
public traffic to that address. Keep the Nginx site and TLS certificate
configuration on the server, not in this repository; use the local
`NGINX_SERVER_NAME` setting for the virtual host. The server process can run
under systemd using `APP_DIRECTORY`, `APP_USER`, and `APP_GROUP` from `.env`.

## Boards and access

Signed-in workspace users can see, create, and edit boards. Independent item
changes are merged through StoreIt and sent live to other connected users.
Concurrent changes to the same item are surfaced as conflicts; users can
reapply or discard their local change after the latest board is loaded. Only
the board owner or an admin can delete a board. This live synchronization
currently assumes one active StoreIt process;
multiple backend instances need shared write coordination and a cross-instance
update broadcaster.

StoreIt admins can create Demo users in the user-management page. Demo users
have view-only access in ClockIt, ManageIt, and SplatIt. In PinIt they start
with no board access; admins can grant view-only or edit access per board from
PinIt's user-management page. Board permissions are checked by StoreIt, not
only by the frontend. The sample board remains a public, read-only preview.
