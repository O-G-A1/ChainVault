Deployment instructions

This repository contains an Express app that was adapted to run either as:

- Vercel Serverless Functions (api/index.js) — intended for serverless hosting
- A persistent Node process (server.js) — suitable for Fly.io, Render, Railway, etc.

Important: persistent data storage

- The app previously used a local data.json file for all storage. Serverless platforms (Vercel) run in ephemeral environments; local file writes will not persist across invocations.
- The app uses `lib/mongoStorage.js`. Configure `MONGODB_URI` in hosted environments; otherwise it falls back to the local `data.json` file for local development.

1. Prepare MongoDB (required for Vercel)

- Create a MongoDB Atlas cluster and database user.
- Set `MONGODB_URI` in Vercel, along with optional `MONGODB_DB` and `MONGODB_COLL` values.

- The app stores its state in one document with `_id: "main"`.

2. Deploy to Vercel (serverless)

- Ensure [api/index.js] exists (exports a serverless handler using serverless-http). The Express app was left in server.js and exported for serverless use.
- Add environment variables in the Vercel Dashboard: `MONGODB_URI`, `MONGODB_DB`, `MONGODB_COLL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_TO` as needed.
- Connect the repo in Vercel and deploy. API endpoints will be available under /api/\* (for example: /api/auth/signup).
- Local testing: install Vercel CLI (npm i -g vercel) and run `vercel dev` from the project root.

Caveats for Vercel:

- Cold starts and timeouts: serverless functions have execution time limits and potential cold-start latency.
- No long-running background processes or WebSocket servers — use Fly.io/Render for those needs.

3. Deploy to Fly.io (persistent Node process)

- Fly.io runs persistent Node processes and supports writable disk for typical apps.
- Example Dockerfile is provided (Dockerfile) — it builds the app and runs `node server.js`.
- Quick steps:
  - Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
  - Run `fly launch` in the repo root, follow prompts, and when asked for a Dockerfile say yes or allow flyctl to create fly.toml.
  - Set environment variables: `fly secrets set RESEND_API_KEY=... EMAIL_FROM=... EMAIL_TO=...` etc.
  - `fly deploy` to deploy.

4. What was changed in the repo

- api/index.js — serverless wrapper that exports the Express app via serverless-http (for Vercel).
- server.js — modified so it exports the Express app and only listens when run directly. Many routes were updated to use the async storage API.
- package.json — serverless-http added as a dependency.
- lib/storage.js — new storage adapter. If SUPABASE_URL and SUPABASE_KEY are present, it reads/writes a single JSON document in a Supabase Postgres table via the REST API; otherwise it uses local data.json (existing behaviour).
- DEPLOYMENT.md — this file.

5. Notes & next steps

- Keep `MONGODB_URI` private, store it as a Vercel secret, and never commit it.
- Consider migrating the data shape to normalized Postgres tables for scalability (users, sessions, transactions, requests) instead of a single JSON blob.
- If you want, I can migrate the storage to normalized Postgres tables and update the code to use those tables instead of a single JSON document.

If you want me to continue and:

- Create the Dockerfile and a starter fly.toml (I can), or
- Run local tests (npm install, run dev) to validate the app, or
- Normalize the Supabase schema and refactor code to use individual tables (more work)

Tell me which of the above to do next.
