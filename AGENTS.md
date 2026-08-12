# WordInk agent workflow

## Isolate each new request

For every new user request, begin work in a **new Git worktree**. Create the
worktree from the current default branch (normally `main`) and create a new
topic branch at the same time. Do not make task changes in the primary
checkout or reuse a prior task's worktree unless the user explicitly asks to
continue that exact task.

- Name branches with the `codex/` prefix and a short, descriptive kebab-case
  slug, for example `codex/improve-share-copy`.
- Before creating the worktree, confirm the primary checkout is clean; never
  overwrite, reset, stash, or otherwise disturb a user's existing changes.
- Keep the worktree outside this repository's primary checkout and use its
  path for all task edits, tests, commits, and Git commands.

## Publish completed work

When the user asks to commit or publish changes, or when completing an
implementation request where publishing is in scope:

1. Review the diff and run the relevant checks.
2. Commit only the files belonging to the request, on that task's topic
   branch.
3. Push the branch to `origin`.
4. Create a pull request against `main` whenever GitHub access is available.
   Use a draft PR unless the user explicitly requests a ready-for-review PR.

If a commit, push, or PR cannot be completed (for example, missing GitHub
authentication or required user approval), clearly report what was completed
and the exact blocking step. Do not force-push and do not commit unrelated
work.
