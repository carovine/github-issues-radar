import { parseArgs } from "node:util";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { createGitHubClient } from "./client.js";
import { buildSearchQuery } from "./query.js";

// Tiny manual-testing tool: runs ONE search (one page) and prints the rate-limit state.
//   npm run github:search -- --language typescript --label "good first issue"
//   npm run github:search -- --language python --label bug --since 2026-11-19T00:00:00Z

async function main() {
  const { values } = parseArgs({
    options: {
      language: { type: "string" },
      label: { type: "string" },
      since: { type: "string" }, // ISO date; default: 2 days ago
    },
  });

  if (!values.language || !values.label) {
    console.error('Usage: npm run github:search -- --language <lang> --label "<label>" [--since <ISO date>]');
    process.exitCode = 1;
    return;
  }

  const createdAfter = values.since ? new Date(values.since) : new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const filter = { language: values.language, label: values.label, createdAfter };

  if (!config.GITHUB_TOKEN) {
    logger.warn("GITHUB_TOKEN not set: unauthenticated requests get a much lower rate limit");
  }
  // The CLI prints its own report, so the client's logger stays silent here.
  const client = createGitHubClient({ token: config.GITHUB_TOKEN });

  console.log("Query:", buildSearchQuery(filter));
  const result = await client.searchPage(filter, 1);

  console.log(`\nTotal matches: ${result.totalCount}  (this page: ${result.issues.length})`);
  for (const issue of result.issues.slice(0, 5)) {
    console.log(` - [${issue.repo}] ${issue.title}\n   ${issue.url}  (${issue.createdAt})`);
  }

  const rl = result.rateLimit;
  console.log("\nRate limit:");
  if (!rl) {
    console.log("  (no rate-limit headers on this response)");
  } else {
    const secondsLeft = Math.max(0, Math.round((rl.resetAt.getTime() - Date.now()) / 1000));
    console.log(`  resource:  ${rl.resource}`);
    console.log(`  limit:     ${rl.limit}`);
    console.log(`  remaining: ${rl.remaining}`);
    console.log(`  resets at: ${rl.resetAt.toISOString()} (in ${secondsLeft}s)`);
  }
}

main().catch((err) => {
  logger.error("search failed", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exitCode = 1;
});
