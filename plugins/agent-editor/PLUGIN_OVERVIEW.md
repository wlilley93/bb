# Agent Editor

Edit the company's words for a seat. The canon scaffolding stays read-only.

## Company root

One setting, shared with Company SOP Editor: the absolute folder that holds `Agent Operations`. Saving it creates that directory from the blank company pack when `Instructions/firm.md` is not already there, then seeds the OpenCode config. There is no screen for mapping domains or agents. The seats are the installed canon.

## What you can change

- A duty for an installed canon seat. The file records `seat: <canon id>` and the company's words. Render writes that text into the seat.
- A request for a head, VP, or PM the canon does not have. That writes `Roles/<id>.md` with `base` and `id`. The canon reports it and does not install a profile.
- A role. `base: subagent` is installed as a sealed subagent on render. `base: primary` is kept as a request and is not installed.

Mode, tier, rank, reach, permissions, and the doctrine are shown and never written by the editor.

## Render, then restart

The button runs the canon seed with `--company-root`. The seed reads `Duties/` and `Roles/` and writes the OpenCode config. OpenCode restarts only when `BOLTRIG_OPENCODE_RESTART` names the command.
