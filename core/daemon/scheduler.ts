export interface ScheduledJob {
	id: string;
	agentId: string;
	roomId: string;
	kind: "heartbeat" | "cron";
	prompt: string;
	intervalMinutes?: number;
	cron?: string;
	quietIfNoop?: boolean;
	noOpToken?: string;
}

export interface SchedulerJobState {
	lastRunAt?: number;
	lastFailureAt?: number;
}

export interface TriggeredJob extends ScheduledJob {
	jobId: string;
}

export interface SchedulerOptions {
	jobs: ScheduledJob[];
	onTrigger: (job: TriggeredJob) => Promise<unknown>;
	loadState: () => Record<string, SchedulerJobState>;
	saveState: (state: Record<string, SchedulerJobState>) => void;
	onError?: (job: TriggeredJob, error: unknown) => void;
	now?: () => number;
	setTimeoutImpl?: typeof setTimeout;
	clearTimeoutImpl?: typeof clearTimeout;
}

export class Scheduler {
	private readonly jobs: ScheduledJob[];
	private readonly onTrigger: (job: TriggeredJob) => Promise<unknown>;
	private readonly saveState: (state: Record<string, SchedulerJobState>) => void;
	private readonly onError: (job: TriggeredJob, error: unknown) => void;
	private readonly now: () => number;
	private readonly setTimeoutImpl: typeof setTimeout;
	private readonly clearTimeoutImpl: typeof clearTimeout;
	private readonly state: Record<string, SchedulerJobState>;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;

	constructor(options: SchedulerOptions) {
		this.jobs = options.jobs;
		this.onTrigger = options.onTrigger;
		this.saveState = options.saveState;
		this.onError = options.onError ?? (() => {});
		this.now = options.now ?? (() => Date.now());
		this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
		this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
		this.state = options.loadState();
	}

	start(): void {
		this.stopped = false;
		this.scheduleNext();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			this.clearTimeoutImpl(this.timer);
			this.timer = null;
		}
	}

	private scheduleNext(): void {
		if (this.stopped || this.jobs.length === 0) return;

		const now = this.now();
		const nextRunAt = Math.min(
			...this.jobs.map((job) =>
				computeNextRunAt(
					job,
					now,
					this.state[this.stateKey(job)]?.lastRunAt,
					this.state[this.stateKey(job)]?.lastFailureAt,
				),
			),
		);
		const delayMs = Math.max(0, nextRunAt - now);
		this.timer = this.setTimeoutImpl(() => {
			void this.runDueJobs().finally(() => this.scheduleNext());
		}, delayMs);
	}

	private async runDueJobs(): Promise<void> {
		const now = this.now();
		for (const job of this.jobs) {
			const stateKey = this.stateKey(job);
			const nextRunAt = computeNextRunAt(
				job,
				now,
				this.state[stateKey]?.lastRunAt,
				this.state[stateKey]?.lastFailureAt,
			);
			if (nextRunAt > now) continue;

			const triggeredJob: TriggeredJob = {
				...job,
				jobId: job.id,
			};
			try {
				await this.onTrigger(triggeredJob);
				this.state[stateKey] = { lastRunAt: now };
				this.saveState(this.state);
			} catch (error) {
				this.state[stateKey] = {
					...this.state[stateKey],
					lastFailureAt: now,
				};
				this.saveState(this.state);
				this.onError(triggeredJob, error);
			}
		}
	}

	private stateKey(job: ScheduledJob): string {
		return `${job.agentId}::${job.roomId}::${job.id}`;
	}
}

export function computeNextRunAt(job: ScheduledJob, now: number, lastRunAt?: number, lastFailureAt?: number): number {
	if (job.kind === "heartbeat") {
		const intervalMs = (job.intervalMinutes ?? 0) * 60 * 1000;
		if (lastRunAt === undefined && lastFailureAt === undefined) return now;
		if (lastRunAt === undefined) return (lastFailureAt as number) + intervalMs;
		if (typeof lastFailureAt === "number" && lastFailureAt > lastRunAt) {
			return lastFailureAt + intervalMs;
		}
		return lastRunAt + intervalMs;
	}

	return computeNextCronRunAt(normalizeSupportedCronExpression(job.cron ?? ""), now);
}

export function isSupportedCronExpression(expression: string): boolean {
	try {
		normalizeSupportedCronExpression(expression);
		return true;
	} catch {
		return false;
	}
}

function normalizeSupportedCronExpression(expression: string): string {
	const trimmed = expression.trim();
	if (trimmed === "@daily") return "0 0 * * *";
	if (trimmed === "@hourly") return "0 * * * *";
	if (trimmed === "@weekly") return "0 0 * * 0";

	const parts = trimmed.split(/\s+/);
	if (parts.length !== 5) {
		throw new Error(`Unsupported cron expression: ${expression}`);
	}
	// Only support day-of-week scheduling in addition to daily
	if (parts[2] !== "*" || parts[3] !== "*") {
		throw new Error(`Unsupported cron expression: ${expression}`);
	}

	const minute = Number.parseInt(parts[0] ?? "", 10);
	const hour = Number.parseInt(parts[1] ?? "", 10);
	if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
		throw new Error(`Unsupported cron expression: ${expression}`);
	}
	if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
		throw new Error(`Unsupported cron expression: ${expression}`);
	}

	// Validate day of week if specified (0-6, where 0 is Sunday)
	const dayOfWeek = parts[4];
	if (dayOfWeek !== "*") {
		const dow = Number.parseInt(dayOfWeek ?? "", 10);
		if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
			throw new Error(`Unsupported cron expression: ${expression}`);
		}
	}

	return `${minute} ${hour} * * ${dayOfWeek}`;
}

function computeNextCronRunAt(expression: string, now: number): number {
	if (expression === "0 * * * *") {
		const next = new Date(now);
		next.setUTCMinutes(0, 0, 0);
		next.setUTCHours(next.getUTCHours() + 1);
		return next.getTime();
	}

	const parts = expression.split(" ");
	const minute = Number.parseInt(parts[0] ?? "", 10);
	const hour = Number.parseInt(parts[1] ?? "", 10);
	const dayOfWeek = parts[4];
	const next = new Date(now);
	next.setUTCSeconds(0, 0);
	next.setUTCMinutes(minute);
	next.setUTCHours(hour);

	if (dayOfWeek !== "*") {
		// Day of week is specified (0-6, where 0 is Sunday)
		const targetDow = Number.parseInt(dayOfWeek, 10);
		const currentDow = next.getUTCDay();
		let daysUntilTarget = targetDow - currentDow;
		if (daysUntilTarget < 0) {
			daysUntilTarget += 7;
		}
		if (daysUntilTarget === 0 && next.getTime() <= now) {
			// Target is today but time has passed, schedule for next week
			daysUntilTarget = 7;
		}
		next.setUTCDate(next.getUTCDate() + daysUntilTarget);
	} else if (next.getTime() <= now) {
		// Daily schedule - move to tomorrow
		next.setUTCDate(next.getUTCDate() + 1);
	}

	return next.getTime();
}
