const test = require("node:test");
const assert = require("node:assert/strict");
const { authSchema, taskCreateSchema, taskUpdateSchema } = require("../src/validation");
const { localDateOffset, localTaskDraft, roleDailyPlan, taskDraftSchema } = require("../src/ai");

test("normalizes email and rejects short passwords", () => {
  assert.equal(authSchema.parse({ email: " User@Example.com ", password: "12345678" }).email, "user@example.com");
  assert.equal(authSchema.safeParse({ email: "user@example.com", password: "short" }).success, false);
});

test("task creation supplies safe defaults and validates status", () => {
  const result = taskCreateSchema.parse({ title: "  Write report " });
  assert.equal(result.title, "Write report");
  assert.equal(result.status, "pending");
  assert.equal(result.priority, "medium");
  assert.equal(result.category, "General");
  assert.equal(taskCreateSchema.safeParse({ title: "Task", status: "unknown" }).success, false);
});

test("task update requires at least one valid field", () => {
  assert.equal(taskUpdateSchema.safeParse({}).success, false);
  assert.deepEqual(taskUpdateSchema.parse({ status: "completed" }), { status: "completed" });
  assert.equal(taskUpdateSchema.safeParse({ ownerId: "someone-else" }).success, false);
});

test("AI task draft is constrained to known priorities and valid dates", () => {
  const draft = taskDraftSchema.parse({
    title: "Prepare proposal",
    description: "",
    dueDate: "2026-10-09",
    priority: "high",
    category: "Client Work",
    subtasks: []
  });
  assert.equal(draft.priority, "high");
  assert.equal(taskDraftSchema.safeParse({ ...draft, dueDate: "Friday" }).success, false);
});

test("local task assistant extracts a deadline and useful task defaults without an API key", () => {
  const draft = localTaskDraft("I need to prepare a presentation for tomorrow and send it to the client.");
  assert.match(draft.title, /prepare a presentation/i);
  assert.doesNotMatch(draft.title, /tomorrow/i);
  assert.equal(draft.dueDate, localDateOffset(1));
  assert.equal(draft.priority, "high");
  assert.equal(draft.category, "Client Work");
  assert.deepEqual(taskDraftSchema.parse(draft), draft);
});

test("local role planning returns actionable business-development guidance", () => {
  const plan = roleDailyPlan("Plan task for me as a Business Developer. What should I work on?");
  assert.match(plan.text, /business development/i);
  assert.match(plan.text, /prospects/i);
  assert.match(plan.text, /CRM/i);
});
