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

## Chat window chrome and the Info pane (0.2.0)

`seat-sidebar.tsx` restyles the composer footer (model, effort, permission and a context ring on one line), the tab strip, and the top-bar Terminal and Info buttons, and keeps the two right-hand panes separate:

- Info and Terminal toggle their own pane. When the thread area is wide enough for 340 px of Info beside 320 px of Terminal with a 320 px chat column, both show side by side (Info 340 px, Terminal takes the rest). On a narrower window the buttons switch between the two panes instead, so neither is ever squeezed into a rail.
- `context-info.tsx` registers the Environment, Context and Usage sections of the Info pane. A provider that reports only a total (OpenCode over ACP) gets an estimated breakdown from `estimateContext`: the AGENTS.md chain, config instructions, skills and the agent roster are measured from the files at about 4 characters per token, and the remainder is shown as "Messages, tool output and system prompt". The total comes from the provider and is not estimated.
- `modelVision` answers whether the selected model accepts images (models.dev catalogue cached for 24 hours in `~/.cache/boltrig/model-vision.json`, plus a list of rejections seen in the field). The composer shows a warning and blocks send while an image is attached to a model that cannot read it.

### Installing and updating on a client machine

Layer: bb plugin only. Nothing in the bb core, the OpenCode config or the Boltrig kit has to change for this plugin.

1. On the build machine: `pnpm exec vitest run --config vitest.config.ts` here, then `bb plugin build plugins/agent-editor`. That writes a self-contained `dist/` (server.js, app.js, app.css and their meta files).
2. Package the folder holding `package.json` and `dist/` (the sources are not needed) and copy it to the client machine.
3. On the client machine: `bb plugin install <folder> --yes`. To update: replace the folder with the new build and run `bb plugin reload boltrig-agent-editor`; `bb plugin list` shows the version (0.2.0).
4. A `git:` install from this monorepo is not ready: the devDependencies use `workspace:*`. It needs the plugin in its own repository with the SDK pinned (`bb plugin types`).

The rewriting of raw provider errors lives in bb core (`packages/thread-view`, branch `boltrig/friendly-provider-errors`) and reaches a client only with a bb build that contains it; the stock npm bb-app does not have it.
