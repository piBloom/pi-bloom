import { describe, expect, it } from "vitest";
import {
	advanceStep,
	createInitialState,
	getNextStep,
	getStepsSummary,
	isSetupComplete,
	parseSetupState,
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

describe("parseSetupState", () => {
	it("returns ok:true with state for valid input", () => {
		const input = {
			version: 1,
			startedAt: "2025-01-01T00:00:00.000Z",
			completedAt: null,
			steps: { persona: { status: "pending" } },
		};
		const result = parseSetupState(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.version).toBe(1);
			expect(result.state.startedAt).toBe("2025-01-01T00:00:00.000Z");
			expect(result.state.completedAt).toBeNull();
			expect(result.state.steps.persona.status).toBe("pending");
		}
	});

	it("returns ok:false with error message for wrong field type", () => {
		const input = {
			version: "not-a-number",
			startedAt: "2025-01-01T00:00:00.000Z",
			completedAt: null,
			steps: {},
		};
		const result = parseSetupState(input);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("setup state corrupt or incompatible");
		}
	});

	it("returns ok:false with error message for missing required field", () => {
		const input = {
			version: 1,
			completedAt: null,
			steps: {},
			// startedAt is missing
		};
		const result = parseSetupState(input);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("setup state corrupt or incompatible");
		}
	});

	it("returns ok:false for null input", () => {
		const result = parseSetupState(null);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("setup state corrupt or incompatible");
		}
	});

	it("returns ok:false for empty object input", () => {
		const result = parseSetupState({});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("setup state corrupt or incompatible");
		}
	});

	it("returns ok:false for primitive input", () => {
		const result = parseSetupState(42);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("setup state corrupt or incompatible");
		}
	});
});
