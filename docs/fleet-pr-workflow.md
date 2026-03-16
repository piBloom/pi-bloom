# Fleet PR Workflow

> 📖 [Emoji Legend](LEGEND.md)

Audience: maintainers contributing from a Bloom device.

## 🌱 Why This Flow Exists

Bloom assumes the on-device clone participates in a fork-and-PR workflow rather than direct pushes to `main`.

This keeps device-side contribution aligned with the repo tooling shipped in Bloom.

## 🚀 How To Contribute From A Device

Bloom assumes the repo clone used for contribution lives at:

- `~/.bloom/pi-bloom`

Supported repo tools:

- `bloom_repo`
- `bloom_repo_submit_pr`
- `bloom-dev` PR helpers for pushing skills, services, and extensions

Recommended flow:

1. authenticate GitHub on the device
2. configure the clone and remotes
3. inspect repo status
4. sync from upstream
5. make and validate changes
6. submit a PR

Example commands:

```bash
gh auth login
gh auth status
cd ~/.bloom/pi-bloom
npm run build
npm run check
npm run test
```

Tool calls:

```text
bloom_repo(action="configure", repo_url="https://github.com/alexradunet/piBloom.git")
bloom_repo(action="status")
bloom_repo(action="sync", branch="main")
bloom_repo_submit_pr(title="docs: ...")
```

## 📚 Reference

`bloom_repo` actions:

- `configure`
- `status`
- `sync`

Current repo assumptions:

- local path is `~/.bloom/pi-bloom`
- `upstream` is the canonical repo
- `origin` is the writable fork or alternative push target

`bloom_repo_submit_pr` behavior:

- confirms with the user
- verifies git and GitHub auth state
- can optionally stage all changes via `add_all=true`
- creates or switches to the target branch
- commits staged changes
- pushes to `origin`
- creates a PR against `upstream`

## 🔗 Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
