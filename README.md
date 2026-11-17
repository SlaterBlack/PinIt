# PinIT

PinIT is an Angular app scaffold for visual collaboration and digital
whiteboards, inspired by Miro. Its cream and dusty-rose palette supports both
the standard and retro themes used across the related applications.

## Setup

Install the frontend dependencies:

```bash
cd frontend
npm install
```

Copy the example environment file and configure the shared StoreIt API URL:

```bash
cp .env.example .env
```

The default `STOREIT_API_URL` (`http://127.0.0.1:4002`) matches the other
services. Change it in `frontend/.env` if StoreIt uses a different address.
The development and production servers load this file and proxy `/api`
requests to StoreIt. `FRONTEND_HOST` and `FRONTEND_PORT` configure the
production frontend server; the default production port is `2403`.

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
`STOREIT_API_URL` before using it.

## Scaffold status

The app has shared-account login, protected board routes, account theme sync,
a boards landing page, and a sample whiteboard layout. Board persistence,
editing tools, and real-time collaboration are not implemented yet.
