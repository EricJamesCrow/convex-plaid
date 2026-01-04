/**
 * Circuit Breaker Module Tests
 *
 * Tests for the circuit breaker pattern implementation.
 * These tests use mocked Convex context to verify state machine logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionCtx } from "./_generated/server.js";
import {
  getCircuitStatus,
  recordSuccess,
  recordFailure,
  resetCircuit,
  shouldBlockRequest,
  CIRCUIT_CONFIG,
  type CircuitState,
} from "./circuitBreaker.js";

// Helper to create mock ActionCtx
function createMockCtx(itemData: Record<string, unknown> | null = null) {
  const runQuery = vi.fn().mockResolvedValue(itemData);
  const runMutation = vi.fn().mockResolvedValue(undefined);

  return {
    ctx: { runQuery, runMutation } as unknown as ActionCtx,
    runQuery,
    runMutation,
  };
}

describe("Circuit Breaker Module", () => {
  describe("CIRCUIT_CONFIG", () => {
    it("should have correct default values", () => {
      expect(CIRCUIT_CONFIG.failureThreshold).toBe(5);
      expect(CIRCUIT_CONFIG.successThreshold).toBe(2);
      expect(CIRCUIT_CONFIG.openDurationMs).toBe(300000); // 5 minutes
    });
  });

  describe("getCircuitStatus", () => {
    describe("item not found", () => {
      it("should return closed state when item is not found", async () => {
        const { ctx } = createMockCtx(null);

        const status = await getCircuitStatus(ctx, "non-existent-item");

        expect(status.state).toBe("closed");
        expect(status.canAttempt).toBe(true);
        expect(status.consecutiveFailures).toBe(0);
        expect(status.consecutiveSuccesses).toBe(0);
      });
    });

    describe("closed state", () => {
      it("should return closed state when circuitState is closed", async () => {
        const { ctx } = createMockCtx({
          circuitState: "closed",
          consecutiveFailures: 2,
          consecutiveSuccesses: 0,
        });

        const status = await getCircuitStatus(ctx, "item-123");

        expect(status.state).toBe("closed");
        expect(status.canAttempt).toBe(true);
        expect(status.consecutiveFailures).toBe(2);
      });

      it("should default to closed when circuitState is undefined", async () => {
        const { ctx } = createMockCtx({});

        const status = await getCircuitStatus(ctx, "item-123");

        expect(status.state).toBe("closed");
        expect(status.canAttempt).toBe(true);
      });

      it("should default counters to 0 when undefined", async () => {
        const { ctx } = createMockCtx({
          circuitState: "closed",
        });

        const status = await getCircuitStatus(ctx, "item-123");

        expect(status.consecutiveFailures).toBe(0);
        expect(status.consecutiveSuccesses).toBe(0);
      });
    });

    describe("open state", () => {
      it("should block requests when circuit is open and timeout not expired", async () => {
        const futureTime = Date.now() + 60000; // 1 minute in future
        const { ctx } = createMockCtx({
          circuitState: "open",
          consecutiveFailures: 5,
          consecutiveSuccesses: 0,
          nextRetryAt: futureTime,
        });

        const status = await getCircuitStatus(ctx, "item-123");

        expect(status.state).toBe("open");
        expect(status.canAttempt).toBe(false);
        expect(status.nextAttemptAt).toBe(futureTime);
        expect(status.retryAfterMs).toBeGreaterThan(0);
        expect(status.retryAfterMs).toBeLessThanOrEqual(60000);
      });

      it("should transition to half-open when timeout expired", async () => {
        const pastTime = Date.now() - 1000; // 1 second ago
        const { ctx } = createMockCtx({
          circuitState: "open",
          consecutiveFailures: 5,
          consecutiveSuccesses: 0,
          nextRetryAt: pastTime,
        });

        const status = await getCircuitStatus(ctx, "item-123");

        expect(status.state).toBe("half_open");
        expect(status.canAttempt).toBe(true);
        expect(status.consecutiveFailures).toBe(5);
      });

      it("should use openDurationMs when nextRetryAt is undefined", async () => {
        const { ctx } = createMockCtx({
          circuitState: "open",
          consecutiveFailures: 5,
        });

        const status = await getCircuitStatus(ctx, "item-123");

        expect(status.state).toBe("open");
        expect(status.canAttempt).toBe(false);
        expect(status.retryAfterMs).toBe(CIRCUIT_CONFIG.openDurationMs);
      });
    });

    describe("half_open state", () => {
      it("should allow requests in half_open state", async () => {
        const { ctx } = createMockCtx({
          circuitState: "half_open",
          consecutiveFailures: 5,
          consecutiveSuccesses: 1,
        });

        const status = await getCircuitStatus(ctx, "item-123");

        expect(status.state).toBe("half_open");
        expect(status.canAttempt).toBe(true);
        expect(status.consecutiveSuccesses).toBe(1);
      });
    });
  });

  describe("recordSuccess", () => {
    it("should do nothing when item is not found", async () => {
      const { ctx, runMutation } = createMockCtx(null);

      await recordSuccess(ctx, "non-existent-item");

      expect(runMutation).not.toHaveBeenCalled();
    });

    it("should close circuit when success threshold reached in half_open", async () => {
      const { ctx, runMutation } = createMockCtx({
        circuitState: "half_open",
        consecutiveSuccesses: 1, // Will become 2, meeting threshold
        consecutiveFailures: 5,
      });

      await recordSuccess(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          plaidItemId: "item-123",
          circuitState: "closed",
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        })
      );
    });

    it("should increment success counter in half_open when below threshold", async () => {
      const { ctx, runMutation } = createMockCtx({
        circuitState: "half_open",
        consecutiveSuccesses: 0, // Will become 1, still below threshold of 2
        consecutiveFailures: 5,
      });

      await recordSuccess(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          plaidItemId: "item-123",
          consecutiveSuccesses: 1,
          consecutiveFailures: 0,
        })
      );
      // Should NOT set circuitState to closed yet
      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({
          circuitState: "closed",
        })
      );
    });

    it("should reset failure counter in closed state", async () => {
      const { ctx, runMutation } = createMockCtx({
        circuitState: "closed",
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
      });

      await recordSuccess(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          plaidItemId: "item-123",
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        })
      );
    });
  });

  describe("recordFailure", () => {
    it("should do nothing when item is not found", async () => {
      const { ctx, runMutation } = createMockCtx(null);

      await recordFailure(ctx, "non-existent-item");

      expect(runMutation).not.toHaveBeenCalled();
    });

    it("should reopen circuit immediately on failure in half_open state", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const { ctx, runMutation } = createMockCtx({
        circuitState: "half_open",
        consecutiveFailures: 5,
        consecutiveSuccesses: 1,
      });

      await recordFailure(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          plaidItemId: "item-123",
          circuitState: "open",
          consecutiveFailures: 6,
          consecutiveSuccesses: 0,
          lastFailureAt: now,
          nextRetryAt: now + CIRCUIT_CONFIG.openDurationMs,
        })
      );

      vi.useRealTimers();
    });

    it("should open circuit when failure threshold reached", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const { ctx, runMutation } = createMockCtx({
        circuitState: "closed",
        consecutiveFailures: 4, // Will become 5, meeting threshold
        consecutiveSuccesses: 0,
      });

      await recordFailure(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          plaidItemId: "item-123",
          circuitState: "open",
          consecutiveFailures: 5,
          lastFailureAt: now,
          nextRetryAt: now + CIRCUIT_CONFIG.openDurationMs,
        })
      );

      vi.useRealTimers();
    });

    it("should increment failure counter when below threshold", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const { ctx, runMutation } = createMockCtx({
        circuitState: "closed",
        consecutiveFailures: 2, // Will become 3, still below threshold of 5
        consecutiveSuccesses: 0,
      });

      await recordFailure(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          plaidItemId: "item-123",
          consecutiveFailures: 3,
          consecutiveSuccesses: 0,
          lastFailureAt: now,
        })
      );
      // Should NOT set circuitState to open yet
      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({
          circuitState: "open",
        })
      );

      vi.useRealTimers();
    });
  });

  describe("resetCircuit", () => {
    it("should call resetCircuitBreaker mutation", async () => {
      const { ctx, runMutation } = createMockCtx(null);

      await resetCircuit(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        { plaidItemId: "item-123" }
      );
    });
  });

  describe("shouldBlockRequest", () => {
    it("should return false when circuit is closed", async () => {
      const { ctx } = createMockCtx({
        circuitState: "closed",
        consecutiveFailures: 0,
      });

      const blocked = await shouldBlockRequest(ctx, "item-123");

      expect(blocked).toBe(false);
    });

    it("should return true when circuit is open", async () => {
      const futureTime = Date.now() + 60000;
      const { ctx } = createMockCtx({
        circuitState: "open",
        consecutiveFailures: 5,
        nextRetryAt: futureTime,
      });

      const blocked = await shouldBlockRequest(ctx, "item-123");

      expect(blocked).toBe(true);
    });

    it("should return false when circuit is half_open", async () => {
      const { ctx } = createMockCtx({
        circuitState: "half_open",
        consecutiveFailures: 5,
      });

      const blocked = await shouldBlockRequest(ctx, "item-123");

      expect(blocked).toBe(false);
    });
  });

  describe("state machine transitions", () => {
    it("CLOSED -> OPEN: after 5 consecutive failures", async () => {
      // Simulate 5 failures
      for (let i = 0; i < 5; i++) {
        const { ctx, runMutation } = createMockCtx({
          circuitState: "closed",
          consecutiveFailures: i,
        });

        await recordFailure(ctx, "item-123");

        if (i === 4) {
          // 5th failure (0-indexed: 4)
          expect(runMutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
              circuitState: "open",
              consecutiveFailures: 5,
            })
          );
        }
      }
    });

    it("OPEN -> HALF_OPEN: when timeout expires", async () => {
      const pastTime = Date.now() - 1;
      const { ctx } = createMockCtx({
        circuitState: "open",
        consecutiveFailures: 5,
        nextRetryAt: pastTime,
      });

      const status = await getCircuitStatus(ctx, "item-123");

      expect(status.state).toBe("half_open");
      expect(status.canAttempt).toBe(true);
    });

    it("HALF_OPEN -> CLOSED: after 2 consecutive successes", async () => {
      const { ctx, runMutation } = createMockCtx({
        circuitState: "half_open",
        consecutiveFailures: 5,
        consecutiveSuccesses: 1, // This will become 2
      });

      await recordSuccess(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          circuitState: "closed",
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        })
      );
    });

    it("HALF_OPEN -> OPEN: on any failure", async () => {
      const { ctx, runMutation } = createMockCtx({
        circuitState: "half_open",
        consecutiveFailures: 5,
        consecutiveSuccesses: 1,
      });

      await recordFailure(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          circuitState: "open",
        })
      );
    });
  });

  describe("edge cases", () => {
    it("should handle undefined counters gracefully", async () => {
      const { ctx } = createMockCtx({
        // No counters defined
        circuitState: "closed",
      });

      const status = await getCircuitStatus(ctx, "item-123");

      expect(status.consecutiveFailures).toBe(0);
      expect(status.consecutiveSuccesses).toBe(0);
    });

    it("should handle circuit open with no nextRetryAt", async () => {
      const { ctx } = createMockCtx({
        circuitState: "open",
        consecutiveFailures: 5,
        // nextRetryAt not set
      });

      const status = await getCircuitStatus(ctx, "item-123");

      expect(status.canAttempt).toBe(false);
      expect(status.retryAfterMs).toBe(CIRCUIT_CONFIG.openDurationMs);
    });

    it("should preserve failure count when incrementing", async () => {
      const { ctx, runMutation } = createMockCtx({
        circuitState: "closed",
        consecutiveFailures: 3,
      });

      await recordFailure(ctx, "item-123");

      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          consecutiveFailures: 4,
        })
      );
    });
  });
});
