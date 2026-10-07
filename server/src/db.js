const fs = require("node:fs/promises");
const path = require("node:path");
const isSqlite = !process.env.DATABASE_URL;

if (isSqlite && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL must be configured in production.");
}

let pool;
let sqliteDatabase;

if (isSqlite) {
  const Database = require("better-sqlite3");
  const dataDirectory = path.join(__dirname, "..", "data");
  require("node:fs").mkdirSync(dataDirectory, { recursive: true });
  sqliteDatabase = new Database(path.join(dataDirectory, "task-manager.sqlite"));
  sqliteDatabase.pragma("foreign_keys = ON");
  sqliteDatabase.pragma("journal_mode = WAL");

  pool = {
    async query(sql, params = []) {
      const sqliteSql = sql
        .replace(/COUNT\(\*\)\s+FILTER\s+\(WHERE\s+(.+?)\)(?:\s*::int)?/gi, "COALESCE(SUM(CASE WHEN $1 THEN 1 ELSE 0 END), 0)")
        .replace(/::(?:int|text|date)\b/gi, "")
        .replace(/\bILIKE\b/gi, "LIKE")
        .replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP");
      const values = [];
      const positionalSql = sqliteSql.replace(/\$(\d+)/g, (_match, index) => {
        values.push(params[Number(index) - 1]);
        return "?";
      });
      const statement = sqliteDatabase.prepare(positionalSql);
      if (/^\s*(SELECT|WITH)\b/i.test(positionalSql) || /\bRETURNING\b/i.test(positionalSql)) {
        const rows = statement.all(...values);
        return { rows, rowCount: rows.length };
      }
      const result = statement.run(...values);
      return { rows: [], rowCount: result.changes };
    },
    async end() {
      sqliteDatabase.close();
    }
  };
} else {
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined
  });
}

async function initializeDatabase() {
  const schemaFile = isSqlite ? "schema.sqlite.sql" : "schema.sql";
  const schema = await fs.readFile(path.join(__dirname, "..", schemaFile), "utf8");
  if (isSqlite) sqliteDatabase.exec(schema);
  else await pool.query(schema);
}

module.exports = { isSqlite, pool, initializeDatabase };
