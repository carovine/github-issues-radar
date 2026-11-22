import { describe, it, expect } from "vitest";
import { buildSearchQuery, buildSearchUrl } from "../src/github/query.js";

const base = { language: "typescript", label: "good first issue", createdAfter: new Date("2026-11-19T00:00:00Z") };

describe("buildSearchQuery", () => {
  it("builds the exact query we expect", () => {
    expect(buildSearchQuery(base)).toBe(
      'is:issue is:open no:assignee label:"good first issue" language:typescript created:>2026-11-19T00:00:00Z',
    );
  });

  it("drops milliseconds from the timestamp", () => {
    const q = buildSearchQuery({ ...base, createdAfter: new Date("2026-11-19T08:30:15.123Z") });
    expect(q).toContain("created:>2026-11-19T08:30:15Z");
  });

  it("rejects a label containing a double quote (query injection)", () => {
    expect(() => buildSearchQuery({ ...base, label: 'bug" is:closed' })).toThrow();
  });

  it("rejects a language containing whitespace", () => {
    expect(() => buildSearchQuery({ ...base, language: "python label:x" })).toThrow();
  });

  it("rejects an invalid date", () => {
    expect(() => buildSearchQuery({ ...base, createdAfter: new Date("nope") })).toThrow();
  });
});

describe("buildSearchUrl", () => {
  it("asks for newest first, 100 per page, and the requested page", () => {
    const url = new URL(buildSearchUrl("is:issue", 2));
    expect(url.searchParams.get("sort")).toBe("created");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("percent-encodes + and # so c++ and c# survive", () => {
    const url = buildSearchUrl(buildSearchQuery({ ...base, language: "c++" }));
    expect(url).toContain("c%2B%2B");
    expect(buildSearchUrl(buildSearchQuery({ ...base, language: "c#" }))).toContain("c%23");
  });

  it("round-trips the query unchanged", () => {
    const q = buildSearchQuery(base);
    expect(new URL(buildSearchUrl(q)).searchParams.get("q")).toBe(q);
  });
});
