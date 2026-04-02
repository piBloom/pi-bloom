import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../../core/lib/retry.js";

describe("withRetry", () => {
	it("returns immediately on success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on transient failure then succeeds", async () => {
		const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");
		const result = await withRetry(fn, {
			baseDelayMs: 0,
			jitter: false,
			shouldRetry: () => true,
		});
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("throws after maxRetries exhausted", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("always fails"));
		await expect(
			withRetry(fn, {
				maxRetries: 2,
				baseDelayMs: 0,
				jitter: false,
				shouldRetry: () => true,
			}),
		).rejects.toThrow("always fails");
		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it("does not retry when shouldRetry returns false", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("auth failure"));
		await expect(
			withRetry(fn, {
				shouldRetry: () => false,
				baseDelayMs: 0,
			}),
		).rejects.toThrow("auth failure");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("calls onError teardown before each retry", async () => {
		const teardown = vi.fn().mockResolvedValue(undefined);
		const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");
		await withRetry(fn, {
			baseDelayMs: 0,
			jitter: false,
			onError: teardown,
			shouldRetry: () => true,
		});
		expect(teardown).toHaveBeenCalledTimes(1);
	});

	it("calls onRetry with attempt number, delay, and error", async () => {
		const onRetry = vi.fn();
		const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");
		await withRetry(fn, {
			baseDelayMs: 0,
			jitter: false,
			onRetry,
			shouldRetry: () => true,
		});
		expect(onRetry).toHaveBeenCalledTimes(1);
		const [attempt, delay, error] = onRetry.mock.calls[0] as [number, number, Error];
		expect(attempt).toBe(1);
		expect(typeof delay).toBe("number");
		expect(error.message).toBe("fail");
	});

	it("does not call onError on the final attempt", async () => {
		const onError = vi.fn().mockResolvedValue(undefined);
		const fn = vi.fn().mockRejectedValue(new Error("always fails"));
		await expect(
			withRetry(fn, {
				maxRetries: 2,
				baseDelayMs: 0,
				jitter: false,
				onError,
				shouldRetry: () => true,
			}),
		).rejects.toThrow("always fails");
		// With maxRetries=2 there are 3 total attempts, so onError is called before
		// attempts 2 and 3, but NOT before the throw on attempt 3 final
		expect(onError).toHaveBeenCalledTimes(2);
	});

	it("uses retry_after_ms from error data when present", async () => {
		vi.useFakeTimers();
		const retryAfterErr = Object.assign(new Error("rate limited"), {
			data: { retry_after_ms: 5000 },
		});
		let _resolveDelay!: () => void;
		const fn = vi.fn().mockRejectedValueOnce(retryAfterErr).mockResolvedValue("ok");

		const resultPromise = withRetry(fn, {
			jitter: false,
			shouldRetry: () => true,
		});

		// Advance past the retry_after_ms delay
		await vi.advanceTimersByTimeAsync(5001);
		const result = await resultPromise;
		expect(result).toBe("ok");
		vi.useRealTimers();
	});

	it("respects maxDelayMs cap on computed delay", async () => {
		vi.useFakeTimers();
		const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");

		const resultPromise = withRetry(fn, {
			baseDelayMs: 100000,
			maxDelayMs: 500,
			jitter: false,
			shouldRetry: () => true,
		});

		// Even though baseDelayMs is huge, maxDelayMs=500 caps it
		await vi.advanceTimersByTimeAsync(501);
		const result = await resultPromise;
		expect(result).toBe("ok");
		vi.useRealTimers();
	});

	it("handles maxRetries: 0 (only one attempt, no retries)", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("instant fail"));
		await expect(withRetry(fn, { maxRetries: 0 })).rejects.toThrow("instant fail");
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
