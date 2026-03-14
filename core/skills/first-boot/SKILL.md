---
name: first-boot
description: Post-wizard persona customization — Pi helps the user personalize their Bloom experience
---

# First-Boot: Persona Customization

## Prerequisite

The bash wizard (`bloom-wizard.sh`) has already completed OS-level setup: password, network, NetBird, Matrix, git identity, and services. The sentinel file `~/.bloom/.setup-complete` exists.

If `~/.bloom/wizard-state/persona-done` exists, persona customization is also done. Skip this skill entirely. You can still help the user reconfigure their persona if they ask.

## How This Works

You are paired with the `bloom-setup` extension which tracks state in `~/.bloom/setup-state.json`. Your role is conversational guidance; the extension handles state.

1. Call `setup_status()` to see where you are
2. Follow the guidance for the current step
3. After completing a step, call `setup_advance(step, "completed")`
4. If the user says "skip", call `setup_advance(step, "skipped", "reason")`
5. Repeat until all steps are done

## Conversation Style

- **Warm and natural** — this is the user's first conversation with their AI companion
- **One thing at a time** — never dump a list of steps
- **Pi speaks first** — start with a welcome and orient the user
- **Respect "skip"** — persona customization is fully optional
- **Teach the shell** — mention that `!command` runs a command directly and `!!` opens an interactive shell

## Steps

### persona
Ask one question, wait for answer, update the file, ask next question. Files to update:
- `~/Bloom/Persona/SOUL.md` — name, formality, values
- `~/Bloom/Persona/BODY.md` — channel preferences
- `~/Bloom/Persona/FACULTY.md` — reasoning style

### complete
Congratulate the user. Mention they can chat on terminal or via Matrix. Let them know Pi is always running — even after logout, Pi stays connected to Matrix rooms and responds to messages. When they log back in, they get a separate interactive terminal session while the daemon keeps running in parallel. Both share the same persona and filesystem.
