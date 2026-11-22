import { describe, it, expect, vi } from "vitest";
import { createGitHubClient, GitHubError, RateLimitError } from "../src/github/client.js";

// The GitHub API is fully mocked: no network, no real sleeping, a frozen clock.
const NOW_MS = 1_000_000_000_000;
const NOW_S = NOW_MS / 1000;
const filter = { language: "typescript", label: "bug", createdAfter: new Date("2026-11-19T00:00:00Z") };

const rateHeaders = (remaining: number, resetEpochSeconds: number) => ({
  "x-ratelimit-limit": "30",
  "x-ratelimit-remaining": String(remaining),
  "x-ratelimit-reset": String(resetEpochSeconds),
  "x-ratelimit-resource": "search",
});

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const rawIssue = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Issue ${id}`,
  html_url: `https://github.com/octo/repo/issues/${id}`,
  repository_url: "https://api.github.com/repos/octo/repo",
  created_at: "2026-11-20T10:00:00Z",
  labels: [{ name: "Bug" }, { name: "Good First Issue" }],
  ...extra,
});

const page = (ids: number[], total = ids.length) => ({ total_count: total, items: ids.map((id) => rawIssue(id)) });

function makeClient(fetchFn: typeof fetch, extra = {}) {
  const sleepFn = vi.fn(async () => {});
  const client = createGitHubClient({ fetchFn, sleepFn, nowFn: () => NOW_MS, ...extra });
  return { client, sleepFn };
}

describe("GitHub client", () => {
  it("normalizes issues, skips pull requests, and reads rate-limit headers", async () => {
    const body = { total_count: 2, items: [rawIssue(1), rawIssue(2, { pull_request: {} })] };
    const fetchFn = vi.fn(async () => respond(body, 200, rateHeaders(29, NOW_S + 60))) as unknown as typeof fetch;
    const { client } = makeClient(fetchFn);

    const result = await client.searchPage(filter);

    expect(result.issues).toEqual([
      {
        githubId: 1,
        repo: "octo/repo",
        title: "Issue 1",
        url: "https://github.com/octo/repo/issues/1",
        labels: ["bug", "good first issue"], // lowercased
        createdAt: "2026-11-20T10:00:00Z",
      },
    ]);
    expect(result.rateLimit).toMatchObject({ limit: 30, remaining: 29, resource: "search" });
  });

  it("keeps fetching pages until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => i + 1);
    const short = [101, 102, 103];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(respond(page(full, 103), 200, rateHeaders(29, NOW_S + 60)))
      .mockResolvedValueOnce(respond(page(short, 103), 200, rateHeaders(28, NOW_S + 60)));
    const { client } = makeClient(fetchFn as unknown as typeof fetch);

    const result = await client.searchIssues(filter, 3);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.issues).toHaveLength(103);
    expect(result.truncated).toBe(false);
  });

  it("stops at maxPages and reports truncation", async () => {
    const full = Array.from({ length: 100 }, (_, i) => i + 1);
    const fetchFn = vi.fn(async () => respond(page(full, 500), 200, rateHeaders(29, NOW_S + 60)));
    const { client } = makeClient(fetchFn as unknown as typeof fetch);

    const result = await client.searchIssues(filter, 1);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(true);
  });

  it("sleeps until the window resets when the quota is used up", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(respond(page([1]), 200, rateHeaders(0, NOW_S + 10)))
      .mockResolvedValueOnce(respond(page([2]), 200, rateHeaders(29, NOW_S + 70)));
    const { client, sleepFn } = makeClient(fetchFn as unknown as typeof fetch);

    await client.searchPage(filter); // uses the last request in the window
    await client.searchPage(filter); // must wait first

    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(11_000); // 10s until reset + 1s buffer
  });

  it("stops with RateLimitError instead of sleeping for too long", async () => {
    const fetchFn = vi.fn(async () => respond(page([1]), 200, rateHeaders(0, NOW_S + 600)));
    const { client, sleepFn } = makeClient(fetchFn as unknown as typeof fetch);

    await client.searchPage(filter);
    await expect(client.searchPage(filter)).rejects.toBeInstanceOf(RateLimitError);
    expect(sleepFn).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1); // it never sent the doomed second request
  });

  it("waits for retry-after on a secondary rate limit, then retries", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(respond({ message: "secondary rate limit" }, 403, { "retry-after": "5" }))
      .mockResolvedValueOnce(respond(page([1]), 200, rateHeaders(29, NOW_S + 60)));
    const { client, sleepFn } = makeClient(fetchFn as unknown as typeof fetch);

    const result = await client.searchPage(filter);

    expect(sleepFn).toHaveBeenCalledWith(6_000);
    expect(result.issues).toHaveLength(1);
  });

  it("throws GitHubError (with status) for other failures", async () => {
    const fetchFn = vi.fn(async () => respond({ message: "Validation Failed" }, 422));
    const { client } = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.searchPage(filter)).rejects.toMatchObject({
      name: "GitHubError",
      status: 422,
    });
    await expect(client.searchPage(filter)).rejects.toBeInstanceOf(GitHubError);
  });
});
