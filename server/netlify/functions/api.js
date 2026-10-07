const { randomBytes, randomUUID, createHash } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { getStore } = require("@netlify/blobs");
const { z } = require("zod");
const { authSchema, taskCreateSchema, taskUpdateSchema } = require("../../src/validation");
const { assistantSchema, localAssistantResult } = require("../../src/ai");

const SESSION_LIFETIME = 12 * 60 * 60 * 1000;
const MAX_BODY_LENGTH = 32 * 1024;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: body === null ? "" : JSON.stringify(body)
  };
}

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function parseBody(event) {
  if (!event.body) return {};
  if (event.body.length > MAX_BODY_LENGTH) fail(413, "Request body is too large.");
  try {
    return JSON.parse(event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body);
  } catch {
    fail(400, "Request body must be valid JSON.");
  }
}

function getRoute(event) {
  let path = event.path || "/";
  const functionPrefix = "/.netlify/functions/api";
  if (path.startsWith(functionPrefix)) {
    path = `api/${path.slice(functionPrefix.length).replace(/^\/+/, "")}`;
  }
  return path.replace(/^\/+|\/+$/g, "");
}

async function updateTasks(store, userId, update) {
  const key = `user:${userId}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    const tasks = current.data || [];
    const result = update(tasks);
    if (result.noWrite) return result.value;
    const options = current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const write = await store.setJSON(key, result.tasks, options);
    if (write.modified) return result.value;
  }
  fail(409, "Tasks changed in another request. Please try again.");
}

function createHandler(store) {
  return async function handler(event) {
    try {
      const route = getRoute(event);
      const method = event.httpMethod || "GET";
      const body = parseBody(event);
      const query = event.queryStringParameters || {};

      if (route === "api/health" && method === "GET") return json(200, { status: "ok" });

      if (route === "api/auth/register" && method === "POST") {
        const input = authSchema.parse(body);
        const user = {
          id: randomUUID(),
          email: input.email,
          passwordHash: await bcrypt.hash(input.password, 12)
        };
        const emailKey = `email:${hash(input.email)}`;
        await store.setJSON(`account:${user.id}`, user, { onlyIfNew: true });
        const created = await store.setJSON(emailKey, user.id, { onlyIfNew: true });
        if (!created.modified) {
          await store.delete(`account:${user.id}`);
          return json(409, { error: "An account with this email already exists." });
        }
        const token = randomBytes(32).toString("base64url");
        await store.setJSON(`session:${hash(token)}`, {
          userId: user.id,
          expiresAt: Date.now() + SESSION_LIFETIME
        });
        return json(201, { token, user: { id: user.id, email: user.email } });
      }

      if (route === "api/auth/login" && method === "POST") {
        const input = authSchema.parse(body);
        const userId = await store.get(`email:${hash(input.email)}`, { type: "json", consistency: "strong" });
        const user = userId ? await store.get(`account:${userId}`, { type: "json", consistency: "strong" }) : null;
        if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
          return json(401, { error: "Email or password is incorrect." });
        }
        const token = randomBytes(32).toString("base64url");
        await store.setJSON(`session:${hash(token)}`, {
          userId: user.id,
          expiresAt: Date.now() + SESSION_LIFETIME
        });
        return json(200, { token, user: { id: user.id, email: user.email } });
      }

      const authorization = (event.headers?.authorization || event.headers?.Authorization || "").split(" ");
      const sessionToken = authorization[0] === "Bearer" ? authorization[1] : "";
      if (!sessionToken) return json(401, { error: "Please sign in to continue." });
      const sessionKey = `session:${hash(sessionToken)}`;
      const session = await store.get(sessionKey, { type: "json", consistency: "strong" });
      if (!session || session.expiresAt <= Date.now()) {
        if (session) await store.delete(sessionKey);
        return json(401, { error: "Your session has expired. Please sign in again." });
      }
      const user = await store.get(`account:${session.userId}`, { type: "json", consistency: "strong" });
      if (!user) return json(401, { error: "Your session is invalid. Please sign in again." });

      if (route === "api/auth/me" && method === "GET") {
        return json(200, { user: { id: user.id, email: user.email } });
      }

      if (route === "api/tasks/stats" && method === "GET") {
        const tasks = await store.get(`user:${user.id}`, { type: "json", consistency: "strong" }) || [];
        const today = new Date().toISOString().slice(0, 10);
        return json(200, {
          stats: {
            total: tasks.length,
            pending: tasks.filter(task => task.status === "pending").length,
            in_progress: tasks.filter(task => task.status === "in_progress").length,
            completed: tasks.filter(task => task.status === "completed").length,
            overdue: tasks.filter(task => task.status !== "completed" && task.dueDate && task.dueDate < today).length
          }
        });
      }

      if (route === "api/tasks" && method === "GET") {
        const filters = z.object({
          status: z.enum(["pending", "in_progress", "completed"]).optional(),
          priority: z.enum(["low", "medium", "high"]).optional(),
          category: z.string().trim().max(60).optional(),
          q: z.string().trim().max(100).optional()
        }).strict().parse(query);
        let tasks = await store.get(`user:${user.id}`, { type: "json", consistency: "strong" }) || [];
        if (filters.status) tasks = tasks.filter(task => task.status === filters.status);
        if (filters.priority) tasks = tasks.filter(task => task.priority === filters.priority);
        if (filters.category) tasks = tasks.filter(task => task.category === filters.category);
        if (filters.q) {
          const search = filters.q.toLowerCase();
          tasks = tasks.filter(task => `${task.title} ${task.description}`.toLowerCase().includes(search));
        }
        tasks.sort((left, right) =>
          Number(left.status === "completed") - Number(right.status === "completed") ||
          (left.dueDate || "9999").localeCompare(right.dueDate || "9999") ||
          right.updatedAt.localeCompare(left.updatedAt));
        return json(200, { tasks });
      }

      if (route === "api/tasks" && method === "POST") {
        const input = taskCreateSchema.parse(body);
        const task = {
          id: randomUUID(),
          parentTaskId: input.parentTaskId || null,
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          category: input.category,
          dueDate: input.dueDate || "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const created = await updateTasks(store, user.id, tasks => {
          if (task.parentTaskId && !tasks.some(candidate => candidate.id === task.parentTaskId)) {
            fail(400, "Parent task not found.");
          }
          return { tasks: [task, ...tasks], value: task };
        });
        return json(201, { task: created });
      }

      const taskRoute = route.match(/^api\/tasks\/([0-9a-f-]+)$/i);
      if (taskRoute && method === "PATCH") {
        const input = taskUpdateSchema.parse(body);
        const task = await updateTasks(store, user.id, tasks => {
          const index = tasks.findIndex(candidate => candidate.id === taskRoute[1]);
          if (index < 0) fail(404, "Task not found.");
          tasks[index] = { ...tasks[index], ...input, dueDate: input.dueDate ?? tasks[index].dueDate, updatedAt: new Date().toISOString() };
          return { tasks, value: tasks[index] };
        });
        return json(200, { task });
      }

      if (taskRoute && method === "DELETE") {
        await updateTasks(store, user.id, tasks => {
          const existing = tasks.some(task => task.id === taskRoute[1]);
          if (!existing) fail(404, "Task not found.");
          const remaining = tasks
            .filter(task => task.id !== taskRoute[1])
            .map(task => task.parentTaskId === taskRoute[1] ? { ...task, parentTaskId: null } : task);
          return { tasks: remaining, value: null };
        });
        return { statusCode: 204, headers: { "cache-control": "no-store" }, body: "" };
      }

      if (route === "api/ai/assistant" && method === "POST") {
        const input = assistantSchema.parse(body);
        const tasks = await store.get(`user:${user.id}`, { type: "json", consistency: "strong" }) || [];
        const result = localAssistantResult(input, {
          completedTasks: tasks.filter(task => task.status === "completed").slice(0, 50),
          openTasks: tasks.filter(task => task.status !== "completed").slice(0, 50)
        });
        return json(200, { result, source: "local" });
      }

      return json(404, { error: "API endpoint not found." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json(400, { error: error.issues.map(issue => issue.message).join(" ") });
      }
      if (error.statusCode) return json(error.statusCode, { error: error.message });
      console.error("Unhandled Netlify API error:", error);
      return json(500, { error: "An unexpected server error occurred." });
    }
  };
}

exports.handler = event => createHandler(getStore("daymark-data"))(event);
exports.createHandler = createHandler;
