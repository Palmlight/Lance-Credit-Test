import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run Drizzle commands");
}

const databaseUrl = new URL(process.env.DATABASE_URL);

export default defineConfig({
  out: "./drizzle",
  schema: "./src/models/*.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 5432),
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseUrl.pathname.replace(/^\//, ""),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  },
  verbose: true,
  strict: true
});
