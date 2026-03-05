# Fleet Bootstrap Checklist (Per New Bloom Device)

Use this checklist to make a fresh piBloomOS machine PR-ready against:

- Canonical repo: `https://github.com/pibloom/pi-bloom.git`
- Local clone path: `~/.bloom/pi-bloom`

## A) One-time repo governance (maintainer)

- [ ] Protect `main`
- [ ] Require pull requests before merge
- [ ] Require PR checks to pass (`PR Validate`)
- [ ] Require at least one approval
- [ ] Disable force-push on protected branches

## B) New device bootstrap (operator)

### 1) Authenticate GitHub

```bash
gh auth login
gh auth status
```

### 2) Configure repo/remotes from Bloom

Use Bloom tools:

1. `bloom_repo_configure(repo_url="https://github.com/pibloom/pi-bloom.git")`
2. `bloom_repo_status`
3. `bloom_repo_sync(branch="main")`

If you already have a specific fork URL, set it explicitly:

- `bloom_repo_configure(repo_url="https://github.com/pibloom/pi-bloom.git", fork_url="https://github.com/<your-user>/pi-bloom.git")`

### 3) Verify PR readiness

`bloom_repo_status` should show:

- repo path exists (`~/.bloom/pi-bloom`)
- upstream and origin are configured
- GitHub auth is OK
- PR-ready = yes

## C) First dry-run PR (recommended)

1. Make a tiny docs change in `~/.bloom/pi-bloom`
2. Run local validation:

```bash
cd ~/.bloom/pi-bloom
npm run build && npm run check
```

3. Submit via tool:

- `bloom_repo_submit_pr(title="docs: dry-run fleet bootstrap validation", body="Initial validation from new device.")`

4. Confirm PR appears in `pibloom/pi-bloom` and CI passes.

## D) Ongoing per-fix flow

1. `bloom_repo_status`
2. `bloom_repo_sync(branch="main")`
3. implement fix + test (`npm run build && npm run check`)
4. `bloom_repo_submit_pr(...)`
5. merge after review + CI

That keeps `pibloom/pi-bloom` as the single source of truth for all devices.
