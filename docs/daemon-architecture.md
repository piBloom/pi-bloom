# Daemon Architecture

> 📖 [Emoji Legend](LEGEND.md)

Audience: maintainers changing daemon behavior or diagnosing room-runtime issues.

## 🌱 Why The Daemon Exists

`pi-daemon.service` is nixPI's always-on room runtime.

It exists to:

- bridge Matrix rooms into Pi sessions
- preserve room continuity outside interactive local sessions
- support simple default-host deployments and optional multi-agent overlays
- schedule proactive turns without external orchestration

## 📡 How The Daemon Works

nixPI runs through one supervisor/runtime path:

- if valid agent overlays exist, it uses those Matrix identities
- if no valid overlays exist, it synthesizes a default host agent from the primary Pi account
- session management is always one Pi session per `(room, agent)`

At startup:

1. nixPI loads `~/Workspace/Agents/*/AGENTS.md`
2. if no valid overlays exist, the daemon synthesizes a default host agent from the primary Pi credentials
3. malformed overlays are skipped with warnings instead of aborting startup

### Runtime Path

Primary files:

- [`../core/daemon/multi-agent-runtime.ts`](../core/daemon/multi-agent-runtime.ts)
- [`../core/daemon/agent-supervisor.ts`](../core/daemon/agent-supervisor.ts)
- [`../core/daemon/router.ts`](../core/daemon/router.ts)
- [`../core/daemon/room-state.ts`](../core/daemon/room-state.ts)

Current behavior:

- one Matrix client per configured or synthesized agent identity
- one Pi session per `(room, agent)`
- routing based on host mode, the first eligible explicit mention, cooldowns, and per-root reply budgets
- supervisor shutdown suppresses fresh message and proactive dispatch

### Proactive Jobs

Agent overlays may declare proactive jobs in frontmatter:

```yaml
proactive:
  jobs:
    - id: daily-heartbeat
      kind: heartbeat
      room: "!ops:workspace"
      interval_minutes: 1440
      prompt: |
        Review the room and host state.
        Reply HEARTBEAT_OK if nothing needs surfacing.
      quiet_if_noop: true
      no_op_token: HEARTBEAT_OK
    - id: morning-check
      kind: cron
      room: "!ops:workspace"
      cron: "0 9 * * *"
      prompt: Send the morning operational check-in.
```

Current rules:

- `heartbeat` jobs use `interval_minutes`
- `cron` jobs support `@hourly`, `@daily`, and fixed `minute hour * * *`
- proactive job ids must be unique per `(room, id)` within one agent overlay
- scheduler state is persisted per `(agent, room, job)`
- heartbeat failures back off by the configured interval instead of tight-loop retrying
- heartbeat replies can be suppressed when `quiet_if_noop: true` and the reply exactly matches `no_op_token`

### Cron Expression Support

The scheduler supports a subset of cron expressions:

| Expression | Description |
|------------|-------------|
| `@hourly` | Run at the start of every hour |
| `@daily` | Run at midnight UTC daily |
| `@weekly` | Run at midnight UTC on Sundays |
| `MM HH * * *` | Daily at specific minute and hour (UTC) |
| `MM HH * * D` | Weekly on specific day (0=Sunday, 1=Monday, ..., 6=Saturday) |

**Not supported**: Day-of-month and month fields must be `*`. Sub-hour intervals are not supported.

**Valid examples**:
```yaml
# Daily at 9:00 AM UTC
cron: "0 9 * * *"

# Daily at 2:30 PM UTC
cron: "30 14 * * *"

# Every hour (same as @hourly)
cron: "0 * * * *"

# Sundays at midnight (same as @weekly)
cron: "0 0 * * 0"

# Mondays at 9:00 AM UTC
cron: "0 9 * * 1"

# Weekdays at 9:00 AM UTC (configure 5 separate jobs)
cron: "0 9 * * 1"  # Monday
cron: "0 9 * * 2"  # Tuesday
# etc.
```

**Invalid examples**:
```yaml
# NOT SUPPORTED: specific day of month
cron: "0 9 15 * *"  # 15th of every month

# NOT SUPPORTED: specific month
cron: "0 9 * 1 *"  # January only

# NOT SUPPORTED: sub-hour intervals
cron: "*/5 * * * *"  # Every 5 minutes
```

All cron jobs run in UTC time.

### Rate Limiting and Circuit Breaker

Proactive jobs are protected by rate limiting and circuit breaker patterns:

| Feature | Default | Environment Variable |
|---------|---------|---------------------|
| Max jobs per hour per agent | 60 | `BLOOM_PROACTIVE_MAX_JOBS_PER_HOUR` |
| Circuit breaker threshold | 5 failures | `BLOOM_CIRCUIT_BREAKER_THRESHOLD` |
| Circuit breaker reset time | 60 seconds | `BLOOM_CIRCUIT_BREAKER_RESET_MS` |

**Rate limiting**: Each agent can execute at most N proactive jobs per hour. Excess jobs are dropped and logged.

**Circuit breaker**: If a proactive job fails 5 times consecutively, the circuit opens and no more proactive jobs run for that agent until the reset timeout expires. This prevents tight-loop retrying when a job is consistently failing.

States:
- `closed`: Normal operation, jobs execute
- `open`: Circuit is tripped, jobs are rejected
- `half-open`: After reset timeout, one job is allowed to test if the issue is resolved

## 📚 Reference

Important implementation files:

- [`../core/daemon/index.ts`](../core/daemon/index.ts): bootstrap and mode selection
- [`../core/daemon/contracts/matrix.ts`](../core/daemon/contracts/matrix.ts): Matrix bridge contract
- [`../core/daemon/runtime/matrix-js-sdk-bridge.ts`](../core/daemon/runtime/matrix-js-sdk-bridge.ts): Matrix SDK transport bridge
- [`../core/daemon/runtime/pi-room-session.ts`](../core/daemon/runtime/pi-room-session.ts): Pi SDK-backed session lifecycle
- [`../core/daemon/lifecycle.ts`](../core/daemon/lifecycle.ts): startup retry/backoff helper
- [`../core/daemon/scheduler.ts`](../core/daemon/scheduler.ts): proactive heartbeat and cron scheduling
- [`../core/daemon/proactive.ts`](../core/daemon/proactive.ts): proactive dispatch helpers

Important current failure behavior:

- startup uses retry/backoff instead of one-shot failure
- malformed agent overlays are skipped, not fatal
- duplicate-event and cooldown state is bounded and pruned over time

## 🔗 Related

- [../AGENTS.md](../AGENTS.md)
- [../ARCHITECTURE.md](../ARCHITECTURE.md)
- [service-architecture.md](service-architecture.md)
