const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../netlify/functions/api");
const { handler } = require("../netlify/functions/api");

process.env.JWT_SECRET = "unit-test-secret-with-more-than-32-characters";

function createMemoryStore() {
  const records = new Map();
  let revision = 0;
  return {
    async get(key) {
      return records.get(key)?.data ?? null;
    },
    async getWithMetadata(key) {
      const record = records.get(key);
      return record ? { data: structuredClone(record.data), etag: record.etag } : { data: null, etag: null };
    },
    async setJSON(key, value, options = {}) {
      const current = records.get(key);
      if (options.onlyIfNew && current) return { modified: false };
      if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
      const etag = `revision-${++revision}`;
      records.set(key, { data: structuredClone(value), etag });
      return { modified: true, etag };
    },
    async delete(key) {
      records.delete(key);
    }
  };
}

test("Netlify Lambda compatibility initializes the managed Blobs context", async () => {
  const response = await handler({
    path: "/.netlify/functions/api/health",
    httpMethod: "GET",
    headers: {
      "x-nf-site-id": "test-site",
      "x-nf-deploy-id": "test-deploy"
    },
    blobs: Buffer.from(JSON.stringify({ url: "https://blobs.netlify.com", token: "test-token" })).toString("base64")
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { status: "ok" });
});

async function call(handler, path, { method = "GET", token, body, query = {} } = {}) {
  const response = await handler({
    path: `/.netlify/functions/api/${path}`,
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    queryStringParameters: query,
    body: body === undefined ? null : JSON.stringify(body)
  });
  return { statusCode: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

test("Netlify auth registers accounts, rejects duplicates, and signs in with a password", async () => {
  const handler = createHandler(createMemoryStore());
  const credentials = { email: " User@Example.com ", password: "correct-horse-123" };
  const registered = await call(handler, "auth/register", { method: "POST", body: credentials });

  assert.equal(registered.statusCode, 201);
  assert.equal(registered.body.user.email, "user@example.com");
  assert.ok(registered.body.token);
  assert.equal("passwordHash" in registered.body.user, false);

  const duplicate = await call(handler, "auth/register", { method: "POST", body: credentials });
  assert.equal(duplicate.statusCode, 409);

  const signedIn = await call(handler, "auth/login", { method: "POST", body: credentials });
  assert.equal(signedIn.statusCode, 200);
  assert.equal(signedIn.body.user.email, "user@example.com");

  const rejected = await call(handler, "auth/login", {
    method: "POST",
    body: { ...credentials, password: "incorrect-password" }
  });
  assert.equal(rejected.statusCode, 401);
});

test("Netlify task data requires a session and remains private to each account", async () => {
  const handler = createHandler(createMemoryStore());
  const first = await call(handler, "auth/register", {
    method: "POST",
    body: { email: "first@example.com", password: "first-password-123" }
  });
  const second = await call(handler, "auth/register", {
    method: "POST",
    body: { email: "second@example.com", password: "second-password-123" }
  });

  const unauthorized = await call(handler, "tasks");
  assert.equal(unauthorized.statusCode, 401);

  const created = await call(handler, "tasks", {
    method: "POST",
    token: first.body.token,
    body: { title: "Private task", priority: "high" }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.task.title, "Private task");

  const ownTasks = await call(handler, "tasks", { token: first.body.token });
  assert.equal(ownTasks.body.tasks.length, 1);
  const otherTasks = await call(handler, "tasks", { token: second.body.token });
  assert.deepEqual(otherTasks.body.tasks, []);
});
