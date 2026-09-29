# Global agent instructions

## Habits

- Make precise, minimal changes; leave formatting to the repo's canonical
  formatters rather than restyling untouched code.
- After editing a repo, run its verification/tests if any exist before
  reporting done; never claim success while checks fail.

## Pi configuration layout

- This agent setup — the global `AGENTS.md`, skills, and extensions — is
  managed by the pi-shop repository. Don't edit files under `~/.pi/`
  directly; change the pi-shop repo and reapply it (`./install.sh`, or a
  NixOS rebuild on machines that consume it declaratively).
- `~/.pi/agent/settings.json`, `auth.json`, and sessions are pi's own
  mutable state — pi rewrites them freely; leave them alone.
