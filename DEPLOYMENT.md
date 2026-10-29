# Deployment notes

The app is split into a Vite client and an Express API. The client is a separate Git repository stored at `client` as a submodule. Deploy that client repository as the static site, or configure your host to fetch submodules recursively. Deploy the API from this repository with `server` as its service root. The services can also sit behind one reverse proxy. Build the client with `VITE_API_URL` set to the public API base URL, including `/api` (for example, `https://api.example.com/api`). For a same-origin reverse proxy, set it to `/api`.

## API service

Use `server` as the service root, Node.js `22.12` or newer, `npm ci` as the install command, and `npm start` as the start command. Set `NODE_ENV=production`. Configure these variables in the hosting dashboard; do not upload `.env.local` or commit credentials:

- `MONGO_URI`: Atlas connection string for a database user limited to read/write access on the `gyanaegis` database. Do not use an Atlas Admin user for the deployed app.
- `JWT_SECRET`: a random secret of at least 32 bytes. Use a separate value in the host's secret settings.
- `CLIENT_ORIGIN`: exact public client origin, such as `https://your-site.example` (no path). Multiple origins may be comma-separated.
- `PORT`: set by most hosts automatically; otherwise use `5002`.
- `TRUST_PROXY`: defaults to one proxy hop in production; change it if your host uses a different proxy chain.
- `RESEND_API_KEY` and `PASSWORD_RESET_FROM` (optional): set both to enable email verification and password reset. The sender address must be verified in Resend, for example `Gyanaegis <noreply@your-domain.example>`. Leave both unset to use recovery codes without email.

The API exposes `/health`; it returns HTTP 200 only when MongoDB is connected. Allow the API host's outbound IP/network in Atlas. Avoid opening Atlas to all IP addresses.

## Client service

Use `client` as the service root, Node.js `22.12` or newer. Run `npm ci && npm run build` and publish the generated `dist` directory. Set `VITE_API_URL` to the deployed API URL before building. The Vite development server proxies `/api` and `/health` to `http://127.0.0.1:5002`; that proxy is for local development only.

## Local development

Start the API with `cd server && npm start`, then start the client with `cd client && npm run dev`. Keep Atlas credentials and `JWT_SECRET` in the ignored `server/.env.local` file.

Before inviting users, use an Atlas database user limited to the app database, review the Atlas network access list, and set the public HTTPS origin and environment variables on the hosting services.

## Password recovery

Every new account receives a one-time recovery code during signup. The user should copy and save it somewhere private; they can replace it later from **Recovery Options** while signed in. Recovery codes are stored hashed, consumed on use, and require no email provider or custom domain. Existing users can sign in and generate one from **Recovery Options**. Before deploying changes, push the client repository first and update the parent repository's submodule revision so the host builds the same client code you verified locally.

Email recovery is optional. Users can add an address from **Recovery Options**; it must be verified before it can receive reset links. To enable email delivery, configure a Resend API key, a sender address on a verified sending domain, and the client HTTPS origin. Reset links expire after 60 minutes and can be used once; email verification links expire after 24 hours.
