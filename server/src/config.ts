import "dotenv/config";
import { z } from "zod";

// All configuration comes from environment variables, validated once at startup.
// If something is missing we fail immediately with a clear message, instead of
// crashing later in the middle of a poll run.
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Optional for now; later phases will make the ones they need required.
  GITHUB_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("onboarding@resend.dev"),
  BASE_URL: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print only which variables are wrong, never their values.
  const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  console.error("Invalid environment configuration:\n - " + problems.join("\n - "));
  process.exit(1);
}

export const config = parsed.data;

// Values the logger must never print (used by logger.ts to redact).
export const secretValues: string[] = [
  config.DATABASE_URL,
  config.GITHUB_TOKEN,
  config.RESEND_API_KEY,
].filter((v): v is string => Boolean(v));
