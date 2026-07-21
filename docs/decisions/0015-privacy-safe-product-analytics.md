# ADR 0015: Privacy-safe product analytics

- Status: accepted
- Date: 2026-07-20

## Context

L4DStats needs one operational/product view of whether visitors reach useful
results, where demo processing fails or slows down, which result sections are
used, whether player lookup is useful, and whether the developer API is being
adopted. Raw demo metadata and player identity are sensitive and are not needed
to answer those questions.

## Decision

Send explicit, coarse PostHog events from three boundaries:

1. the web client records anonymous pageviews, upload/search intent, terminal
   client outcomes, locale, result-section navigation and outbound actions;
2. the edge/queue boundary records authoritative upload acceptance, processing
   end-to-end duration, per-attempt duration/outcome, structured parser stage
   and code, retryability, developer-console actions and normalized developer
   API routes; and
3. the developer portal records its anonymous account/key funnel and UI errors.

All browser events set `$process_person_profile: false` and use a random local
anonymous ID. Server events use one service-level distinct ID and are aggregate
operational observations, not people. The event boundary must never send demo
filenames, hashes, map names, Steam IDs, aliases, emails, job/upload/game IDs,
API keys, source URLs, raw API bodies or raw server errors. File sizes are bands;
API paths replace identifiers with `:id`; failures use a bounded category.
Browser exception text additionally redacts email addresses, API keys, UUIDs,
Steam IDs, URLs and 64-character hashes.

Maintain one pinned `L4DStats — Product & Reliability` dashboard with a rolling
30-day window. Its insights cover visitors, activation, format/size mix,
analysis latency and reliability, failure categories, player search, result
engagement, locale, discovery, developer activation/API usage, and exceptions.
`scripts/provision-posthog-dashboard.mjs` creates missing dashboard assets and
updates existing named insights idempotently using a scoped PostHog personal
API key. Delivery remains best-effort, but non-2xx responses and transport
errors are written to structured Worker logs instead of being silently hidden.

## Consequences

- Metrics answer product and reliability questions without creating a player or
  demo surveillance dataset.
- Client events express user intent; backend events remain the source of truth
  for upload and processing reliability.
- PostHog access requires a personal key scoped to the same project with
  `dashboard:read`, `dashboard:write`, `insight:read`, and `insight:write`.
- Changes to event properties or identity behavior require another privacy
  review and corresponding dashboard update.
