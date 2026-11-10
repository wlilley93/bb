# Linear

A workspace admin connects Linear once, with OAuth. The page opens on the current seat: a PM's team, or a VP's initiative. Filter, sort, and display narrow the list. An issue page shows the description, activity, and properties. Agents read and write issues, initiatives, and projects. A personal API key is not pasted.

## What the seats are

- A VP is a Linear initiative. In that VP's thread, the info sidebar lists the initiative and its projects. Choosing a project opens that project's issues.
- A PM heads one Linear team. In that PM's thread, the info sidebar lists the team's recent issues.
- A head of an area sees that same team. In the Head of Projects thread, the info sidebar lists the Projects team.
- The seat's area is matched to the initiative or team name. `vp-projects` matches an initiative named Projects. `pm-delivery` matches a team named Delivery.

## Where the token lives

The refresh token is stored on this server, in `~/.config/boltrig/linear-connection.json`, mode 0600. It is not written into the company directory. That directory may be the copy on this server, or a SharePoint or Box folder that rsync keeps in step.

## Connect

1. Create an OAuth application in Linear. Set its redirect to the URI shown on the Linear page. That URI is built from `BB_APP_URL`.
2. Put the client id and client secret in the plugin settings, or in `BOLTRIG_LINEAR_CLIENT_ID` and `BOLTRIG_LINEAR_CLIENT_SECRET`.
3. Choose Connect Linear. A workspace admin approves the app. The actor is the app, so agents write as the application.

Scopes are `read`, `write`, `initiative:read` and `initiative:write`.

## Agent tools

`linear_teams`, `linear_initiatives`, `linear_projects`, `linear_issues`, `linear_issue`, `linear_create_issue`, `linear_update_issue`, `linear_comment`.

A tool returns an error when Linear is not connected. It does not return the token.
