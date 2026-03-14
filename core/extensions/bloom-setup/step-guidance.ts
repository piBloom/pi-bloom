/**
 * Step guidance constants for bloom-setup.
 * Defines what Pi should say/do at each first-boot setup step.
 */
import type { StepName } from "../../lib/setup.js";

/** Step guidance — what Pi should say/do at each step. */
export const STEP_GUIDANCE: Record<StepName, string> = {
	persona:
		"Guide the user through personalizing their AI companion. Ask one question at a time: SOUL — 'What should I call you?', 'How formal or casual should I be?', 'Any values important to you?'. BODY — 'Same style everywhere, or different for Matrix vs terminal?'. FACULTY — 'Step-by-step thinker or quick and direct?'. Update ~/Bloom/Persona/ files with their preferences. Fully skippable.",
};
