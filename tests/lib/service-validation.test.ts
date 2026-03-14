import { describe, expect, it } from "vitest";
import { validatePinnedImage, validateServiceName } from "../../core/lib/services-validation.js";

// ---------------------------------------------------------------------------
// validateServiceName
// ---------------------------------------------------------------------------
describe("validateServiceName", () => {
	it("accepts valid kebab-case names", () => {
		expect(validateServiceName("whisper")).toBeNull();
		expect(validateServiceName("my-service")).toBeNull();
		expect(validateServiceName("svc1")).toBeNull();
	});

	it("rejects uppercase", () => {
		expect(validateServiceName("MyService")).not.toBeNull();
	});

	it("rejects spaces", () => {
		expect(validateServiceName("my service")).not.toBeNull();
	});

	it("rejects underscores", () => {
		expect(validateServiceName("my_service")).not.toBeNull();
	});

	it("rejects leading hyphen", () => {
		expect(validateServiceName("-service")).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// validatePinnedImage
// ---------------------------------------------------------------------------
describe("validatePinnedImage", () => {
	it("accepts sha256 digest", () => {
		expect(validatePinnedImage(`ghcr.io/foo/bar@sha256:${"a".repeat(64)}`)).toBeNull();
	});

	it("accepts semver tag", () => {
		expect(validatePinnedImage("ghcr.io/foo/bar:1.2.3")).toBeNull();
	});

	it("rejects latest tag", () => {
		expect(validatePinnedImage("ghcr.io/foo/bar:latest")).not.toBeNull();
	});

	it("rejects latest-beta tag", () => {
		expect(validatePinnedImage("ghcr.io/foo/bar:latest-beta")).not.toBeNull();
	});

	it("rejects no tag", () => {
		expect(validatePinnedImage("ghcr.io/foo/bar")).not.toBeNull();
	});

	it("accepts LATEST (case-insensitive rejection)", () => {
		expect(validatePinnedImage("ghcr.io/foo/bar:LATEST")).not.toBeNull();
	});
});
