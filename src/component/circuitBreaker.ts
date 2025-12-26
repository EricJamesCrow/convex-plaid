/**
 * Circuit Breaker for Plaid API Calls
 *
 * Implements the circuit breaker pattern to prevent cascading failures.
 * After consecutive failures, the circuit "opens" and blocks further attempts,
 * giving the upstream service time to recover.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Requests blocked, waiting for recovery timeout
 * - HALF_OPEN: Testing if service recovered, allowing limited requests
 *
 * State transitions:
 * - CLOSED → OPEN: After `failureThreshold` consecutive failures
 * - OPEN → HALF_OPEN: After `openDurationMs` timeout expires
 * - HALF_OPEN → CLOSED: After `successThreshold` consecutive successes
 * - HALF_OPEN → OPEN: On any failure
 *
 * @see https://martinfowler.com/bliki/CircuitBreaker.html
 */

import type { ActionCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Circuit breaker configuration
 */
export const CIRCUIT_CONFIG = {
  /** Number of consecutive failures before circuit opens */
  failureThreshold: 5,

  /** Number of consecutive successes in half-open state before circuit closes */
  successThreshold: 2,

  /** Duration circuit stays open before transitioning to half-open (5 minutes) */
  openDurationMs: 300000,
} as const;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Circuit breaker state
 */
export type CircuitState = "closed" | "open" | "half_open";

/**
 * Result of circuit status check
 */
export interface CircuitStatus {
  /** Current circuit state */
  state: CircuitState;

  /** Whether a request can be attempted */
  canAttempt: boolean;

  /** Unix timestamp when circuit will transition to half-open (if open) */
  nextAttemptAt?: number;

  /** Time in ms until next attempt allowed (if blocked) */
  retryAfterMs?: number;

  /** Current count of consecutive failures */
  consecutiveFailures: number;

  /** Current count of consecutive successes (relevant in half-open) */
  consecutiveSuccesses: number;
}

// =============================================================================
// CIRCUIT STATE CHECKING
// =============================================================================

/**
 * Get the current circuit breaker status for a plaidItem.
 *
 * This function checks the stored circuit state and handles
 * automatic transitions from OPEN to HALF_OPEN when timeout expires.
 *
 * @param ctx - Convex action context
 * @param plaidItemId - Convex plaidItem _id as string
 * @returns Circuit status including whether requests are allowed
 */
export async function getCircuitStatus(
  ctx: ActionCtx,
  plaidItemId: string
): Promise<CircuitStatus> {
  const item = await ctx.runQuery(internal.private.getPlaidItemWithCircuit, {
    plaidItemId,
  });

  if (!item) {
    // Item not found - treat as closed (will fail on actual API call)
    return {
      state: "closed",
      canAttempt: true,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };
  }

  const state = (item.circuitState ?? "closed") as CircuitState;
  const consecutiveFailures = item.consecutiveFailures ?? 0;
  const consecutiveSuccesses = item.consecutiveSuccesses ?? 0;
  const nextRetryAt = item.nextRetryAt;
  const now = Date.now();

  // Check if open circuit should transition to half-open
  if (state === "open") {
    if (nextRetryAt && now >= nextRetryAt) {
      // Timeout expired - allow a test request (transition to half-open happens on first request)
      return {
        state: "half_open",
        canAttempt: true,
        consecutiveFailures,
        consecutiveSuccesses,
      };
    }

    // Still within timeout - block requests
    return {
      state: "open",
      canAttempt: false,
      nextAttemptAt: nextRetryAt,
      retryAfterMs: nextRetryAt ? nextRetryAt - now : CIRCUIT_CONFIG.openDurationMs,
      consecutiveFailures,
      consecutiveSuccesses,
    };
  }

  // CLOSED or HALF_OPEN state - allow requests
  return {
    state,
    canAttempt: true,
    consecutiveFailures,
    consecutiveSuccesses,
  };
}

// =============================================================================
// SUCCESS/FAILURE RECORDING
// =============================================================================

/**
 * Record a successful operation.
 *
 * In HALF_OPEN state, this counts towards closing the circuit.
 * In CLOSED state, this resets the failure counter.
 *
 * @param ctx - Convex action context
 * @param plaidItemId - Convex plaidItem _id as string
 */
export async function recordSuccess(
  ctx: ActionCtx,
  plaidItemId: string
): Promise<void> {
  const item = await ctx.runQuery(internal.private.getPlaidItemWithCircuit, {
    plaidItemId,
  });

  if (!item) {
    console.warn(`[Circuit Breaker] Item not found: ${plaidItemId}`);
    return;
  }

  const currentState = (item.circuitState ?? "closed") as CircuitState;
  const consecutiveSuccesses = (item.consecutiveSuccesses ?? 0) + 1;

  if (currentState === "half_open") {
    if (consecutiveSuccesses >= CIRCUIT_CONFIG.successThreshold) {
      // Enough successes - close the circuit
      console.log(
        `[Circuit Breaker] Item ${plaidItemId} circuit CLOSED after ${consecutiveSuccesses} successes`
      );

      await ctx.runMutation(internal.private.updateCircuitState, {
        plaidItemId,
        circuitState: "closed",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        nextRetryAt: undefined,
      });
    } else {
      // Not enough successes yet - increment counter
      await ctx.runMutation(internal.private.updateCircuitState, {
        plaidItemId,
        consecutiveSuccesses,
        consecutiveFailures: 0,
      });
    }
  } else {
    // In closed state - just reset failure counter
    await ctx.runMutation(internal.private.updateCircuitState, {
      plaidItemId,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    });
  }
}

/**
 * Record a failed operation.
 *
 * In HALF_OPEN state, this immediately reopens the circuit.
 * In CLOSED state, this increments the failure counter and may open the circuit.
 *
 * @param ctx - Convex action context
 * @param plaidItemId - Convex plaidItem _id as string
 */
export async function recordFailure(
  ctx: ActionCtx,
  plaidItemId: string
): Promise<void> {
  const item = await ctx.runQuery(internal.private.getPlaidItemWithCircuit, {
    plaidItemId,
  });

  if (!item) {
    console.warn(`[Circuit Breaker] Item not found: ${plaidItemId}`);
    return;
  }

  const currentState = (item.circuitState ?? "closed") as CircuitState;
  const consecutiveFailures = (item.consecutiveFailures ?? 0) + 1;
  const now = Date.now();

  if (currentState === "half_open") {
    // Any failure in half-open immediately reopens
    const nextRetryAt = now + CIRCUIT_CONFIG.openDurationMs;

    console.log(
      `[Circuit Breaker] Item ${plaidItemId} circuit REOPENED (half-open failure)`
    );

    await ctx.runMutation(internal.private.updateCircuitState, {
      plaidItemId,
      circuitState: "open",
      consecutiveFailures,
      consecutiveSuccesses: 0,
      lastFailureAt: now,
      nextRetryAt,
    });
  } else if (consecutiveFailures >= CIRCUIT_CONFIG.failureThreshold) {
    // Threshold reached - open the circuit
    const nextRetryAt = now + CIRCUIT_CONFIG.openDurationMs;

    console.log(
      `[Circuit Breaker] Item ${plaidItemId} circuit OPENED after ${consecutiveFailures} failures`
    );

    await ctx.runMutation(internal.private.updateCircuitState, {
      plaidItemId,
      circuitState: "open",
      consecutiveFailures,
      consecutiveSuccesses: 0,
      lastFailureAt: now,
      nextRetryAt,
    });
  } else {
    // Not yet at threshold - just increment counter
    await ctx.runMutation(internal.private.updateCircuitState, {
      plaidItemId,
      consecutiveFailures,
      consecutiveSuccesses: 0,
      lastFailureAt: now,
    });
  }
}

// =============================================================================
// MANUAL CONTROLS
// =============================================================================

/**
 * Manually reset the circuit breaker to closed state.
 *
 * Useful for administrative intervention or after fixing an underlying issue.
 *
 * @param ctx - Convex action context
 * @param plaidItemId - Convex plaidItem _id as string
 */
export async function resetCircuit(
  ctx: ActionCtx,
  plaidItemId: string
): Promise<void> {
  await ctx.runMutation(internal.private.resetCircuitBreaker, {
    plaidItemId,
  });

  console.log(`[Circuit Breaker] Item ${plaidItemId} circuit manually reset`);
}

/**
 * Check if circuit should block the current request.
 *
 * Convenience wrapper around getCircuitStatus that logs when blocked.
 *
 * @param ctx - Convex action context
 * @param plaidItemId - Convex plaidItem _id as string
 * @returns true if request should be blocked
 */
export async function shouldBlockRequest(
  ctx: ActionCtx,
  plaidItemId: string
): Promise<boolean> {
  const status = await getCircuitStatus(ctx, plaidItemId);

  if (!status.canAttempt) {
    console.log(
      `[Circuit Breaker] Request blocked for item ${plaidItemId} (state: ${status.state}, retry in ${status.retryAfterMs}ms)`
    );
    return true;
  }

  return false;
}
