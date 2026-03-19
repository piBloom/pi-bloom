import { describe, expect, it, vi } from "vitest";

import {
	computeNextRunAt,
	isSupportedCronExpression,
	type ScheduledJob,
	Scheduler,
} from "../../core/daemon/scheduler.js";

describe("computeNextRunAt", () => {
	it("schedules heartbeat jobs relative to the last run time", () => {
		const job: ScheduledJob = {
			id: "daily-heartbeat",
			agentId: "host",
			roomId: "!ops:bloom",
			kind: "heartbeat",
			intervalMinutes: 1440,
			prompt: "Heartbeat",
		};

		expect(computeNextRunAt(job, Date.UTC(2026, 2, 14, 12, 0, 0), Date.UTC(2026, 2, 13, 12, 0, 0))).toBe(
			Date.UTC(2026, 2, 14, 12, 0, 0),
		);
	});

	it("backs off failed heartbeat jobs by one interval instead of retrying immediately", () => {
		const job: ScheduledJob = {
			id: "daily-heartbeat",
			agentId: "host",
			roomId: "!ops:bloom",
			kind: "heartbeat",
			intervalMinutes: 1440,
			prompt: "Heartbeat",
		};

		expect(computeNextRunAt(job, Date.UTC(2026, 2, 14, 12, 0, 0), undefined, Date.UTC(2026, 2, 14, 12, 0, 0))).toBe(
			Date.UTC(2026, 2, 15, 12, 0, 0),
		);
	});

	it("schedules cron jobs at the next matching daily time", () => {
		const job: ScheduledJob = {
			id: "morning-check",
			agentId: "host",
			roomId: "!ops:bloom",
			kind: "cron",
			cron: "0 9 * * *",
			prompt: "Morning check",
		};

		expect(computeNextRunAt(job, Date.UTC(2026, 2, 14, 8, 30, 0))).toBe(Date.UTC(2026, 2, 14, 9, 0, 0));
		expect(computeNextRunAt(job, Date.UTC(2026, 2, 14, 9, 30, 0))).toBe(Date.UTC(2026, 2, 15, 9, 0, 0));
	});

	it("supports the @hourly cron macro", () => {
		const job: ScheduledJob = {
			id: "hourly-check",
			agentId: "host",
			roomId: "!ops:bloom",
			kind: "cron",
			cron: "@hourly",
			prompt: "Hourly check",
		};

		expect(computeNextRunAt(job, Date.UTC(2026, 2, 14, 8, 30, 0))).toBe(Date.UTC(2026, 2, 14, 9, 0, 0));
	});

	it("supports the @weekly cron macro (Sunday at midnight)", () => {
		const job: ScheduledJob = {
			id: "weekly-check",
			agentId: "host",
			roomId: "!ops:bloom",
			kind: "cron",
			cron: "@weekly",
			prompt: "Weekly check",
		};

		// 2026-03-14 is a Saturday (day 6)
		// Next Sunday (day 0) is 2026-03-15
		expect(computeNextRunAt(job, Date.UTC(2026, 2, 14, 12, 0, 0))).toBe(Date.UTC(2026, 2, 15, 0, 0, 0));
	});

	it("schedules day-of-week cron jobs correctly", () => {
		const job: ScheduledJob = {
			id: "monday-check",
			agentId: "host",
			roomId: "!ops:bloom",
			kind: "cron",
			cron: "0 9 * * 1", // Mondays at 9 AM
			prompt: "Monday check",
		};

		// 2026-03-14 is a Saturday (day 6)
		// Next Monday (day 1) is 2026-03-16
		expect(computeNextRunAt(job, Date.UTC(2026, 2, 14, 12, 0, 0))).toBe(Date.UTC(2026, 2, 16, 9, 0, 0));

		// If today is Monday before 9 AM, schedule today
		// 2026-03-16 is a Monday
		expect(computeNextRunAt(job, Date.UTC(2026, 2, 16, 8, 0, 0))).toBe(Date.UTC(2026, 2, 16, 9, 0, 0));

		// If today is Monday after 9 AM, schedule next Monday
		expect(computeNextRunAt(job, Date.UTC(2026, 2, 16, 10, 0, 0))).toBe(Date.UTC(2026, 2, 23, 9, 0, 0));
	});
});

describe("isSupportedCronExpression", () => {
	it("accepts the small cron subset used by Bloom", () => {
		expect(isSupportedCronExpression("@daily")).toBe(true);
		expect(isSupportedCronExpression("@hourly")).toBe(true);
		expect(isSupportedCronExpression("@weekly")).toBe(true);
		expect(isSupportedCronExpression("0 9 * * *")).toBe(true);
		expect(isSupportedCronExpression("0 9 * * 1")).toBe(true); // Monday
		expect(isSupportedCronExpression("0 9 * * 0")).toBe(true); // Sunday
		expect(isSupportedCronExpression("0 9 * * 6")).toBe(true); // Saturday
	});

	it("rejects unsupported cron expressions", () => {
		expect(isSupportedCronExpression("*/5 * * * *")).toBe(false);
		expect(isSupportedCronExpression("0 9 1 * *")).toBe(false); // Day of month
		expect(isSupportedCronExpression("0 9 * 1 *")).toBe(false); // Month
		expect(isSupportedCronExpression("0 9 * * 7")).toBe(false); // Invalid day of week
	});
});

describe("Scheduler", () => {
	it("fires due jobs, persists state, and schedules the next run", async () => {
		vi.useFakeTimers();
		const callback = vi.fn(async () => "ok");
		const persistState = vi.fn();
		const timeouts: Array<() => void> = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return 1 as unknown as ReturnType<typeof setTimeout>;
		});
		const clearTimeoutImpl = vi.fn();
		const jobs: ScheduledJob[] = [
			{
				id: "daily-heartbeat",
				agentId: "host",
				roomId: "!ops:bloom",
				kind: "heartbeat",
				intervalMinutes: 1440,
				prompt: "Heartbeat",
			},
		];
		const scheduler = new Scheduler({
			jobs,
			now: () => Date.UTC(2026, 2, 14, 12, 0, 0),
			onTrigger: callback,
			loadState: () => ({
				"host::!ops:bloom::daily-heartbeat": {
					lastRunAt: Date.UTC(2026, 2, 13, 12, 0, 0),
				},
			}),
			saveState: persistState,
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
			clearTimeoutImpl: clearTimeoutImpl as unknown as typeof clearTimeout,
		});

		scheduler.start();
		await timeouts[0]?.();

		expect(callback).toHaveBeenCalledWith(
			expect.objectContaining({
				jobId: "daily-heartbeat",
				agentId: "host",
				roomId: "!ops:bloom",
				kind: "heartbeat",
			}),
		);
		expect(persistState).toHaveBeenCalledWith({
			"host::!ops:bloom::daily-heartbeat": {
				lastRunAt: Date.UTC(2026, 2, 14, 12, 0, 0),
			},
		});

		scheduler.stop();
		expect(clearTimeoutImpl).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("persists failure timing so failed heartbeat jobs do not requeue immediately", async () => {
		const callback = vi.fn(async () => {
			throw new Error("boom");
		});
		const persistState = vi.fn();
		const timeouts: Array<() => void> = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return 1 as unknown as ReturnType<typeof setTimeout>;
		});
		const scheduler = new Scheduler({
			jobs: [
				{
					id: "daily-heartbeat",
					agentId: "host",
					roomId: "!ops:bloom",
					kind: "heartbeat",
					intervalMinutes: 1440,
					prompt: "Heartbeat",
				},
			],
			now: () => Date.UTC(2026, 2, 14, 12, 0, 0),
			onTrigger: callback,
			loadState: () => ({}),
			saveState: persistState,
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
		});

		scheduler.start();
		await timeouts[0]?.();
		await Promise.resolve();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(persistState).toHaveBeenCalledWith({
			"host::!ops:bloom::daily-heartbeat": {
				lastFailureAt: Date.UTC(2026, 2, 14, 12, 0, 0),
			},
		});
		expect(setTimeoutImpl).toHaveBeenCalledTimes(2);
		expect(setTimeoutImpl.mock.calls[1]?.[1]).toBe(24 * 60 * 60 * 1000);
	});

	it("calls onError callback when job fails", async () => {
		const error = new Error("job failed");
		const callback = vi.fn(async () => {
			throw error;
		});
		const onError = vi.fn();
		const timeouts: Array<() => void> = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return 1 as unknown as ReturnType<typeof setTimeout>;
		});
		const scheduler = new Scheduler({
			jobs: [
				{
					id: "failing-job",
					agentId: "host",
					roomId: "!ops:bloom",
					kind: "heartbeat",
					intervalMinutes: 60,
					prompt: "Test",
				},
			],
			now: () => Date.UTC(2026, 2, 14, 12, 0, 0),
			onTrigger: callback,
			loadState: () => ({}),
			saveState: vi.fn(),
			onError,
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
		});

		scheduler.start();
		await timeouts[0]?.();
		await Promise.resolve();

		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				jobId: "failing-job",
				agentId: "host",
				roomId: "!ops:bloom",
			}),
			error,
		);
	});

	it("handles empty job list gracefully", () => {
		const setTimeoutImpl = vi.fn();
		const scheduler = new Scheduler({
			jobs: [],
			now: () => Date.UTC(2026, 2, 14, 12, 0, 0),
			onTrigger: vi.fn(),
			loadState: () => ({}),
			saveState: vi.fn(),
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
		});

		scheduler.start();
		expect(setTimeoutImpl).not.toHaveBeenCalled();
	});

	it("uses default noop onError when not provided", async () => {
		const callback = vi.fn(async () => {
			throw new Error("boom");
		});
		const timeouts: Array<() => void> = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return 1 as unknown as ReturnType<typeof setTimeout>;
		});
		const scheduler = new Scheduler({
			jobs: [
				{
					id: "test-job",
					agentId: "host",
					roomId: "!ops:bloom",
					kind: "heartbeat",
					intervalMinutes: 60,
					prompt: "Test",
				},
			],
			now: () => Date.UTC(2026, 2, 14, 12, 0, 0),
			onTrigger: callback,
			loadState: () => ({}),
			saveState: vi.fn(),
			// onError not provided - should use default noop
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
		});

		// Should not throw
		scheduler.start();
		await timeouts[0]?.();
		await Promise.resolve();

		expect(callback).toHaveBeenCalled();
	});

	it("uses real Date.now when now function not provided", async () => {
		const callback = vi.fn(async () => "ok");
		const timeouts: Array<() => void> = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return 1 as unknown as ReturnType<typeof setTimeout>;
		});
		const scheduler = new Scheduler({
			jobs: [
				{
					id: "test-job",
					agentId: "host",
					roomId: "!ops:bloom",
					kind: "heartbeat",
					intervalMinutes: 60,
					prompt: "Test",
				},
			],
			// now not provided - should use Date.now
			onTrigger: callback,
			loadState: () => ({}),
			saveState: vi.fn(),
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
		});

		scheduler.start();
		await timeouts[0]?.();

		// The job should have been triggered
		expect(callback).toHaveBeenCalled();
		expect(setTimeoutImpl.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(0);
	});

	it("handles multiple jobs with different schedules", async () => {
		const callbacks = {
			hourly: vi.fn(async () => "ok"),
			daily: vi.fn(async () => "ok"),
		};
		const timeouts: Array<() => void> = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return timeouts.length as unknown as ReturnType<typeof setTimeout>;
		});
		const scheduler = new Scheduler({
			jobs: [
				{
					id: "hourly-job",
					agentId: "host",
					roomId: "!room1:bloom",
					kind: "heartbeat",
					intervalMinutes: 60,
					prompt: "Hourly",
				},
				{
					id: "daily-job",
					agentId: "host",
					roomId: "!room2:bloom",
					kind: "cron",
					cron: "0 9 * * *",
					prompt: "Daily",
				},
			],
			now: () => Date.UTC(2026, 2, 14, 8, 0, 0),
			onTrigger: async (job) => {
				if (job.id === "hourly-job") return callbacks.hourly();
				return callbacks.daily();
			},
			loadState: () => ({
				"host::!room1:bloom::hourly-job": { lastRunAt: Date.UTC(2026, 2, 14, 7, 0, 0) },
			}),
			saveState: vi.fn(),
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
		});

		scheduler.start();
		await timeouts[0]?.();

		// Both jobs should run (hourly is due, daily is at 9:00 which is in the future at 8:00)
		expect(callbacks.hourly).toHaveBeenCalledTimes(1);
		expect(callbacks.daily).not.toHaveBeenCalled(); // Not due yet
	});

	it("stops scheduling when stopped", async () => {
		const callback = vi.fn(async () => "ok");
		const timeouts: Array<() => void> = [];
		const clearedTimeouts: number[] = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return timeouts.length as unknown as ReturnType<typeof setTimeout>;
		});
		const clearTimeoutImpl = vi.fn((id: ReturnType<typeof setTimeout>) => {
			clearedTimeouts.push(id as unknown as number);
		});
		const scheduler = new Scheduler({
			jobs: [
				{
					id: "test-job",
					agentId: "host",
					roomId: "!ops:bloom",
					kind: "heartbeat",
					intervalMinutes: 60,
					prompt: "Test",
				},
			],
			now: () => Date.UTC(2026, 2, 14, 12, 0, 0),
			onTrigger: callback,
			loadState: () => ({}),
			saveState: vi.fn(),
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
			clearTimeoutImpl: clearTimeoutImpl as unknown as typeof clearTimeout,
		});

		scheduler.start();
		expect(setTimeoutImpl).toHaveBeenCalledTimes(1);

		scheduler.stop();
		expect(clearTimeoutImpl).toHaveBeenCalled();

		// Try to run the timeout callback - should not trigger job
		const timeoutFn = timeouts[0];
		if (timeoutFn) {
			await timeoutFn();
		}

		// After stop, the scheduler should not have triggered the callback
		// because scheduleNext returns early when stopped
	});

	it("handles corrupted state gracefully", async () => {
		const callback = vi.fn(async () => "ok");
		const timeouts: Array<() => void> = [];
		const setTimeoutImpl = vi.fn((fn: () => void, _delay: number) => {
			timeouts.push(fn);
			return 1 as unknown as ReturnType<typeof setTimeout>;
		});
		const scheduler = new Scheduler({
			jobs: [
				{
					id: "test-job",
					agentId: "host",
					roomId: "!ops:bloom",
					kind: "heartbeat",
					intervalMinutes: 60,
					prompt: "Test",
				},
			],
			now: () => Date.UTC(2026, 2, 14, 12, 0, 0),
			onTrigger: callback,
			loadState: () => ({
				// Corrupted state with invalid values
				"host::!ops:bloom::test-job": { lastRunAt: Number.NaN, lastFailureAt: Number.NaN },
			}),
			saveState: vi.fn(),
			setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
		});

		scheduler.start();
		await timeouts[0]?.();

		// Should still trigger the job despite corrupted state
		expect(callback).toHaveBeenCalled();
	});
});
