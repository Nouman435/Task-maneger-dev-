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

### Public static hosting

The Netlify build publishes the frontend in browser-only mode (`VITE_LOCAL_ONLY=true`). This is suitable for Netlify's static free hosting and requires no server secrets: each visitor's tasks are stored only in that visitor's browser using LocalStorage. Accounts and cross-device/cloud sync require deploying the Express API and PostgreSQL database separately; the static Netlify build does not provide those services.

## Tests

Run API validation tests with:

```powershell
npm test
```
