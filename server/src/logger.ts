import { secretValues } from "./config.js";

// A tiny logger. Its one non-obvious job: if a secret ever ends up inside a
// message (for example in an error string from a library), it is replaced
// before printing. Rule of thumb remains: never pass secrets to the logger.
function redact(text: string): string {
  let out = text;
  for (const secret of secretValues) out = out.split(secret).join("[redacted]");
  return out;
}

function write(level: "INFO" | "WARN" | "ERROR", message: string, meta?: unknown) {
  const suffix = meta === undefined ? "" : " " + (typeof meta === "string" ? meta : JSON.stringify(meta));
  const line = `${new Date().toISOString()} ${level} ${message}${suffix}`;
  (level === "ERROR" ? console.error : console.log)(redact(line));
}

export const logger = {
  info: (message: string, meta?: unknown) => write("INFO", message, meta),
  warn: (message: string, meta?: unknown) => write("WARN", message, meta),
  error: (message: string, meta?: unknown) => write("ERROR", message, meta),
};
