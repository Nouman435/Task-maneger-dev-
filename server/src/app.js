const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pool } = require("./db");
const { login, me, register, requireAuth } = require("./auth");
const { handleAssistant } = require("./ai");
const { taskCreateSchema, taskUpdateSchema } = require("./validation");

const app = express();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false });

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.post("/api/auth/register", authLimiter, register);
app.post("/api/auth/login", authLimiter, login);
app.get("/api/auth/me", requireAuth, me);

app.get("/api/tasks/stats", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status != 'completed' AND due_date < CURRENT_DATE)::int AS overdue
       FROM tasks WHERE user_id = $1`,
      [req.user.id]
    );
    return res.json({ stats: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const querySchema = z.object({
      status: z.enum(["pending", "in_progress", "completed"]).optional(),
      priority: z.enum(["low", "medium", "high"]).optional(),
      category: z.string().trim().max(60).optional(),
      q: z.string().trim().max(100).optional()
    }).strict();
    const filters = querySchema.parse(req.query);
    const params = [req.user.id];
    const where = ["user_id = $1"];

    for (const [field, column] of [["status", "status"], ["priority", "priority"], ["category", "category"]]) {
      if (filters[field]) {
        params.push(filters[field]);
        where.push(`${column} = $${params.length}`);
      }
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    const result = await pool.query(
      `SELECT id, parent_task_id AS "parentTaskId", title, description, status, priority,
        category, due_date::text AS "dueDate", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tasks WHERE ${where.join(" AND ")}
       ORDER BY (status = 'completed') ASC, due_date ASC NULLS LAST, updated_at DESC`,
      params
    );
    return res.json({ tasks: result.rows });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const input = taskCreateSchema.parse(req.body);
    const taskId = randomUUID();
    const parentTaskId = input.parentTaskId || null;
    if (parentTaskId) {
      const parent = await pool.query("SELECT id FROM tasks WHERE id = $1 AND user_id = $2", [parentTaskId, req.user.id]);
      if (!parent.rowCount) return res.status(400).json({ error: "Parent task not found." });
    }
    const result = await pool.query(
      `INSERT INTO tasks (id, user_id, parent_task_id, title, description, status, priority, category, due_date, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::date,
         CASE WHEN $6 = 'completed' THEN NOW() ELSE NULL END)
       RETURNING id, parent_task_id AS "parentTaskId", title, description, status, priority,
         category, due_date::text AS "dueDate", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [taskId, req.user.id, parentTaskId, input.title, input.description, input.status, input.priority, input.category, input.dueDate || ""]
    );
    return res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const input = taskUpdateSchema.parse(req.body);
    const fields = {
      title: "title",
      description: "description",
      status: "status",
      priority: "priority",
      category: "category",
      dueDate: "due_date"
    };
    const params = [];
    const assignments = Object.entries(input).map(([key, value]) => {
      params.push(key === "dueDate" && value === "" ? null : value);
      return `${fields[key]} = $${params.length}${key === "dueDate" ? "::date" : ""}`;
    });
    if (input.status) {
      params.push(input.status);
      assignments.push(`completed_at = CASE WHEN $${params.length} = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END`);
    }
    assignments.push("updated_at = NOW()");
    params.push(id, req.user.id);
    const result = await pool.query(
      `UPDATE tasks SET ${assignments.join(", ")}
       WHERE id = $${params.length - 1} AND user_id = $${params.length}
       RETURNING id, parent_task_id AS "parentTaskId", title, description, status, priority,
         category, due_date::text AS "dueDate", created_at AS "createdAt", updated_at AS "updatedAt"`,
      params
    );
    if (!result.rowCount) return res.status(404).json({ error: "Task not found." });
    return res.json({ task: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Task not found." });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.post("/api/ai/assistant", requireAuth, aiLimiter, async (req, res, next) => {
  try {
    const [completed, open] = await Promise.all([
      pool.query("SELECT title, category, completed_at FROM tasks WHERE user_id = $1 AND status = 'completed' ORDER BY updated_at DESC LIMIT 50", [req.user.id]),
      pool.query("SELECT title, description, status, priority, category, due_date::text AS \"dueDate\" FROM tasks WHERE user_id = $1 AND status != 'completed' ORDER BY due_date ASC NULLS LAST LIMIT 50", [req.user.id])
    ]);
    req.completedTasks = completed.rows;
    req.openTasks = open.rows;
    return await handleAssistant(req, res, next);
  } catch (error) {
    return next(error);
  }
});

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist, { index: false }));
app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(clientDist, "index.html"), error => {
    if (error) next(error);
  });
});

app.use((req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: error.issues.map(issue => issue.message).join(" ") });
  }
  if (error.status && error.status >= 400 && error.status < 600) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error("Unhandled API error:", error);
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

module.exports = app;
