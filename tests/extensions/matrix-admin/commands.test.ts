import { describe, expect, it } from "vitest";
import { DANGEROUS_COMMANDS, applyTransformations, isDangerous } from "../../../core/pi/extensions/matrix-admin/commands.js";

describe("DANGEROUS_COMMANDS", () => {
  it("includes destructive user commands", () => {
    expect(DANGEROUS_COMMANDS.has("users deactivate")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users deactivate-all")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users logout")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users make-user-admin")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users force-join-list-of-local-users")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users force-join-all-local-users")).toBe(true);
  });

  it("includes destructive room commands", () => {
    expect(DANGEROUS_COMMANDS.has("rooms moderation ban-room")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("rooms moderation ban-list-of-rooms")).toBe(true);
  });

  it("includes dangerous server commands", () => {
    expect(DANGEROUS_COMMANDS.has("server restart")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("server shutdown")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("server show-config")).toBe(true);
  });

  it("includes dangerous federation and appservice commands", () => {
    expect(DANGEROUS_COMMANDS.has("federation disable-room")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("appservices unregister")).toBe(true);
  });

  it("includes dangerous media and token commands", () => {
    expect(DANGEROUS_COMMANDS.has("media delete-list")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("media delete-past-remote-media")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("media delete-all-from-user")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("media delete-all-from-server")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("token destroy")).toBe(true);
  });

  it("does NOT include safe read commands", () => {
    expect(DANGEROUS_COMMANDS.has("users list-users")).toBe(false);
    expect(DANGEROUS_COMMANDS.has("rooms list-rooms")).toBe(false);
    expect(DANGEROUS_COMMANDS.has("server uptime")).toBe(false);
  });
});

describe("isDangerous", () => {
  it("returns true when command starts with a dangerous prefix", () => {
    expect(isDangerous("users deactivate @alice:nixpi")).toBe(true);
    expect(isDangerous("server restart")).toBe(true);
  });

  it("returns false for safe commands", () => {
    expect(isDangerous("users list-users")).toBe(false);
    expect(isDangerous("rooms list-rooms")).toBe(false);
  });
});

describe("check/debug/query pass-through namespaces", () => {
  it("debug commands are not dangerous", () => {
    expect(isDangerous("debug ping example.com")).toBe(false);
    expect(isDangerous("check")).toBe(false);
    expect(isDangerous("query globals signing-keys-for example.com")).toBe(false);
  });

  it("applyTransformations does not modify debug or query commands", () => {
    expect(applyTransformations("debug change-log-level debug")).toBe("debug change-log-level debug");
    expect(applyTransformations("query raw raw-del somekey")).toBe("query raw raw-del somekey");
  });
});

describe("applyTransformations", () => {
  it("appends --yes-i-want-to-do-this to force-join-list-of-local-users", () => {
    const result = applyTransformations("users force-join-list-of-local-users !room:nixpi");
    expect(result).toBe("users force-join-list-of-local-users !room:nixpi --yes-i-want-to-do-this");
  });

  it("does NOT duplicate the flag if already present", () => {
    const cmd = "users force-join-list-of-local-users !room:nixpi --yes-i-want-to-do-this";
    expect(applyTransformations(cmd)).toBe(cmd);
  });

  it("does not modify other commands", () => {
    expect(applyTransformations("users list-users")).toBe("users list-users");
    expect(applyTransformations("rooms list-rooms")).toBe("rooms list-rooms");
  });
});
