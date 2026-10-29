# Deploy Gyanaegis

The repository includes a Dockerfile and a Render Blueprint for a single web service. The service builds the client, serves it from Express, exposes the API under `/api`, and reports database health at `/health`. It uses MongoDB Atlas for persistent data. The free Render plan may sleep while idle; choose a paid plan in Render if you need an always-on service.

## Before deployment

1. Push this repository's `codex/deploy-ready` branch to the GitHub repository connected to Render. The frontend is included in this repository; it is no longer fetched as a Git submodule.
2. In Render, create a Blueprint from that repository and select this branch. Review the service and plan before confirming creation.
3. Provide `MONGO_URI` when prompted. Use a dedicated MongoDB Atlas database user with read/write access only to the `gyanaegis` database. Do not use an Atlas administrator account or the testing user. Allow the deployment host to reach Atlas using an appropriately restricted network access rule.
4. Render generates `JWT_SECRET` and supplies `CLIENT_ORIGIN` from the deployed service URL. Keep these values managed by Render.
5. Wait for `/health` to report healthy. The app and API will use the same HTTPS address.

## Password recovery email (optional)

Account recovery codes work without email. To enable email verification and password reset, verify a sending domain with Resend, then add `RESEND_API_KEY` and `PASSWORD_RESET_FROM` in the Render service settings. Use a sender address on that verified domain, such as `Gyanaegis <noreply@your-domain.example>`. If either setting is provided, both are required. Redeploy after changing environment settings.

## Local build

Use Node.js 22.12 or newer. Build the client with `cd client && npm ci && npm run build`; start the API with `cd server && npm ci && npm start`. For local development, Vite proxies API and health requests to port 5002. Keep local settings in the ignored `server/.env.local` file.

## Deploying another way

Build from the repository root with `docker build -t gyanaegis .` and run the container with `MONGO_URI`, a random `JWT_SECRET` of at least 32 bytes, and `NODE_ENV=production`. Expose the platform-assigned `PORT`. Set `CLIENT_ORIGIN` to the public HTTPS origin if the platform does not provide `RENDER_EXTERNAL_URL`.
