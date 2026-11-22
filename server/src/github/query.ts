// Pure functions that turn a "filter" into a GitHub search query / URL.
// Pure = no network, no clock, no randomness, so they are trivial to unit test.

export interface SearchFilter {
  language: string; // e.g. "typescript" (validated against the whitelist elsewhere)
  label: string; // e.g. "good first issue"
  createdAfter: Date; // only issues created strictly after this moment
}

// GitHub's search API returns at most 100 results per page.
export const PER_PAGE = 100;

// GitHub wants timestamps like 2026-11-19T08:30:15Z (no milliseconds).
function toGitHubTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function buildSearchQuery(filter: SearchFilter): string {
  // Defense in depth: our API only allows whitelisted values, but this function
  // must never be able to produce a broken or injected query on its own.
  if (filter.label.includes('"')) throw new Error("label must not contain double quotes");
  if (/[\s"]/.test(filter.language)) throw new Error("language must not contain spaces or quotes");
  if (Number.isNaN(filter.createdAfter.getTime())) throw new Error("createdAfter is not a valid date");

  return [
    "is:issue", //          issues only, not pull requests
    "is:open", //           still open
    "no:assignee", //       nobody has claimed it yet
    `label:"${filter.label}"`, // quoted because labels can contain spaces
    `language:${filter.language}`, // language of the REPOSITORY
    `created:>${toGitHubTimestamp(filter.createdAfter)}`, // incremental: only what is new
  ].join(" ");
}

export function buildSearchUrl(query: string, page = 1): string {
  // URLSearchParams percent-encodes for us (so "c++" becomes c%2B%2B, "c#" becomes c%23).
  const params = new URLSearchParams({
    q: query,
    sort: "created",
    order: "desc", // newest first: if we hit our page cap we lose the OLDEST, not the newest
    per_page: String(PER_PAGE),
    page: String(page),
  });
  return `https://api.github.com/search/issues?${params.toString()}`;
}
