import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** Step names in execution order. */
export const STEP_ORDER = ["persona"] as const;

export type StepName = (typeof STEP_ORDER)[number];

export type StepStatus = "pending" | "in_progress" | "completed" | "skipped";

const StepStatusSchema = Type.Union([
	Type.Literal("pending"),
	Type.Literal("in_progress"),
	Type.Literal("completed"),
	Type.Literal("skipped"),
]);

const StepStateSchema = Type.Object({
	status: StepStatusSchema,
	at: Type.Optional(Type.String()),
	reason: Type.Optional(Type.String()),
});

export const SetupStateSchema = Type.Object({
	version: Type.Number(),
	startedAt: Type.String(),
	completedAt: Type.Union([Type.String(), Type.Null()]),
	steps: Type.Record(Type.String(), StepStateSchema),
});

export interface StepState {
	status: StepStatus;
	at?: string;
	reason?: string;
}

export interface SetupState {
	version: number;
	startedAt: string;
	completedAt: string | null;
	steps: Record<StepName, StepState>;
}

/**
 * Parse and validate raw JSON as a SetupState.
 * Returns an error string if the data is corrupt or incompatible.
 */
export function parseSetupState(raw: unknown): { ok: true; state: SetupState } | { ok: false; error: string } {
	try {
		const parsed = Value.Parse(SetupStateSchema, raw) as SetupState;
		return { ok: true, state: parsed };
	} catch (e) {
		return {
			ok: false,
			error: `setup state corrupt or incompatible: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/** Create a fresh setup state with all steps pending. */
export function createInitialState(): SetupState {
	const steps = {} as Record<StepName, StepState>;
	for (const name of STEP_ORDER) {
		steps[name] = { status: "pending" };
	}
	return {
		version: 1,
		startedAt: new Date().toISOString(),
		completedAt: null,
		steps,
	};
}

/** Get the next pending step, or null if all done. */
export function getNextStep(state: SetupState): StepName | null {
	for (const name of STEP_ORDER) {
		if (state.steps[name].status === "pending" || state.steps[name].status === "in_progress") {
			return name;
		}
	}
	return null;
}

/** Return a new state with the given step advanced. Does not mutate input. */
export function advanceStep(
	state: SetupState,
	step: StepName,
	status: "completed" | "skipped",
	reason?: string,
): SetupState {
	const newSteps = { ...state.steps };
	newSteps[step] = {
		status,
		at: new Date().toISOString(),
		...(reason ? { reason } : {}),
	};

	const allDone = STEP_ORDER.every((s) => newSteps[s].status === "completed" || newSteps[s].status === "skipped");

	return {
		...state,
		steps: newSteps,
		completedAt: allDone ? new Date().toISOString() : null,
	};
}

/** Check if setup is complete. */
export function isSetupComplete(state: SetupState): boolean {
	return state.completedAt !== null;
}

/** Return a summary array of step name + status. */
export function getStepsSummary(state: SetupState): Array<{ name: StepName; status: StepStatus }> {
	return STEP_ORDER.map((name) => ({ name, status: state.steps[name].status }));
}
