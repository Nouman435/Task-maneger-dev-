import { useCallback, useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";
const LOCAL_ONLY = import.meta.env.VITE_LOCAL_ONLY === "true";
const LOCAL_TASKS_KEY = "daymark-public-tasks-v1";
const emptyDraft = {
  title: "",
  description: "",
  status: "pending",
  priority: "medium",
  category: "General",
  dueDate: ""
};

function readLocalTasks() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_TASKS_KEY) || "[]");
    if (!Array.isArray(data)) throw new Error("Saved tasks have an unexpected format.");
    return data;
  } catch (error) {
    throw new Error(`Could not read tasks saved in this browser: ${error.message}`);
  }
}

function saveLocalTasks(tasks) {
  try {
    localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
  } catch (error) {
    throw new Error(`Could not save tasks in this browser: ${error.message}`);
  }
}

function getLocalStats(tasks) {
  return {
    total: tasks.length,
    pending: tasks.filter(task => task.status === "pending").length,
    in_progress: tasks.filter(task => task.status === "in_progress").length,
    completed: tasks.filter(task => task.status === "completed").length,
    overdue: tasks.filter(task => task.status !== "completed" && task.dueDate && task.dueDate < localDateString()).length
  };
}

function localTaskAssistant(text) {
  const prompt = text.trim();
  if (/\b(plan|what should i work on|what kind of things should i|help me plan|suggest (?:some )?tasks?)\b/i.test(prompt)) {
    const businessDevelopment = /\b(business developer|business development|sales|partnership)\b/i.test(prompt);
    const role = businessDevelopment ? "business development" : "work";
    const ideas = businessDevelopment
      ? ["Review your pipeline and pick three high-potential prospects.", "Research target companies and identify decision-makers.", "Send personalized outreach and follow up on warm leads.", "Prepare for client meetings with goals and a clear next step.", "Update CRM notes, deal stages, and commitments.", "Coordinate with your team on active opportunities.", "Review progress and set tomorrow's top follow-ups."]
      : ["Review your commitments and choose the three most valuable outcomes.", "Handle important messages and time-sensitive follow-ups.", "Block focused time for your main project.", "Check progress and resolve blockers.", "Record progress and choose tomorrow's first task."];
    return { action: "plan", text: `A practical ${role} plan for today:\n\n${ideas.map((idea, index) => `${index + 1}. ${idea}`).join("\n")}\n\nChoose the items that fit your real commitments and deadlines.`, source: "local" };
  }

  const today = new Date();
  const lower = prompt.toLowerCase();
  let dueDate = "";
  if (/\btoday\b/.test(lower)) dueDate = localDateString();
  else if (/\btomorrow\b/.test(lower)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dueDate = localDateString(tomorrow);
  } else {
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const namedDay = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (namedDay) {
      const offset = (dayNames.indexOf(namedDay[1]) - today.getDay() + 7) % 7 || 7;
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      dueDate = localDateString(date);
    }
  }

  const title = prompt
    .replace(/^(?:please\s+)?(?:i need to|i have to|i want to|i should|need to|have to|want to|please)\s+/i, "")
    .replace(/\b(?:by|before|on|for)\s+(?:(?:this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/ig, "")
    .replace(/\s+/g, " ")
    .replace(/^[,.:;\s]+|[,.:;\s]+$/g, "")
    .slice(0, 200) || prompt.slice(0, 200);
  const category = /\b(client|customer|sales|prospect|business development|business developer|partnership)\b/i.test(prompt)
    ? "Client Work"
    : /\b(presentation|report|proposal|document)\b/i.test(prompt) ? "Work" : "General";
  const task = {
    ...emptyDraft,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    description: "",
    category,
    dueDate,
    priority: /\b(urgent|asap|critical|client|deadline|important)\b/i.test(prompt) ? "high" : "medium"
  };
  return { ...task, subtasks: [] };
}

async function localApi(path, options = {}) {
  const url = new URL(path, window.location.origin);
  const method = options.method || "GET";
  const body = options.body || {};

  if (url.pathname === "/api/auth/me") {
    return { user: { id: "browser", email: "Saved in this browser" } };
  }
  if (url.pathname === "/api/tasks/stats") {
    return { stats: getLocalStats(readLocalTasks()) };
  }
  if (url.pathname === "/api/tasks" && method === "GET") {
    let tasks = readLocalTasks();
    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const category = url.searchParams.get("category");
    const query = (url.searchParams.get("q") || "").toLowerCase();
    if (status) tasks = tasks.filter(task => task.status === status);
    if (priority) tasks = tasks.filter(task => task.priority === priority);
    if (category) tasks = tasks.filter(task => task.category === category);
    if (query) tasks = tasks.filter(task => `${task.title} ${task.description}`.toLowerCase().includes(query));
    return { tasks };
  }
  if (url.pathname === "/api/tasks" && method === "POST") {
    const tasks = readLocalTasks();
    const task = {
      id: crypto.randomUUID(),
      parentTaskId: body.parentTaskId || null,
      ...emptyDraft,
      ...body,
      dueDate: body.dueDate || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    tasks.unshift(task);
    saveLocalTasks(tasks);
    return { task };
  }
  const taskId = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]+)$/i)?.[1];
  if (taskId && method === "PATCH") {
    const tasks = readLocalTasks();
    const index = tasks.findIndex(task => task.id === taskId);
    if (index < 0) throw new Error("Task not found.");
    tasks[index] = { ...tasks[index], ...body, updatedAt: new Date().toISOString() };
    saveLocalTasks(tasks);
    return { task: tasks[index] };
  }
  if (taskId && method === "DELETE") {
    saveLocalTasks(readLocalTasks().filter(task => task.id !== taskId));
    return null;
  }
  if (url.pathname === "/api/ai/assistant") {
    if (body.action === "parse") return { result: localTaskAssistant(body.text), source: "local" };
    if (body.action === "role-plan") return { result: localTaskAssistant(body.prompt), source: "local" };
    if (body.action === "plan") {
      const tasks = readLocalTasks().filter(task => task.status !== "completed");
      return { result: { text: tasks.length
        ? `A practical plan for today:\n\n${tasks.slice(0, 5).map((task, index) => `${index + 1}. ${task.title}${task.dueDate ? ` — due ${formatDate(task.dueDate)}` : ""}`).join("\n")}\n\nStart with the most important item.`
        : "Your list is clear. Add tasks or describe your role above for a suggested plan." }, source: "local" };
    }
    if (body.action === "summary") {
      const tasks = readLocalTasks().filter(task => task.status === "completed");
      return { result: { text: tasks.length ? `You completed ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}:\n${tasks.slice(0, 6).map(task => `• ${task.title}`).join("\n")}` : "No completed tasks yet. Finish one and your summary will appear here." }, source: "local" };
    }
    if (body.action === "subtasks") {
      return { result: { subtasks: [`Define the goal for ${body.title}`, "Gather the information and resources you need", "Complete the main work", "Review the result and note follow-ups"] }, source: "local" };
    }
    if (body.action === "description") {
      return { result: { description: `Complete ${body.title} for ${body.category || "General"}. Review the result and record any follow-up work.` }, source: "local" };
    }
    if (body.action === "priority") {
      return { result: { priority: /\b(urgent|asap|critical|client|deadline)\b/i.test(`${body.title} ${body.description || ""}`) ? "high" : "medium", reason: "Suggested locally from the task details." }, source: "local" };
    }
  }
  throw new Error("This feature isn't available in the public browser-only version.");
}

async function api(path, token, options = {}) {
  if (LOCAL_ONLY) return localApi(path, options);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function formatDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function localDateString(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function isOverdue(task) {
  return task.status !== "completed" && task.dueDate && task.dueDate < localDateString();
}

function App() {
  const [token, setToken] = useState(() => LOCAL_ONLY ? "local-workspace" : sessionStorage.getItem("task-manager-token") || "");
  const [user, setUser] = useState(() => LOCAL_ONLY ? { id: "browser", email: "Saved in this browser" } : null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loadingSession, setLoadingSession] = useState(Boolean(token) && !LOCAL_ONLY);
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 });
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(null);
  const [showComposer, setShowComposer] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [assistantSource, setAssistantSource] = useState("");

  const clearSession = useCallback(() => {
    sessionStorage.removeItem("task-manager-token");
    setToken("");
    setUser(null);
    setTasks([]);
  }, []);

  const refreshData = useCallback(async currentToken => {
    setLoadingTasks(true);
    setTaskError("");
    try {
      const [taskData, statData] = await Promise.all([
        api("/api/tasks", currentToken),
        api("/api/tasks/stats", currentToken)
      ]);
      setTasks(taskData.tasks);
      setStats(statData.stats);
    } catch (error) {
      if (error.message.toLowerCase().includes("session")) clearSession();
      setTaskError(error.message);
    } finally {
      setLoadingTasks(false);
    }
  }, [clearSession]);

  useEffect(() => {
    if (!token) {
      setLoadingSession(false);
      return;
    }
    let cancelled = false;
    api("/api/auth/me", token)
      .then(data => {
        if (cancelled) return;
        setUser(data.user);
        setLoadingSession(false);
        refreshData(token);
      })
      .catch(error => {
        if (cancelled) return;
        clearSession();
        setAuthError(error.message);
        setLoadingSession(false);
      });
    return () => { cancelled = true; };
  }, [token, refreshData, clearSession]);

  async function handleAuth(event) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const data = await api(`/api/auth/${authMode === "register" ? "register" : "login"}`, "", {
        method: "POST",
        body: authForm
      });
      sessionStorage.setItem("task-manager-token", data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthForm({ email: "", password: "" });
      await refreshData(data.token);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  const categories = useMemo(() => [...new Set(tasks.map(task => task.category))].sort(), [tasks]);
  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks.filter(task => {
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      const matchesCategory = categoryFilter === "all" || task.category === categoryFilter;
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      const matchesQuery = !normalizedQuery ||
        `${task.title} ${task.description} ${task.category}`.toLowerCase().includes(normalizedQuery);
      return matchesStatus && matchesCategory && matchesPriority && matchesQuery;
    });
  }, [tasks, statusFilter, categoryFilter, priorityFilter, query]);

  function updateDraft(field, value) {
    setDraft(current => ({ ...current, [field]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft);
    setShowComposer(true);
    setTaskError("");
  }

  function startEdit(task) {
    setDraft({
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority,
      category: task.category,
      dueDate: task.dueDate || ""
    });
    setEditingId(task.id);
    setShowComposer(true);
    setTaskError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveTask(event) {
    event.preventDefault();
    setTaskError("");
    try {
      const path = editingId ? `/api/tasks/${editingId}` : "/api/tasks";
      await api(path, token, { method: editingId ? "PATCH" : "POST", body: draft });
      setDraft(emptyDraft);
      setEditingId(null);
      setShowComposer(false);
      await refreshData(token);
    } catch (error) {
      setTaskError(error.message);
    }
  }

  async function changeTask(task, changes) {
    setTaskError("");
    try {
      await api(`/api/tasks/${task.id}`, token, { method: "PATCH", body: changes });
      await refreshData(token);
      return true;
    } catch (error) {
      setTaskError(error.message);
      return false;
    }
  }

  async function deleteTask(task) {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    setTaskError("");
    try {
      await api(`/api/tasks/${task.id}`, token, { method: "DELETE" });
      await refreshData(token);
    } catch (error) {
      setTaskError(error.message);
    }
  }

  async function askAI(action, payload = {}) {
    setAiBusy(true);
    setAiError("");
    setAiMessage("");
    setAssistantSource("");
    try {
      const data = await api("/api/ai/assistant", token, {
        method: "POST",
        body: { action, ...payload }
      });
      setAssistantSource(data.source || "");
      return data;
    } catch (error) {
      setAiError(error.message);
      return null;
    } finally {
      setAiBusy(false);
    }
  }

  async function createFromAI(event) {
    event.preventDefault();
    if (!aiText.trim()) return;
    const prompt = aiText.trim();
    if (/\b(plan|what should i work on|what kind of things should i|help me plan|suggest (?:some )?tasks?)\b/i.test(prompt)) {
      const response = await askAI("role-plan", { prompt });
      if (response) setAiMessage(response.result.text);
      return;
    }
    const response = await askAI("parse", { text: prompt });
    if (!response) return;

    try {
      const result = response.result;
      const { subtasks = [], ...taskDraft } = result;
      const created = await api("/api/tasks", token, { method: "POST", body: taskDraft });
      let createdChildren = 0;
      for (const title of subtasks) {
        await api("/api/tasks", token, {
          method: "POST",
          body: { ...emptyDraft, title, category: taskDraft.category, parentTaskId: created.task.id }
        });
        createdChildren += 1;
      }
      setAiMessage(`Created "${created.task.title}"${createdChildren ? ` and ${createdChildren} subtasks` : ""}${response.source === "local" ? " using the local assistant." : "."}`);
      setAiText("");
      await refreshData(token);
    } catch (error) {
      setAiError(`The AI drafted your task, but saving failed: ${error.message}`);
      await refreshData(token);
    }
  }

  async function generateSubtasks(task) {
    const response = await askAI("subtasks", { title: task.title, description: task.description });
    if (!response) return;
    try {
      for (const title of response.result.subtasks) {
        await api("/api/tasks", token, {
          method: "POST",
          body: { ...emptyDraft, title, category: task.category, priority: task.priority, parentTaskId: task.id }
        });
      }
      setAiMessage(`Added ${response.result.subtasks.length} subtasks for "${task.title}".`);
      await refreshData(token);
    } catch (error) {
      setAiError(`Some subtasks may have been saved, but the operation did not finish: ${error.message}`);
      await refreshData(token);
    }
  }

  async function generateDescription(task) {
    const response = await askAI("description", { title: task.title, category: task.category });
    if (!response) return;
    if (await changeTask(task, { description: response.result.description })) {
      setAiMessage("AI-generated description saved.");
    }
  }

  async function suggestPriority(task) {
    const response = await askAI("priority", { title: task.title, description: task.description, dueDate: task.dueDate || undefined });
    if (!response) return;
    if (await changeTask(task, { priority: response.result.priority })) {
      setAiMessage(`Priority set to ${response.result.priority}: ${response.result.reason}`);
    }
  }

  async function showAIOverview(action) {
    const response = await askAI(action);
    if (response) setAiMessage(response.result.text);
  }

  const groupedTasks = useMemo(() => {
    const children = new Map();
    const topLevel = [];
    filteredTasks.forEach(task => {
      if (task.parentTaskId) {
        if (!children.has(task.parentTaskId)) children.set(task.parentTaskId, []);
        children.get(task.parentTaskId).push(task);
      } else {
        topLevel.push(task);
      }
    });
    return topLevel.flatMap(task => [task, ...(children.get(task.id) || [])]);
  }, [filteredTasks]);

  if (loadingSession) {
    return <div className="loading-screen"><div className="brand-mark">✓</div><p>Loading your workspace…</p></div>;
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark">✓</div>
          <p className="eyebrow">A LITTLE MORE FOCUSED</p>
          <h1>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="muted-copy">Your work, thoughtfully organized in one place.</p>
          <form className="auth-form" onSubmit={handleAuth}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required maxLength="254" value={authForm.email} onChange={event => setAuthForm(current => ({ ...current, email: event.target.value }))} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} required minLength="8" maxLength="128" value={authForm.password} onChange={event => setAuthForm(current => ({ ...current, password: event.target.value }))} />
            {authError && <p className="inline-error" role="alert">{authError}</p>}
            <button className="primary-button full-button" disabled={authBusy} type="submit">{authBusy ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}</button>
          </form>
          <p className="auth-toggle">
            {authMode === "login" ? "New here?" : "Already have an account?"}
            {" "}<button type="button" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}>
              {authMode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
          <p className="security-note">Passwords are securely hashed. Your tasks are private to your account.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Task Manager home"><span className="brand-mark small-mark">✓</span><span>daymark<span className="wordmark-dot">.</span></span></a>
        <div className="account-menu">
          <span className="account-email">{user.email}</span>
          {LOCAL_ONLY
            ? <span className="storage-badge">PRIVATE · THIS DEVICE</span>
            : <button className="quiet-button signout-button" type="button" onClick={clearSession}>Sign out</button>}
        </div>
      </header>

      <section className="welcome-row" id="top">
        <div>
          <p className="eyebrow">YOUR PERSONAL WORKSPACE</p>
          <h1>Good work starts with a clear mind.</h1>
          <p className="muted-copy">A little progress, thoughtfully planned.</p>
        </div>
        <button className="primary-button create-button" type="button" onClick={startCreate}><span aria-hidden="true">＋</span> New task</button>
      </section>

      <section className="stats-grid" aria-label="Task statistics">
        <StatCard label="All tasks" value={stats.total} icon="▤" tone="neutral" />
        <StatCard label="To do" value={stats.pending} icon="○" tone="sand" />
        <StatCard label="In progress" value={stats.in_progress} icon="◷" tone="blue" />
        <StatCard label="Completed" value={stats.completed} icon="✓" tone="green" />
        <StatCard label="Overdue" value={stats.overdue} icon="!" tone="rose" />
      </section>

      <section className="ai-panel" aria-label="AI task assistant">
        <div className="ai-heading">
          <div className="ai-icon">✦</div>
          <div><h2>Your AI planning partner</h2><p>Turn a thought into an organized task, or get a plan for your day.</p></div>
          <span className={`ai-badge${LOCAL_ONLY || assistantSource === "local" ? " local-badge" : ""}`}>{LOCAL_ONLY || assistantSource === "local" ? "LOCAL MODE" : "AI ASSISTANT"}</span>
        </div>
        <form className="ai-form" onSubmit={createFromAI}>
          <label className="visually-hidden" htmlFor="ai-prompt">Describe what you need to do</label>
          <textarea id="ai-prompt" rows="2" maxLength="2000" placeholder={'Try “Prepare a presentation for Friday and send it to the client.”'} value={aiText} onChange={event => setAiText(event.target.value)} />
          <button className="ai-submit" type="submit" disabled={aiBusy || !aiText.trim()}>{aiBusy ? "Thinking…" : <><span>✦</span> Create with AI</>}</button>
        </form>
        <div className="ai-tools">
          <button type="button" disabled={aiBusy} onClick={() => showAIOverview("plan")}>✦ Plan my day</button>
          <button type="button" disabled={aiBusy} onClick={() => showAIOverview("summary")}>↗ Summarize completed work</button>
        </div>
        <p className="ai-setup-note">{LOCAL_ONLY ? "Tasks stay in this browser on this device. No account or server is connected." : "Basic local suggestions work without setup. Add an OpenAI API key for full AI-generated assistance."}</p>
        {aiError && <p className="inline-error" role="alert">{aiError}</p>}
        {aiMessage && <p className="ai-result" role="status">{aiMessage}</p>}
      </section>

      {showComposer && (
        <section className="composer-card" aria-labelledby="composer-title">
          <div className="section-heading composer-heading">
            <div><p className="eyebrow">{editingId ? "MAKE AN UPDATE" : "ADD TO YOUR LIST"}</p><h2 id="composer-title">{editingId ? "Edit task" : "Create a task"}</h2></div>
            <button className="quiet-button" type="button" onClick={() => { setShowComposer(false); setEditingId(null); setDraft(emptyDraft); }}>Cancel</button>
          </div>
          <form onSubmit={saveTask}>
            <div className="form-grid">
              <label className="field wide-field">Task title<input autoFocus required maxLength="200" value={draft.title} placeholder="What needs to get done?" onChange={event => updateDraft("title", event.target.value)} /></label>
              <label className="field wide-field">Description<textarea rows="2" maxLength="5000" value={draft.description} placeholder="Add a few helpful details…" onChange={event => updateDraft("description", event.target.value)} /></label>
              <label className="field">Priority<select value={draft.priority} onChange={event => updateDraft("priority", event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <label className="field">Status<select value={draft.status} onChange={event => updateDraft("status", event.target.value)}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label>
              <label className="field">Category<input list="category-options" maxLength="60" value={draft.category} onChange={event => updateDraft("category", event.target.value)} /><datalist id="category-options">{categories.map(category => <option key={category} value={category} />)}</datalist></label>
              <label className="field">Due date<input type="date" value={draft.dueDate} onChange={event => updateDraft("dueDate", event.target.value)} /></label>
            </div>
            {taskError && <p className="inline-error" role="alert">{taskError}</p>}
            <div className="composer-actions"><button className="primary-button" type="submit">{editingId ? "Save changes" : "Add task"}</button></div>
          </form>
        </section>
      )}

      <section className="task-section" aria-labelledby="tasks-title">
        <div className="section-heading task-section-heading">
          <div><p className="eyebrow">YOUR TASKS</p><h2 id="tasks-title">The list</h2></div>
          <span className="task-count">{filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        <div className="filter-toolbar">
          <div className="search-box"><span aria-hidden="true">⌕</span><label className="visually-hidden" htmlFor="task-search">Search tasks</label><input id="task-search" type="search" placeholder="Search tasks…" value={query} onChange={event => setQuery(event.target.value)} /></div>
          <label className="visually-hidden" htmlFor="status-filter">Filter by status</label>
          <select id="status-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
          </select>
          <label className="visually-hidden" htmlFor="category-filter">Filter by category</label>
          <select id="category-filter" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="priority-filter">Filter by priority</label>
          <select id="priority-filter" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}>
            <option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option>
          </select>
        </div>

        {taskError && !showComposer && <p className="inline-error page-error" role="alert">{taskError}</p>}
        {loadingTasks ? <div className="list-placeholder">Loading tasks…</div> : groupedTasks.length ? (
          <div className="task-list">
            {groupedTasks.map(task => (
              <TaskRow key={task.id} task={task} child={Boolean(task.parentTaskId)} onChange={changeTask} onEdit={startEdit} onDelete={deleteTask} onSubtasks={generateSubtasks} onDescription={generateDescription} onPriority={suggestPriority} aiBusy={aiBusy} />
            ))}
          </div>
        ) : (
          <div className="empty-list">
            <span className="empty-mark">✦</span>
            <h3>{tasks.length ? "No tasks match these filters" : "A fresh start"}</h3>
            <p>{tasks.length ? "Try adjusting your search or filters." : "Add your first task or let AI organize an idea for you."}</p>
            {!tasks.length && <button className="text-button" type="button" onClick={startCreate}>Create your first task →</button>}
          </div>
        )}
      </section>
      <footer className="page-footer"><span>Make space for what matters.</span><span>Private to your account · Saved securely</span></footer>
    </main>
  );
}

function StatCard({ label, value, icon, tone }) {
  return <article className={`stat-card ${tone}`}><span className="stat-icon" aria-hidden="true">{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong></article>;
}

function TaskRow({ task, child, onChange, onEdit, onDelete, onSubtasks, onDescription, onPriority, aiBusy }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const nextStatus = task.status === "pending" ? "in_progress" : task.status === "in_progress" ? "completed" : "pending";
  const statusLabel = task.status === "pending" ? "Pending" : task.status === "in_progress" ? "In progress" : "Completed";
  return (
    <article className={`task-row${task.status === "completed" ? " is-done" : ""}${child ? " is-child" : ""}`}>
      <button className={`task-status status-${task.status}`} type="button" aria-label={`Set ${task.title} to ${nextStatus.replace("_", " ")}`} title={`Current status: ${statusLabel}. Click to change.`} onClick={() => onChange(task, { status: nextStatus })}>
        {task.status === "completed" ? "✓" : task.status === "in_progress" ? "◷" : ""}
      </button>
      <div className="task-main">
        <div className="task-title-line"><h3>{task.title}</h3><span className={`priority-pill priority-${task.priority}`}>{task.priority}</span></div>
        {task.description && <p className="task-description">{task.description}</p>}
        <div className="task-meta"><span className="category-pill">{task.category}</span><span className={`status-label label-${task.status}`}>{statusLabel}</span>{task.dueDate && <span className={`due-label${isOverdue(task) ? " overdue" : ""}`}>{isOverdue(task) ? "Overdue · " : "Due "}{formatDate(task.dueDate)}</span>}{child && <span className="subtask-label">Subtask</span>}</div>
      </div>
      <div className="row-actions">
        <button className="icon-action" type="button" aria-label={`Edit ${task.title}`} title="Edit task" onClick={() => onEdit(task)}>✎</button>
        <div className="more-wrap">
          <button className="icon-action" type="button" aria-label={`AI actions for ${task.title}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>···</button>
          {menuOpen && <div className="action-menu" role="menu">
            <button type="button" role="menuitem" disabled={aiBusy} onClick={() => { setMenuOpen(false); onSubtasks(task); }}>✦ Break into subtasks</button>
            <button type="button" role="menuitem" disabled={aiBusy} onClick={() => { setMenuOpen(false); onDescription(task); }}>✦ Generate description</button>
            <button type="button" role="menuitem" disabled={aiBusy} onClick={() => { setMenuOpen(false); onPriority(task); }}>✦ Suggest priority</button>
            <button className="delete-action" type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(task); }}>Delete task</button>
          </div>}
        </div>
      </div>
    </article>
  );
}

export default App;
