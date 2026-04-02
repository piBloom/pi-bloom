/**
 * Exponential backoff retry utility with jitter.
 * Replaces the circuit-breaker pattern in rate-limiter.ts and lifecycle.ts.
 */

export interface RetryOptions {
	maxRetries?: number; // default: 5
	baseDelayMs?: number; // default: 1000
	maxDelayMs?: number; // default: 30_000
	jitter?: boolean; // default: true
	shouldRetry?: (error: unknown) => boolean;
	onError?: () => Promise<void>;
	onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

function getRetryAfterMs(error: unknown): number | undefined {
	if (
		error &&
		typeof error === "object" &&
		"data" in error &&
		error.data &&
		typeof error.data === "object" &&
		"retry_after_ms" in error.data &&
		typeof (error.data as Record<string, unknown>).retry_after_ms === "number"
	) {
		return (error.data as Record<string, unknown>).retry_after_ms as number;
	}
	return undefined;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
	const {
		maxRetries = 5,
		baseDelayMs = 1000,
		maxDelayMs = 30_000,
		jitter = true,
		shouldRetry = () => true,
		onError,
		onRetry,
	} = opts;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			// onError is not called on the final attempt — callers should not depend on it for final cleanup
			if (attempt === maxRetries || !shouldRetry(err)) throw err;

			await onError?.();

			const retryAfter = getRetryAfterMs(err);
			let delay = retryAfter ?? Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
			if (jitter && !retryAfter) delay *= 0.5 + Math.random() * 0.5;

			onRetry?.(attempt + 1, delay, err);
			await new Promise<void>((resolve) => setTimeout(resolve, delay));
		}
	}

	// Loop should always throw or return; this is unreachable
	throw new Error("Retry exhausted");
}
