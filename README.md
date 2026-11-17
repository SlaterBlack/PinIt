# PinIt

PinIt is an Angular app scaffold for visual collaboration and digital
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
requests to StoreIt.

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

## Scaffold status

The app has shared-account login, protected board routes, account theme sync,
a boards landing page, and a sample whiteboard layout. Board persistence,
editing tools, and real-time collaboration are not implemented yet.
