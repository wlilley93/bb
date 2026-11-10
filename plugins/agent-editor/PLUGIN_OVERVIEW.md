# Boltrig Company SOP

# Boltrig Company Agents

by Boltrig.ai

One settings page for the seats and the SOP. The canon scaffolding stays read-only.

## Company root

One folder, the absolute path that holds `Agent Operations`. Saving it creates that directory from the blank company pack when `Instructions/firm.md` is not already there, then seeds the OpenCode config. There is no screen for mapping domains or agents. The seats are the installed canon.

## Boltrig Company Agents

- A duty for an installed canon seat. The file records `seat: <canon id>` and the company's words. Render writes that text into the seat.
- A request for a head, VP, or PM the canon does not have. That writes `Roles/<id>.md` with `base` and `id`. The canon reports it and does not install a profile.
- A role. `base: subagent` is installed as a sealed subagent on render. `base: primary` is kept as a request and is not installed.

Mode, tier, rank, reach, permissions, and the doctrine are shown and never written by the editor.

## Boltrig Company SOP

The same page edits `Instructions/firm.md`, `Instructions/people.md`, `References/`, `policies/POLICY-REGISTER.md`, `LINEAR.md`, `Roles/`, `Playbooks/`, and `Duties/`.

`firm.md` is the short text every turn. Saving a reference adds or updates its line in that file's index. An agent loads a playbook, skill, or reference only when an index line names it.

Saving a file updates its provenance line. A change that needs a permission is a new row in the policy register. The editor does not write a permission header.

## Render, then restart

The button runs the canon seed with `--company-root`. The seed reads `Duties/` and `Roles/` and writes the OpenCode config. OpenCode restarts only when `BOLTRIG_OPENCODE_RESTART` names the command.
