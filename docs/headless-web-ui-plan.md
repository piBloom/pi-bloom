# Bloom Headless Web UI Plan (v0.1)

## Status
- **Owner:** Bloom core
- **Date:** 2026-03-05
- **Scope:** Build a **web UI only for headless mode** (no native desktop UI in v0.1)

---

## 1) Goal

Provide a simple, local-first UI for Bloom OS that works without HDMI, keyboard, or remote desktop.

Users should be able to:
- open Bloom from another device on the local network
- see what Pi is doing in real time
- approve/reject sensitive actions
- run core system operations (Wi-Fi setup, service checks, OS update flow)

---

## 2) Explicit Product Decision

For v0.1:
- ✅ Build **containerized web UI service** (`bloom-ui`)
- ✅ Keep Pi in control via a **bridge extension** (in-process)
- ✅ Support **headless-first usage**
- ❌ No native desktop app
- ❌ No GUI click automation (mouse/keyboard driving)

Pi performs real operations through system APIs/tools (NetworkManager, systemd, bootc), while the UI visualizes and confirms.

---

## 3) Architecture

## Components

1. **`bloom-ui` service (OCI package)**
   - Runs as Quadlet-managed container
   - Serves frontend over local HTTP(S)
   - Maintains WebSocket connection for live events

2. **`bloom-ui-bridge` extension (Pi process)**
   - Exposes UI-facing tools/events to Pi
   - Forwards system/action updates to UI
   - Handles confirmation requests from UI back to Pi

3. **Existing Bloom ops tools (source of truth)**
   - Wi-Fi/network via NetworkManager (`nmcli`/DBus wrappers)
   - Services via systemd tools
   - OS updates via bootc tools

## Data Flow

1. User opens web UI (`bloom.local`)
2. UI subscribes to Pi event stream (WebSocket)
3. Pi sends status + active action events
4. User confirms/rejects gated actions
5. Pi executes action via existing Bloom tools
6. UI shows progress and result in real time

---

## 4) UX Scope (v0.1)

## Screens

1. **System Overview**
   - host health summary
   - active services
   - last update check

2. **Action Timeline**
   - chronological list of Pi actions
   - status: queued/running/success/failed

3. **Confirmations**
   - pending approvals from Pi
   - explicit approve/reject controls

4. **Networking (minimal)**
   - current connection status
   - available SSIDs + connect flow (if backend support is ready)

## Must-have behaviors
- Real-time “Pi is doing…” feedback
- Clear confirmation dialogs for sensitive operations
- Friendly error states and retry actions

---

## 5) Security + Safety

- Local-first access only (LAN; optional Tailscale later)
- Pairing/auth required before control actions
- Sensitive operations require explicit confirmation:
  - reboot
  - rollback
  - apply OS update
  - service stop/disable/remove
  - network changes that can disconnect the device
- All sensitive actions logged in audit trail

---

## 6) Delivery Phases

## Phase 0 — Foundations

### Tasks
- Define `docs/ui-protocol.md` (message schema)
- Scaffold `services/ui/` package
- Add minimal `SKILL.md` for UI service behavior
- Install and run via Quadlet lifecycle

### Exit criteria
- `bloom-ui` starts reliably as service
- health endpoint reachable locally

---

## Phase 1 — Pi ↔ UI bridge

### Tasks
- Create extension skeleton for `bloom-ui-bridge`
- Implement event publish path (Pi -> UI)
- Implement confirmation response path (UI -> Pi)
- Add basic auth/session guard

### Exit criteria
- Pi can push live action status to UI
- UI can return confirmation decisions

---

## Phase 2 — Core operations in UI

### Tasks
- Integrate system overview (health + services)
- Add OS update flow view (check/download/apply)
- Add operation progress + result rendering

### Exit criteria
- One full loop works end-to-end:
  - user triggers/approves
  - Pi executes via existing tool
  - UI shows live progress + final outcome

---

## Phase 3 — Headless onboarding

### Tasks
- Add first-boot access guidance to UI
- Add basic Wi-Fi setup UI (if backend endpoints/tools are stable)
- Improve failure handling for network loss/reconnect

### Exit criteria
- A new device can be configured without HDMI

---

## 7) Technical Constraints

- Reuse Bloom service conventions (OCI package + Quadlet)
- Prefer pinned image tags/digests (avoid mutable `latest` in release path)
- Keep frontend lightweight for low-resource hardware
- Avoid introducing a separate control backend if existing Bloom tools suffice

---

## 8) Proposed Initial Backlog (Sprint-ready)

1. Create `docs/ui-protocol.md`
2. `service_scaffold` for `ui` service package
3. Implement `/health` + static shell UI
4. Implement WebSocket event feed from bridge
5. Build Action Timeline page
6. Build Confirmation panel
7. Wire one operation: `bootc_update(stage='check')`
8. Add audit logging for confirmation decisions

---

## 9) Open Questions

1. Should v0.1 expose HTTP only on localhost + reverse proxy, or directly on LAN?
2. Is TLS required in v0.1 LAN mode, or deferred to Tailscale/ingress setup?
3. Which frontend stack do we standardize on (SvelteKit vs React)?
4. Should Wi-Fi setup be included in v0.1 or v0.2 based on backend readiness?

---

## 10) Definition of Done (v0.1)

- Headless user can open Bloom UI from another device
- User sees Pi actions in real time
- Sensitive actions are confirmation-gated
- At least one system operation is fully controllable from UI
- Service is packaged/installable through Bloom service lifecycle
- Documentation is complete for install, run, and troubleshooting
