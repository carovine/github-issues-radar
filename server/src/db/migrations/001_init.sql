-- Initial schema for GitHub Issues Radar.

CREATE TABLE subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,        -- stored trimmed + lowercased
  languages          TEXT[] NOT NULL,
  labels             TEXT[] NOT NULL,
  verification_token TEXT NOT NULL UNIQUE,        -- random, used once by the confirm link
  unsubscribe_token  TEXT NOT NULL UNIQUE,        -- random, in every email's unsubscribe link
  verified_at        TIMESTAMPTZ,                 -- NULL = email not confirmed yet
  unsubscribed_at    TIMESTAMPTZ,                 -- NULL = not unsubscribed
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cardinality(languages) > 0),
  CHECK (cardinality(labels) > 0)
);
-- "active" subscription = verified_at IS NOT NULL AND unsubscribed_at IS NULL

-- One row per unique (language, label) pair we poll. It is only a bookmark
-- ("how far did we get for this combo?"), shared by every user who wants it.
CREATE TABLE filters (
  id           BIGSERIAL PRIMARY KEY,
  language     TEXT NOT NULL,
  label        TEXT NOT NULL,
  last_checked TIMESTAMPTZ,                       -- NULL = never polled
  UNIQUE (language, label)
);

CREATE TABLE issues (
  id         BIGSERIAL PRIMARY KEY,
  github_id  BIGINT NOT NULL UNIQUE,             -- GitHub's own id; our upsert key
  repo       TEXT NOT NULL,                      -- "owner/name"
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  language   TEXT NOT NULL,                      -- the filter language that found it
  labels     TEXT[] NOT NULL,                    -- all labels on the issue, lowercased
  created_at TIMESTAMPTZ NOT NULL                -- creation time on GitHub
);
CREATE INDEX issues_created_at_idx ON issues (created_at DESC);

-- A row here means "this subscriber was already emailed this issue".
-- The composite primary key makes sending the same issue twice impossible.
CREATE TABLE sent_notifications (
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  issue_id        BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, issue_id)
);
