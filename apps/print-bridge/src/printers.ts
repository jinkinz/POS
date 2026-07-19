import { appendFileSync } from "node:fs";
import net from "node:net";

/**
 * Printer targets from printers.json:
 *   tcp     — network ESC/POS printer (the normal case, port 9100)
 *   console — dev: log a readable preview to stdout
 *   file    — testing: append raw bytes to a file
 */
export type PrinterTarget =
  | { type: "tcp"; host: string; port?: number }
  | { type: "console" }
  | { type: "file"; path: string };

export interface BridgeConfig {
  receipt?: PrinterTarget;
  /** Per-station kitchen printers; "kitchen" is the default station. */
  stations?: Record<string, PrinterTarget>;
}

export async function send(target: PrinterTarget, data: Buffer): Promise<void> {
  switch (target.type) {
    case "tcp":
      return new Promise((resolve, reject) => {
        const socket = net.connect(target.port ?? 9100, target.host);
        socket.setTimeout(5000);
        socket.on("connect", () => {
          socket.end(data, () => resolve());
        });
        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error(`printer ${target.host} timed out`));
        });
        socket.on("error", reject);
      });
    case "console": {
      // Strip ESC/POS control sequences for a readable preview.
      const preview = data
        .toString("utf8")
        .replace(/[\x00-\x08\x0b-\x1f\x1d\x1b][@aEd!V]?[\x00-\x42]?/g, "");
      console.log("┌── print ─────────────────────────────");
      for (const line of preview.split("\n")) console.log("│ " + line);
      console.log("└──────────────────────────────────────");
      return;
    }
    case "file":
      appendFileSync(target.path, data);
      return;
  }
}
