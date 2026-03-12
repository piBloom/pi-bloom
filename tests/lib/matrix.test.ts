import { describe, expect, it } from "vitest";
import { generatePassword, matrixCredentialsPath } from "../../lib/matrix.js";

describe("generatePassword", () => {
	it("returns a base64url string of expected length", () => {
		const pw = generatePassword();
		expect(pw.length).toBeGreaterThan(16);
		expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("generates unique passwords", () => {
		const a = generatePassword();
		const b = generatePassword();
		expect(a).not.toBe(b);
	});
});

describe("matrixCredentialsPath", () => {
	it("returns path under .pi directory", () => {
		const p = matrixCredentialsPath();
		expect(p).toContain(".pi");
		expect(p).toContain("matrix-credentials.json");
	});
});
