# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
