// The ONLY languages and labels the app supports. The API validates user input
// against these lists. Benefits:
//  1. The poller has a bounded amount of work: 12 x 10 = 120 combos at most,
//     which is about 4 minutes at GitHub's 30 search requests/minute.
//  2. Users can't inject arbitrary text into our GitHub search queries.
// Everything is stored lowercase so comparisons never depend on casing.

export const ALLOWED_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "java",
  "go",
  "rust",
  "c++",
  "c#",
  "ruby",
  "php",
  "kotlin",
  "swift",
] as const;

export const ALLOWED_LABELS = [
  "good first issue",
  "help wanted",
  "good-first-issue",
  "first-timers-only",
  "beginner-friendly",
  "easy",
  "documentation",
  "bug",
  "enhancement",
  "up-for-grabs",
] as const;

export type AllowedLanguage = (typeof ALLOWED_LANGUAGES)[number];
export type AllowedLabel = (typeof ALLOWED_LABELS)[number];
