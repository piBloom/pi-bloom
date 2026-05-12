# SOPS secrets

This directory is reserved for encrypted `sops-nix` files.

Rules:

- Commit encrypted files only.
- Never commit plaintext passwords, API tokens, overlay-network setup keys, Forgejo secrets, private SSH keys, or age identities.
- Replace the placeholder recipient in `.sops.yaml` before creating real encrypted files.
- Store the VM age identity/recovery material in the external password/secret store.

Planned first secret:

```text
/run/secrets/forgejo-admin-password
```

That secret can be wired to `sops.secrets.forgejo-admin-password` later. Until it exists, `forgejo-bootstrap.service` safely skips admin creation.
