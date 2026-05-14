# Git server runbook

Git is served directly from the Nazar host via SSH bare repos. No web UI, no database.

## Layout

- Host: `nazar` / `10.44.0.1` (private/sshuttle)
- User: `alex` (standard SSH on port 22)
- Repository root: `/persist/git/repositories`
- Default namespace: `/persist/git/repositories/nazar`
- Compatibility symlink: `/nazar -> /persist/git/repositories/nazar`

## Access

Admin SSH keys are declared in `nix/users/admin-keys.nix` and written to `/etc/ssh/authorized_keys.d/alex` by NixOS. Git operations use the `alex` user over standard SSH (port 22).

Keep `git.nazar.studio` private behind sshuttle.

## Creating a repository

On the host:

```bash
sudo nazar-git-init nazar/new-repo.git
# or, for the default nazar namespace:
sudo nazar-git-init new-repo
```

From a client:

```bash
git remote add origin ssh://alex@git.nazar.studio/nazar/new-repo.git
git push -u origin main
```

## Validate

```bash
git ls-remote ssh://alex@10.44.0.1/nazar/nazar.git
git ls-remote ssh://alex@git.nazar.studio/nazar/nazar.git
```
