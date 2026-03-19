import { describe, expect, it } from "vitest";
import {
	advanceStep,
	createInitialState,
	getNextStep,
	getStepsSummary,
	isSetupComplete,
	STEP_ORDER,
} from "../../core/lib/setup.js";

describe("createInitialState", () => {
	it("creates state with all steps pending", () => {
		const state = createInitialState();
		expect(state.version).toBe(1);
		expect(state.startedAt).toBeTruthy();
		expect(state.completedAt).toBeNull();
		for (const step of STEP_ORDER) {
			expect(state.steps[step].status).toBe("pending");
		}
	});

	it("has exactly 1 step", () => {
		const state = createInitialState();
		expect(Object.keys(state.steps)).toHaveLength(1);
	});
});

describe("getNextStep", () => {
	it("returns 'persona' for fresh state", () => {
		const state = createInitialState();
		expect(getNextStep(state)).toBe("persona");
	});

	it("returns null when all steps are done", () => {
		const state = createInitialState();
		for (const step of STEP_ORDER) {
			state.steps[step] = { status: "completed", at: new Date().toISOString() };
		}
		expect(getNextStep(state)).toBeNull();
	});
});

describe("advanceStep", () => {
	it("marks step as completed", () => {
		const state = createInitialState();
		const next = advanceStep(state, "persona", "completed");
		expect(next.steps.persona.status).toBe("completed");
		expect(next.steps.persona.at).toBeTruthy();
	});

	it("marks step as skipped with reason", () => {
		const state = createInitialState();
		const next = advanceStep(state, "persona", "skipped", "user declined");
		expect(next.steps.persona.status).toBe("skipped");
		expect(next.steps.persona.reason).toBe("user declined");
	});

	it("sets completedAt when last step is completed", () => {
		const state = createInitialState();
		const next = advanceStep(state, "persona", "completed");
		expect(next.completedAt).toBeTruthy();
	});

	it("does not mutate original state", () => {
		const state = createInitialState();
		const next = advanceStep(state, "persona", "completed");
		expect(state.steps.persona.status).toBe("pending");
		expect(next.steps.persona.status).toBe("completed");
	});
});

describe("isSetupComplete", () => {
	it("returns false for fresh state", () => {
		expect(isSetupComplete(createInitialState())).toBe(false);
	});

	it("returns true when completedAt is set", () => {
		const state = createInitialState();
		state.completedAt = new Date().toISOString();
		expect(isSetupComplete(state)).toBe(true);
	});
});

describe("getStepsSummary", () => {
	it("returns summary of all steps", () => {
		const state = createInitialState();
		state.steps.persona = { status: "completed", at: new Date().toISOString() };
		const summary = getStepsSummary(state);
		expect(summary).toHaveLength(1);
		expect(summary[0]).toEqual({ name: "persona", status: "completed" });
	});
});
