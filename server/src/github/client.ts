import { buildSearchQuery, buildSearchUrl, PER_PAGE, type SearchFilter } from "./query.js";

// ---------- Types ----------

export interface RateLimit {
  limit: number; //     requests allowed per window (30/min for search when authenticated)
  remaining: number; // requests left in the current window
  resetAt: Date; //     when the window resets
  resource: string; //  which bucket this counts against, e.g. "search"
}

// Our own clean shape, so the rest of the app never touches GitHub's raw JSON.
export interface GitHubIssue {
  githubId: number;
  repo: string; // "owner/name"
  title: string;
  url: string;
  labels: string[]; // lowercased
  createdAt: string; // ISO timestamp
}

export interface SearchPageResult {
  issues: GitHubIssue[];
  rawCount: number; // items GitHub returned on this page (before filtering out PRs)
  totalCount: number;
  rateLimit: RateLimit | null;
}

export interface SearchAllResult {
  issues: GitHubIssue[];
  totalCount: number;
  truncated: boolean; // true if there were more results than we were willing to fetch
  rateLimit: RateLimit | null;
}

export class GitHubError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "GitHubError";
  }
}

// Thrown when we must stop because waiting would take too long.
// The poller catches this to stop gracefully (keep what it has, finish cleanly).
export class RateLimitError extends Error {
  constructor(message: string, public readonly resetAt: Date) {
    super(message);
    this.name = "RateLimitError";
  }
}

// ---------- Rate-limit helpers ----------

// GitHub sends these headers on every response:
//   x-ratelimit-limit / -remaining / -reset (reset is epoch SECONDS) / -resource
export function parseRateLimit(headers: Headers): RateLimit | null {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (limit === null || remaining === null || reset === null) return null;
  return {
    limit: Number(limit),
    remaining: Number(remaining),
    resetAt: new Date(Number(reset) * 1000),
    resource: headers.get("x-ratelimit-resource") ?? "unknown",
  };
}

// ---------- Client ----------

type Log = { info(m: string, meta?: unknown): void; warn(m: string, meta?: unknown): void };
const silent: Log = { info() {}, warn() {} };

export interface ClientOptions {
  token?: string;
  maxWaitMs?: number; // longest we are willing to sleep for a rate limit (default 90s)
  // The four below exist so tests can replace the network, sleeping and clock:
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  logger?: Log;
}

const MAX_RETRIES = 2;
const BUFFER_MS = 1000; // wake up slightly AFTER the reset, never right on it

interface RawIssue {
  id: number;
  title: string;
  html_url: string;
  repository_url: string; // "https://api.github.com/repos/owner/name"
  created_at: string;
  labels: { name?: string }[];
  pull_request?: unknown; // present only on pull requests
}

function normalize(raw: RawIssue): GitHubIssue {
  return {
    githubId: raw.id,
    repo: raw.repository_url.replace("https://api.github.com/repos/", ""),
    title: raw.title,
    url: raw.html_url,
    labels: raw.labels.map((l) => (l.name ?? "").toLowerCase()).filter(Boolean),
    createdAt: raw.created_at,
  };
}

export function createGitHubClient(options: ClientOptions = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const sleep = options.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.nowFn ?? Date.now;
  const maxWaitMs = options.maxWaitMs ?? 90_000;
  const log = options.logger ?? silent;

  // What the last response told us about our remaining quota.
  let lastRateLimit: RateLimit | null = null;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "github-issues-radar", // GitHub rejects requests without a User-Agent
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`; // never logged

  const msUntil = (date: Date) => Math.max(0, date.getTime() - now()) + BUFFER_MS;

  // Sleep, or give up if the wait is longer than we allow.
  async function waitFor(ms: number, reason: string): Promise<void> {
    if (ms > maxWaitMs) {
      throw new RateLimitError(
        `Rate limited (${reason}); would need to wait ${Math.ceil(ms / 1000)}s, more than the allowed ${maxWaitMs / 1000}s`,
        new Date(now() + ms),
      );
    }
    log.warn(`rate limit: sleeping ${Math.ceil(ms / 1000)}s (${reason})`);
    await sleep(ms);
    lastRateLimit = null; // a new window has started; forget the old numbers
  }

  // Two kinds of "slow down":
  //  - primary limit: quota is used up (remaining = 0)
  //  - secondary limit: GitHub says we're too fast; it answers 403/429, often with retry-after
  function isRateLimited(res: Response, rl: RateLimit | null): boolean {
    if (res.status === 429) return true;
    return res.status === 403 && (rl?.remaining === 0 || res.headers.has("retry-after"));
  }

  function retryDelayMs(res: Response, rl: RateLimit | null): number {
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter !== null) return Number(retryAfter) * 1000 + BUFFER_MS;
    if (rl && rl.remaining === 0) return msUntil(rl.resetAt);
    return 60_000; // GitHub's guidance when it gives no hint: wait about a minute
  }

  async function errorDetail(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string };
      return body.message ?? "";
    } catch {
      return "";
    }
  }

  async function request(url: string): Promise<{ body: unknown; rateLimit: RateLimit | null }> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Proactive: if the last response said we have nothing left, don't even try.
      if (lastRateLimit && lastRateLimit.remaining <= 0) {
        await waitFor(msUntil(lastRateLimit.resetAt), "quota exhausted");
      }

      const res = await fetchFn(url, { headers });
      const rateLimit = parseRateLimit(res.headers);
      if (rateLimit) {
        lastRateLimit = rateLimit;
        log.info(
          `GitHub ${res.status}: ${rateLimit.remaining}/${rateLimit.limit} ${rateLimit.resource} requests left, resets ${rateLimit.resetAt.toISOString()}`,
        );
      }

      if (res.ok) return { body: await res.json(), rateLimit };

      if (isRateLimited(res, rateLimit)) {
        await waitFor(retryDelayMs(res, rateLimit), `HTTP ${res.status}`);
        continue; // try again
      }
      const detail = await errorDetail(res);
      throw new GitHubError(`GitHub API error ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
    }
    throw new RateLimitError("Still rate limited after retries", new Date(now() + 60_000));
  }

  // One page of results.
  async function searchPage(filter: SearchFilter, page = 1): Promise<SearchPageResult> {
    const { body, rateLimit } = await request(buildSearchUrl(buildSearchQuery(filter), page));
    const data = body as { total_count: number; items: RawIssue[] };
    return {
      issues: data.items.filter((i) => !i.pull_request).map(normalize),
      rawCount: data.items.length,
      totalCount: data.total_count,
      rateLimit,
    };
  }

  // Several pages, newest first, stopping at the last page or at maxPages.
  async function searchIssues(filter: SearchFilter, maxPages = 3): Promise<SearchAllResult> {
    const issues: GitHubIssue[] = [];
    let totalCount = 0;
    let rateLimit: RateLimit | null = null;
    let truncated = false;

    for (let page = 1; page <= maxPages; page++) {
      const result = await searchPage(filter, page);
      issues.push(...result.issues);
      totalCount = result.totalCount;
      rateLimit = result.rateLimit ?? rateLimit;
      if (result.rawCount < PER_PAGE) break; // a short page means this was the last one
      if (page === maxPages && totalCount > maxPages * PER_PAGE) {
        truncated = true;
        log.warn(`page cap reached: fetched ${issues.length} of ${totalCount} for ${filter.language}/${filter.label}`);
      }
    }
    return { issues, totalCount, truncated, rateLimit };
  }

  return { searchPage, searchIssues };
}
