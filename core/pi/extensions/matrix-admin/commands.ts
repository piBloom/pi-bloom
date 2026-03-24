/**
 * Set of command prefixes that are dangerous/destructive.
 * isDangerous() checks whether a given command starts with any of these.
 */
export const DANGEROUS_COMMANDS: Set<string> = new Set([
  // Users — destructive
  "users deactivate",
  "users deactivate-all",
  "users logout",
  "users make-user-admin",
  "users force-join-list-of-local-users",
  "users force-join-all-local-users",
  // Rooms — destructive
  "rooms moderation ban-room",
  "rooms moderation ban-list-of-rooms",
  // Server — disruptive
  "server restart",
  "server shutdown",
  "server show-config",
  // Federation — disruptive
  "federation disable-room",
  // Media — destructive
  "media delete-list",
  "media delete-past-remote-media",
  "media delete-all-from-user",
  "media delete-all-from-server",
  // Appservices — destructive
  "appservices unregister",
  // Tokens — destructive
  "token destroy",
]);

/** Returns true if the command starts with any dangerous prefix. */
export function isDangerous(command: string): boolean {
  for (const prefix of DANGEROUS_COMMANDS) {
    if (command === prefix || command.startsWith(prefix + " ")) {
      return true;
    }
  }
  return false;
}

/**
 * Apply pre-send mutations to a command string.
 * Owned here so client.ts doesn't need to know about command semantics.
 */
export function applyTransformations(command: string): string {
  const FLAG = "--yes-i-want-to-do-this";
  if (
    command.startsWith("users force-join-list-of-local-users") &&
    !command.includes(FLAG)
  ) {
    return `${command} ${FLAG}`;
  }
  return command;
}
