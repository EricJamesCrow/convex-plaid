# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - Unreleased

Upstreams six months of development from the SmartPockets monorepo fork. All
changes are additive — no breaking API or schema changes.

### Added

#### Item Health API
- **`health.ts`** — item health derivation (`getItemHealth`, `getItemHealthByUser`
  public queries): maps item status + error state to a UI-ready health shape
- **`reasonCode.ts`** — error-code → `ReasonCode` taxonomy (`mapErrorCodeToReason`),
  exported for host-app error UX

#### Persistent Error Tracking
- `plaidItems.firstErrorAt` / `lastDispatchedAt` (optional fields) plus internal
  mutations (`markFirstErrorAtInternal`, `clearErrorTrackingInternal`,
  `markItemErrorDispatchedInternal`, `listErrorItemsInternal`) so host apps can
  run persistent-error notification crons without duplicate dispatches

#### New Accounts Available Flow
- `plaidItems.newAccountsAvailableAt` + set/clear internal mutations
- `createUpdateLinkToken({ mode: "reauth" | "account_select" })` optional mode
  for Plaid update-mode Link with new-account selection

#### Transaction Enrichment Backfill
- **`backfillTransactionEnrichments()`** client method + supporting action:
  re-enriches historical transactions (per-account-type request partitioning,
  counterparty selection)
- `plaidTransactions.originalDescription` (optional) — raw bank descriptor
  retained for enrichment

#### Test Coverage (5 → 17 files)
- **`webhooks.test.ts`** — full JWT verification pipeline: ES256 signature
  validity, body-hash binding, iat replay protection, algorithm pinning, key
  caching, and the key-rotation refetch path (previously untested)
- Sync idempotency, webhook dedupe, error tracking, health, reason codes,
  enrichment partitioning/counterparty selection, update-link mode, public
  query scale, new-accounts flow

### Changed
- Query-scale indexes added on `plaidRecurringStreams`, `webhookLogs`, `syncLogs`
- Institution metadata fetch deduplicated; logo caching improved
- Dependencies: `plaid` ^42, `convex` ^1.39 (dev), TypeScript 6, vitest 4;
  `react-plaid-link` peer range widened to `^3 || ^4`
- `tsconfig.json` now sets `"types": ["node"]` (TypeScript 6 compatibility)

### Removed
- Broken `lint` script (`eslint .` with no eslint installed — never worked)
- Stale `pnpm-lock.yaml` (npm is the package manager here)

## [0.7.1] – [0.7.3] - 2026-01-17 / 2026-02-02

Patch releases (backfilled entries):
- **0.7.1** — version bump with packaging fixes after 0.7.0
- **0.7.3** — renamed `test-auth.ts` → `testAuth.ts` for Convex module-name
  compatibility (hyphenated filenames are rejected by the Convex bundler)

## [0.7.0] - 2026-01-16

### Added

#### Security Helper Utilities
- **`requireAuth(ctx)`** - Helper function to extract and validate userId from `ctx.auth` in host app wrappers
- **`requireOwnership(ctx, userId, resourceUserId)`** - Helper function to verify resource ownership before operations
- New package export path `@crowdevelopment/convex-plaid/helpers` for security utilities
- TypeScript types:
  - `AuthContext` - Type for Convex authentication context
  - `ValidationResult` - Generic validation result type
  - `ResourceOwnershipCheck` - Type for ownership validation results

#### Documentation
- **Security Best Practices** section in CLAUDE.md covering:
  - Host app wrapper responsibilities
  - Auth validation patterns
  - Ownership verification examples
  - Common security pitfalls
- **`example/convex/secureWrappers.ts`** - Complete working examples of:
  - Secure query wrappers with auth
  - Secure mutation wrappers with ownership checks
  - Secure action wrappers with validation
  - Error handling patterns
- **`docs/security-anti-patterns.md`** - Comprehensive guide to:
  - Public exposure anti-patterns
  - Missing validation anti-patterns
  - Dangerous query patterns
  - How to fix each anti-pattern
- **`docs/auth-support-findings.md`** - Research findings documenting that `ctx.auth` is unavailable in Convex components

#### Testing
- Comprehensive test suite for security helpers (`src/client/helpers.test.ts`)
- Test coverage for authentication validation
- Test coverage for ownership verification
- Edge case testing for invalid inputs

### Changed
- Clarified in documentation that **security must be enforced in host app wrappers**, not in the component
- Updated all integration examples to demonstrate secure patterns with `requireAuth()` and `requireOwnership()`
- Enhanced CLAUDE.md with explicit security warnings and best practices

### Security
- **IMPORTANT**: Documented that the component's public queries/mutations cannot enforce authentication
- Provided helper utilities to simplify secure implementation in host apps
- Added comprehensive examples showing how to prevent unauthorized access
- Documented anti-patterns that lead to data leaks and how to avoid them

### Dependencies
- Upgraded `jose` to ^6.0.0 for JWE token encryption
- Upgraded `plaid` to ^41.0.0 for latest API support

### Notes
This release provides tools and documentation to help developers integrate
the Plaid component securely. Key finding: Convex components cannot access
`ctx.auth` directly, so authentication and authorization **must** be enforced
in the host app's wrapper functions using the provided helper utilities.

---

## [0.5.3] - 2026-01-15

### Added
- MIT LICENSE file
- TODO.md for tracking future improvements

### Changed
- Updated branding and simplified npm publishing documentation

### Fixed
- Prevent `_creationTime` from leaking in public query returns
- Prevent in-flight syncs from reactivating deleting items

### Performance
- Improved scalability for large datasets

---

## [0.5.2] - Previous Release

### Changed
- Upgraded `jose` to ^6.0.0
- Upgraded `plaid` to ^41.0.0

---

## [0.5.1] - Previous Release

### Added
- Convex component pattern analysis documentation

---

## [0.5.0] - Previous Release

### Added
- Initial stable release with core Plaid integration features
- Transaction syncing with cursor-based pagination
- Account management
- Liabilities tracking
- Recurring stream detection
- Webhook support with JWT verification
- React hooks for Plaid Link
