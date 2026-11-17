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

Set `STOREIT_API_URL` in `frontend/.env` to the shared account API base URL for
your environment. `frontend/.env.example` contains a placeholder to replace.
The development and production servers proxy `/api` requests to this service.

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
