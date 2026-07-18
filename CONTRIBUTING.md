# Contributing

Choose an acceptance criterion from the active sprint in `PLAN.md`. For architectural changes, write or amend an ADR before implementation.

Use conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Keep changes focused, add tests, and run:

```bash
pnpm format:check
pnpm check
pnpm test
pnpm build
```

Security problems, especially unsafe archive handling, identifier exposure, or a way to turn scores into automatic enforcement, should not be filed with real player data. Provide a minimal synthetic reproduction privately to the maintainers once a security channel exists.
