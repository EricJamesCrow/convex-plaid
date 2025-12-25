/**
 * Plaid Rate Limiter and Retry Logic
 *
 * Handles rate limiting, exponential backoff, and retry logic for Plaid API calls.
 * Plaid has rate limits that vary by endpoint and plan.
 *
 * Rate Limits (typical):
 * - Sandbox: Generous limits for testing
 * - Development: 100 requests/minute
 * - Production: Varies by plan (typically 1000+ requests/minute)
 *
 * Error Codes to Retry:
 * - RATE_LIMIT_EXCEEDED: Too many requests
 * - INTERNAL_SERVER_ERROR: Plaid temporary error
 * - ITEM_LOGIN_REQUIRED: Needs re-auth (different handling)
 *
 * @see https://plaid.com/docs/errors/rate-limit-exceeded/
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/** Base delay for exponential backoff (1 second) */
const BASE_DELAY_MS = 1000;

/** Maximum delay cap (5 minutes) */
const MAX_DELAY_MS = 5 * 60 * 1000;

/** Maximum number of retry attempts */
const MAX_RETRIES = 5;

/** Jitter range (adds randomness to prevent thundering herd) */
const JITTER_MS = 1000;

// =============================================================================
// BACKOFF CALCULATION
// =============================================================================

/**
 * Calculate exponential backoff delay with jitter.
 *
 * Formula: min(baseDelay * 2^retryCount + jitter, maxDelay)
 *
 * @param retryCount - Number of retries so far (0-based)
 * @returns Delay in milliseconds before next retry
 *
 * @example
 * calculateBackoffDelay(0) // ~1000-2000ms
 * calculateBackoffDelay(1) // ~2000-3000ms
 * calculateBackoffDelay(2) // ~4000-5000ms
 * calculateBackoffDelay(3) // ~8000-9000ms
 * calculateBackoffDelay(4) // ~16000-17000ms
 */
export function calculateBackoffDelay(retryCount: number): number {
  // Exponential: 1s, 2s, 4s, 8s, 16s, ...
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, retryCount);

  // Add jitter (random 0-1000ms)
  const jitter = Math.random() * JITTER_MS;

  // Cap at maximum delay
  return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
}

/**
 * Calculate delay for rate limit response.
 *
 * Plaid sometimes includes a Retry-After header with rate limit errors.
 * If provided, use that; otherwise use exponential backoff.
 *
 * @param retryAfterSeconds - Value from Retry-After header (if any)
 * @param retryCount - Number of retries so far
 * @returns Delay in milliseconds
 */
export function calculateRateLimitDelay(
  retryAfterSeconds: number | undefined,
  retryCount: number
): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    // Use Retry-After header value + small jitter
    return retryAfterSeconds * 1000 + Math.random() * 500;
  }

  // Fall back to exponential backoff
  return calculateBackoffDelay(retryCount);
}

// =============================================================================
// ERROR CLASSIFICATION
// =============================================================================

/**
 * Check if an error is a rate limit error.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as any).response;
    if (response?.data?.error_code === "RATE_LIMIT_EXCEEDED") {
      return true;
    }
    if (response?.status === 429) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an error is retriable.
 *
 * Some errors are temporary and should be retried:
 * - Rate limit exceeded
 * - Internal server errors
 * - Network timeouts
 *
 * Some errors should NOT be retried:
 * - Invalid credentials
 * - Invalid request
 * - Item login required (needs user action)
 */
export function isRetriableError(error: unknown): boolean {
  if (isRateLimitError(error)) {
    return true;
  }

  if (error && typeof error === "object" && "response" in error) {
    const response = (error as any).response;
    const errorCode = response?.data?.error_code;

    // Retriable Plaid error codes
    const retriableCodes = [
      "INTERNAL_SERVER_ERROR",
      "PLANNED_MAINTENANCE",
      "INSTITUTION_DOWN",
      "INSTITUTION_NOT_RESPONDING",
    ];

    if (retriableCodes.includes(errorCode)) {
      return true;
    }

    // Retry on 5xx status codes
    if (response?.status >= 500 && response?.status < 600) {
      return true;
    }
  }

  // Network errors
  if (error instanceof Error) {
    const networkErrorMessages = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "network error",
      "timeout",
    ];

    if (networkErrorMessages.some((msg) =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    )) {
      return true;
    }
  }

  return false;
}

/**
 * Extract Retry-After header value from error response.
 */
export function getRetryAfterSeconds(error: unknown): number | undefined {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as any).response;
    const retryAfter = response?.headers?.["retry-after"];

    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) {
        return seconds;
      }
    }
  }

  return undefined;
}

// =============================================================================
// RETRY WRAPPER
// =============================================================================

/**
 * Retry configuration options.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 300000) */
  maxDelayMs?: number;
  /** Callback for logging retry attempts */
  onRetry?: (retryCount: number, error: unknown, delayMs: number) => void;
}

/**
 * Execute a function with automatic retry on retriable errors.
 *
 * Uses exponential backoff with jitter for delays between retries.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of the function
 * @throws Last error if all retries fail
 *
 * @example
 * const result = await withRetry(
 *   () => plaidClient.transactionsSync({ access_token }),
 *   {
 *     maxRetries: 3,
 *     onRetry: (count, error, delay) => {
 *       console.log(`Retry ${count} after ${delay}ms: ${error}`);
 *     },
 *   }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const onRetry = options.onRetry;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries || !isRetriableError(error)) {
        throw error;
      }

      // Calculate delay
      const retryAfter = getRetryAfterSeconds(error);
      const delayMs = isRateLimitError(error)
        ? calculateRateLimitDelay(retryAfter, attempt)
        : calculateBackoffDelay(attempt);

      // Log retry
      if (onRetry) {
        onRetry(attempt + 1, error, delayMs);
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// CIRCUIT BREAKER (Optional)
// =============================================================================

/**
 * Circuit breaker state.
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker for preventing cascading failures.
 *
 * States:
 * - CLOSED: Normal operation, requests go through
 * - OPEN: Circuit tripped, requests fail fast
 * - HALF-OPEN: Testing if service recovered
 *
 * Transitions:
 * - CLOSED -> OPEN: After failureThreshold consecutive failures
 * - OPEN -> HALF-OPEN: After resetTimeoutMs
 * - HALF-OPEN -> CLOSED: On success
 * - HALF-OPEN -> OPEN: On failure
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: {
    failureThreshold?: number;
    resetTimeoutMs?: number;
  } = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60000; // 1 minute
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    if (this.state === "open") {
      // Check if we should transition to half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "half-open";
      }
    }
    return this.state;
  }

  /**
   * Check if circuit allows request.
   */
  canExecute(): boolean {
    const state = this.getState();
    return state === "closed" || state === "half-open";
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = "closed";
  }

  /**
   * Record a failed request.
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
    }
  }

  /**
   * Execute a function with circuit breaker protection.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error("Circuit breaker is open");
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}
