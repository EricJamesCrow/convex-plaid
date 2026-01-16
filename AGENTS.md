# Repository Guidelines

## Project Structure & Module Organization

- `src/component/` contains the Convex component (schema, actions, public/private queries, webhooks) and most tests.
- `src/client/` exposes the Plaid client wrapper used by host apps; `src/react/` holds React hooks.
- `src/component/_generated/` is Convex codegen output; treat as generated.
- `example/` is a demo Convex app for local validation.
- `docs/` contains guides, plans, and migration notes.
- `dist/` is build output from `tsc`; avoid manual edits.

## Build, Test, and Development Commands

- `npm run dev` runs concurrent local dev (build + Convex).
- `npm run dev:backend` starts Convex dev with component typechecking.
- `npm run dev:build` watches `src/**/*.ts` and regenerates component code.
- `npm run build` compiles to `dist/` via `tsc`.
- `npm run typecheck` runs `tsc --noEmit` for static checks.
- `npm run lint` runs ESLint across the repo.
- `npm test` runs Vitest with typechecking.
- `npm test -- src/component/integration.test.ts` runs a single test file.
- `npm run test:coverage` generates coverage output in `coverage/`.

## Coding Style & Naming Conventions

- TypeScript, ESM modules, 2-space indentation, semicolons.
- Tests live next to code and use `*.test.ts` naming.
- Use `camelCase` for functions/variables, `PascalCase` for types/classes, and `UPPER_SNAKE_CASE` for constants.
- Keep public API signatures stable and documented in `src/client/` and `src/component/`.

## Testing Guidelines

- Framework: Vitest; integration tests use `convex-test`.
- Prefer deterministic tests that seed data via `t.run()` and avoid network access.
- Add coverage where behavior is security-sensitive (auth, access control, encryption).

## Commit & Pull Request Guidelines

- Commit messages follow conventional prefixes seen in history: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `research:`.
- PRs should include a short summary, tests run (e.g., `npm test`), and doc updates when APIs change.
- Link relevant issues and call out breaking changes or migration steps.

## Security & Configuration Tips

- Do not hardcode secrets; pass Plaid config via environment variables in the host app.
- Components cannot access `process.env`; pass config through client wrappers.
- Encryption keys must be base64-encoded 32-byte values.
