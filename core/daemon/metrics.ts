/**
 * Lightweight metrics event emitter for daemon observability.
 * Events are emitted as JSONL to stdout for external collection.
 */

export type MetricEventType =
	| "session_spawned"
	| "session_exit"
	| "message_routed"
	| "message_blocked"
	| "proactive_job_started"
	| "proactive_job_completed"
	| "proactive_job_failed"
	| "matrix_connected"
	| "matrix_disconnected"
	| "matrix_error";

export interface MetricEvent {
	ts: string;
	metric: MetricEventType;
	agentId?: string;
	roomId?: string;
	jobId?: string;
	durationMs?: number;
	reason?: string;
	error?: string;
	[key: string]: unknown;
}

export type MetricHandler = (event: MetricEvent) => void;

class MetricsCollector {
	private handlers: MetricHandler[] = [];
	private enabled = true;

	addHandler(handler: MetricHandler): void {
		this.handlers.push(handler);
	}

	removeHandler(handler: MetricHandler): void {
		this.handlers = this.handlers.filter((h) => h !== handler);
	}

	enable(): void {
		this.enabled = true;
	}

	disable(): void {
		this.enabled = false;
	}

	emit(type: MetricEventType, data?: Omit<MetricEvent, "ts" | "metric">): void {
		if (!this.enabled) return;

		const event: MetricEvent = {
			ts: new Date().toISOString(),
			metric: type,
			...data,
		};

		for (const handler of this.handlers) {
			try {
				handler(event);
			} catch {
				// Ignore handler errors to prevent disrupting core functionality
			}
		}
	}
}

// Singleton instance
const collector = new MetricsCollector();

// Default JSONL handler writes to stdout
if (process.env.BLOOM_METRICS_ENABLED === "1") {
	collector.addHandler((event) => {
		// eslint-disable-next-line no-console
		console.log(`[METRIC] ${JSON.stringify(event)}`);
	});
}

export function addMetricHandler(handler: MetricHandler): void {
	collector.addHandler(handler);
}

export function removeMetricHandler(handler: MetricHandler): void {
	collector.removeHandler(handler);
}

export function enableMetrics(): void {
	collector.enable();
}

export function disableMetrics(): void {
	collector.disable();
}

export function emitMetric(type: MetricEventType, data?: Omit<MetricEvent, "ts" | "metric">): void {
	collector.emit(type, data);
}

// Convenience functions for common events
export function emitSessionSpawned(agentId: string, roomId: string): void {
	emitMetric("session_spawned", { agentId, roomId });
}

export function emitSessionExit(agentId: string, roomId: string, exitCode: number | null): void {
	emitMetric("session_exit", { agentId, roomId, exitCode });
}

export function emitMessageRouted(agentId: string, roomId: string, reason: string, durationMs?: number): void {
	emitMetric("message_routed", { agentId, roomId, reason, durationMs });
}

export function emitMessageBlocked(roomId: string, reason: string): void {
	emitMetric("message_blocked", { roomId, reason });
}

export function emitProactiveJobStarted(agentId: string, roomId: string, jobId: string): void {
	emitMetric("proactive_job_started", { agentId, roomId, jobId });
}

export function emitProactiveJobCompleted(agentId: string, roomId: string, jobId: string, durationMs: number): void {
	emitMetric("proactive_job_completed", { agentId, roomId, jobId, durationMs });
}

export function emitProactiveJobFailed(agentId: string, roomId: string, jobId: string, error: string): void {
	emitMetric("proactive_job_failed", { agentId, roomId, jobId, error });
}

export function emitMatrixConnected(agentId: string): void {
	emitMetric("matrix_connected", { agentId });
}

export function emitMatrixDisconnected(agentId: string): void {
	emitMetric("matrix_disconnected", { agentId });
}

export function emitMatrixError(agentId: string, error: string): void {
	emitMetric("matrix_error", { agentId, error });
}
