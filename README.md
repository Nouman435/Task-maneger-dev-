# Daymark Task Manager

A responsive task manager with private user accounts, PostgreSQL persistence, task planning tools, and an AI assistant.

## Features

- Register and sign in with an email and password
- Create, edit, complete, and delete tasks
- Set priority, status, category, description, and due date
- Search and filter by status, category, and priority
- Dashboard counts for all, pending, in-progress, completed, and overdue tasks
- Task extraction, suggested subtasks, descriptions, priorities, daily plans, and summaries
- Built-in local assistant works without an API key; add an OpenAI key for full AI-generated assistance
- Responsive desktop and mobile layouts

## Stack

- React and Vite frontend
- Express API on Node.js
- PostgreSQL database
- JWT authentication and bcrypt password hashing
- OpenAI API called only from the server

## Local setup

Requirements: Node.js 20.19+.

1. Install dependencies and start the frontend and API:

   ```powershell
   npm install
   npm run dev
   ```

2. Open `http://localhost:5173` and create an account.

Without a `.env` file, development automatically uses a local SQLite database at `server/data/task-manager.sqlite`, a locally generated JWT signing secret, and the built-in local task assistant. The database and secret persist across restarts and are excluded from Git. This default requires no PostgreSQL installation or AI credentials.

The frontend hot-reloads during development. After changing backend files, restart the API with Ctrl+C and run `npm run dev --workspace server` again; the API is intentionally not auto-restarted so an in-flight request isn't interrupted.

To use PostgreSQL instead, create a database and set `DATABASE_URL` in `.env`. The API applies `server/schema.sql` on startup. Production requires PostgreSQL and an explicitly configured `JWT_SECRET`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | No (yes in production) | PostgreSQL connection string; omit locally to use SQLite |
| `JWT_SECRET` | No (yes in production) | Random secret of at least 32 characters; generated and persisted locally in development |
| `OPENAI_API_KEY` | No | Server-side OpenAI API key; without it, the built-in local assistant is used |
| `OPENAI_MODEL` | No | Model name (defaults to `gpt-4o-mini`) |
| `PORT` | No | API port (defaults to `3001`) |
| `CLIENT_ORIGIN` | No | Browser origin allowed by CORS (defaults to `http://localhost:5173`) |

Never put `OPENAI_API_KEY`, `JWT_SECRET`, or database credentials in frontend code or commit them to Git.

## Production

Build the frontend with `npm run build`, then start the API with `npm start`. The Express server serves the built frontend and API from the same origin. Configure the production environment variables and provide a PostgreSQL service before starting the server.

### Free full-stack deployment (Render + Neon)

The `render.yaml` Blueprint deploys the Express API and React app together on Render's free web-service plan. Use Neon for PostgreSQL so account and task data stays in a persistent database:

1. Create a free PostgreSQL project at [Neon](https://neon.tech/) and copy its connection string.
2. Push the `task-manager-dev` branch to GitHub.
3. In Render, create a new Blueprint from `Nouman435/Task-maneger-dev-` and select the `task-manager-dev` branch.
4. When prompted for `DATABASE_URL`, paste the Neon connection string. Render generates `JWT_SECRET` securely from the Blueprint.
5. Deploy the Blueprint. Open the Render URL, create an account, and sign in.

The free Render web service can spin down when idle, so the first request after inactivity may take about a minute. The Neon database is separate from Render's temporary filesystem, so accounts and tasks persist across app restarts and deployments. Keep `DATABASE_URL` and `JWT_SECRET` private and configure them only in Render's environment settings.

### Static hosting limitation

The Netlify configuration builds in browser-only mode (`VITE_LOCAL_ONLY=true`) and does not include the Express API. That static build intentionally skips registration and sign-in; use the full-stack Render deployment above for accounts, password authentication, and cross-device task storage.

## Tests

Run API validation tests with:

```powershell
npm test
```
