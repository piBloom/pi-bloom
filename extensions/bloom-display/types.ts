// Extension-specific types for bloom-display

/** Parameters for the display tool actions. */
export interface DisplayParams {
	action: string;
	x?: number;
	y?: number;
	text?: string;
	keys?: string;
	button?: number;
	direction?: "up" | "down";
	clicks?: number;
	command?: string;
	number?: number;
	target?: string;
	app?: string;
	region?: { x: number; y: number; w: number; h: number };
}
