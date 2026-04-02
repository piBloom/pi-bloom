# Fleet Change Workflow

Audience: maintainers using NixPI to prepare local repo changes for later human review and external publish.

## Why This Flow Exists

NixPI should be able to propose code and configuration changes locally without being able to publish them autonomously.

This keeps the useful part of agentic development:

- inspect the repo
- edit files locally
- run validation
- prepare a reviewable diff

while forcing the approval boundary to stay with the human and the external controller:

- human reviews the diff in VS Code or another editor
- human decides whether to commit and open a PR
- CI or a separate controller handles publish, merge, and rollout

## Local Proposal Flow

NixPI assumes the local working clone lives at:

- `/srv/nixpi`

Recommended workflow:

1. Ask NixPI to inspect the repo and prepare a local change.
2. Let NixPI edit files and run local validation such as:
   - `npm run build`
   - `npm run test:unit`
   - `npm run test:integration`
   - `npm run test:e2e`
3. Review the resulting diff in VS Code.
4. Decide whether to keep, revise, commit, or discard the change.
5. Use your normal git/GitHub workflow outside NixPI to publish the change.

## Reference

NixPI's role in this model:

- propose local edits
- explain what changed and why
- run local checks
- prepare code for human review

NixPI does not publish in this model:

- no remote push
- no PR creation
- no merge
- no rollout trigger

Current repo assumptions:

- local path is `/srv/nixpi`
- the clone is a working area for proposals and review
- remote publishing is handled by the human or an external controller

## Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
