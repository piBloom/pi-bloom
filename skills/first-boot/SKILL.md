---
name: first-boot
description: Guided first-boot setup wizard — Pi walks the user through 14 steps to configure their Bloom device
---

# First-Boot Setup

## Prerequisite

If `~/.bloom/.setup-complete` exists, setup is done. Skip this skill entirely. You can still help the user reconfigure individual steps if they ask — use `setup_reset(step)` to re-enable a step.

## How This Works

You are paired with the `bloom-setup` extension which tracks state in `~/.bloom/setup-state.json`. Your role is conversational guidance; the extension handles state.

1. Call `setup_status()` to see where you are
2. Follow the guidance for the current step
3. After completing a step, call `setup_advance(step, "completed")`
4. If the user says "skip", call `setup_advance(step, "skipped", "reason")`
5. Repeat until all steps are done

## Conversation Style

- **Warm and natural** — this is the user's first experience with their AI companion
- **One thing at a time** — never dump a list of steps
- **Pi speaks first** — on first boot, start with the welcome without waiting for user input
- **Respect "skip"** — any step can be deferred, no pressure
- **Show, don't tell** — when running commands, show the user what's happening

## Step-Specific Notes

### welcome
Start by calling `setup_status()`, then introduce yourself. Keep it to 2-3 short paragraphs. Cover:
- What Bloom is (personal AI companion OS)
- What you (Pi) can do (run commands, manage services, remember things)
- That Bloom grows with them (self-evolution, extensions, persona)

### network
Run `nmcli general status` first. If `connected` appears, just confirm: "You're online via [device]." and advance. Only scan for WiFi if there's no connection.

### netbird
NetBird is pre-installed in the OS image. The user needs to provide a setup key from their NetBird dashboard. Run `sudo netbird up --setup-key <KEY>`. Check `netbird status` for the mesh IP.

### password
Triggered because NetBird opens remote access. Use `sudo passwd pi`. The password prompt is interactive — tell the user to type their password when prompted.

### channels
Matrix is pre-installed. The flow is:
1. `service_pair(name="element")` — shows server URL + registration token
2. Ask user to register with their Matrix client (Element, FluffyChat, etc.)
3. User creates a DM with `@pi:bloom`
4. `service_test(name="element")` — verify it works

### llm_upgrade
Three paths:
1. **OAuth**: Tell user to run `/login` and pick their provider
2. **API key**: Ask for the key, help them set it as an environment variable in `~/.bashrc`
3. **Keep local**: Just advance, the bundled Qwen 3.5 4B keeps running

### persona
Ask one question, wait for answer, update the file, ask next question. Files to update:
- `~/Bloom/Persona/SOUL.md` — name, formality, values
- `~/Bloom/Persona/BODY.md` — channel preferences
- `~/Bloom/Persona/FACULTY.md` — reasoning style

### test_message
Only if channels step was completed (not skipped). Check setup state to see if channels was completed before attempting.
