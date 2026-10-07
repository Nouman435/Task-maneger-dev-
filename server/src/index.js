require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env") });

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { initializeDatabase, pool } = require("./db");

const port = Number(process.env.PORT || 3001);
const dataDirectory = path.join(__dirname, "..", "data");

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters in production.");
  }
  fs.mkdirSync(dataDirectory, { recursive: true });
  const secretFile = path.join(dataDirectory, ".jwt-secret");
  try {
    process.env.JWT_SECRET = fs.readFileSync(secretFile, "utf8").trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    process.env.JWT_SECRET = randomBytes(48).toString("hex");
    fs.writeFileSync(secretFile, process.env.JWT_SECRET, { mode: 0o600, flag: "wx" });
  }
}

const app = require("./app");

initializeDatabase()
  .then(() => {
    const server = app.listen(port, () => console.log(`Task Manager API listening on http://localhost:${port}`));
    let shuttingDown = false;
    const shutdown = signal => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received. Finishing active requests before restart...`);
      const forceExit = setTimeout(() => {
        console.error("Graceful shutdown timed out.");
        process.exit(1);
      }, 10000);
      forceExit.unref();
      server.close(async error => {
        clearTimeout(forceExit);
        if (error) {
          console.error("Unable to close the API server cleanly:", error);
          process.exitCode = 1;
        }
        try {
          await pool.end();
        } catch (closeError) {
          console.error("Unable to close the database cleanly:", closeError);
          process.exitCode = 1;
        }
      });
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  })
  .catch(async error => {
    console.error("Unable to initialize the database:", error);
    await pool.end();
    process.exitCode = 1;
  });
