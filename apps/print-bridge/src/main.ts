// POS print bridge: runs on-site, pairs once with a PRINT_BRIDGE device
// token, then prints jobs pushed over the socket (with a pending-queue
// fetch on every (re)connect, so nothing is lost while offline).
//
// Env: API_URL (default http://localhost:3000), DEVICE_TOKEN (required),
//      PRINTERS_CONFIG (default ./printers.json)
import { readFileSync } from "node:fs";
import { io } from "socket.io-client";
import { renderKitchen, renderReceipt } from "./render";
import { BridgeConfig, send } from "./printers";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN;
const CONFIG_PATH = process.env.PRINTERS_CONFIG ?? "./printers.json";

interface PrintJob {
  id: string;
  type: "RECEIPT" | "KITCHEN";
  station: string | null;
  payload: never;
}

function loadConfig(): BridgeConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as BridgeConfig;
  } catch {
    console.warn(`No ${CONFIG_PATH} found — printing to console.`);
    return { receipt: { type: "console" } };
  }
}

async function api<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function main() {
  if (!DEVICE_TOKEN) {
    console.error("DEVICE_TOKEN is required (register a PRINT_BRIDGE device in back office)");
    process.exit(1);
  }
  const config = loadConfig();
  const inFlight = new Set<string>();

  let session = await api<{ token: string; outletId: string }>(
    "POST",
    "/bridge/session",
    { deviceToken: DEVICE_TOKEN },
  );
  console.log(`Print bridge up — outlet ${session.outletId}`);

  const processJob = async (job: PrintJob) => {
    if (inFlight.has(job.id)) return;
    inFlight.add(job.id);
    try {
      const target =
        job.type === "RECEIPT"
          ? (config.receipt ?? { type: "console" as const })
          : (config.stations?.[job.station ?? "kitchen"] ??
            config.stations?.kitchen ??
            config.receipt ?? { type: "console" as const });
      const data =
        job.type === "RECEIPT" ? renderReceipt(job.payload) : renderKitchen(job.payload);
      await send(target, data);
      await api("POST", `/bridge/jobs/${job.id}/ack`, { ok: true }, session.token);
      console.log(`printed ${job.type}${job.station ? `/${job.station}` : ""} ${job.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`print failed ${job.id}: ${message}`);
      await api(
        "POST",
        `/bridge/jobs/${job.id}/ack`,
        { ok: false, error: message },
        session.token,
      ).catch(() => {});
    } finally {
      inFlight.delete(job.id);
    }
  };

  const drainPending = async () => {
    const jobs = await api<PrintJob[]>("GET", "/bridge/jobs", undefined, session.token);
    for (const job of jobs) await processJob(job);
  };

  const socket = io(`${API_URL}/rt`, { auth: { token: session.token } });
  socket.on("connect", () => {
    console.log("socket connected");
    void drainPending().catch((e) => console.error(e));
  });
  socket.on("disconnect", () => console.log("socket disconnected — will retry"));
  socket.on("print.job", (job: PrintJob) => void processJob(job));

  // Sessions expire; renew every 12h and reconnect the socket with it.
  setInterval(async () => {
    try {
      session = await api("POST", "/bridge/session", { deviceToken: DEVICE_TOKEN });
      (socket.auth as { token: string }).token = session.token;
    } catch (e) {
      console.error("session renewal failed", e);
    }
  }, 12 * 60 * 60 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
