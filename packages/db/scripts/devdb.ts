// Local dev Postgres without Docker/Homebrew: downloads real Postgres
// binaries and runs them against ./.devdb. Usage: pnpm --filter @pos/db devdb
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(__dirname, "..", ".devdb");

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: 5432,
    persistent: true,
  });

  if (!existsSync(join(dataDir, "PG_VERSION"))) {
    console.log("Initialising dev database cluster...");
    await pg.initialise();
  }
  await pg.start();
  await pg.createDatabase("pos").catch(() => {
    /* already exists */
  });
  console.log("Dev Postgres running on localhost:5432 (db: pos). Ctrl-C to stop.");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
