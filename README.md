# Understudy

**Hand over your work without losing its context.**

When someone goes on holiday, parental leave or a conference, their work doesn't stop needing them. Today the handover is a rushed doc written the night before: it misses the item only they understood, it dumps everything on the one expert, and nobody tells the stand-ins *why* they were picked. When the person comes back, they spend a morning reconstructing what happened.

Understudy is a Forge app for Jira and Confluence, with a Rovo agent, that uses Atlassian's connected context (Jira, Confluence and the Teamwork Graph) to plan the handover and the handback:

- **Before you go:** it ranks your open work by what must be covered, suggests a stand-in for each item with the evidence for that choice, spreads the load so the expert is not buried, and flags the work **only you have context on**. One click briefs each stand-in on the work item; another publishes the handover page in Confluence.
- **Welcome back:** it shows what changed on your work while you were away, with the items that need you first (mentions, items handed to you, replies waiting) and which stand-in covered what.

It works in four places: a Jira page, a panel on every work item, a Rovo agent with two reusable skills, and an MCP server that any MCP client can call.

---

## What it does

| Where | What you get |
| --- | --- |
| **Jira › Apps › Understudy › Before you go** | Pick a person and dates. See the headline ("Ana has 7 open items: 3 must be covered from 1 Dec, 2 fall due before 5 Dec, 1 only Ana has context on"), the cover plan, who covers what, code in flight, goals, pages. Change any stand-in, brief them, publish the page. |
| **Jira › Apps › Understudy › Welcome back** | What changed since your first day away, needs-you items first, and who covered what. |
| **Work item › Understudy panel** | "If Ana is away, who could cover PAY-101?" Top three people with reasons, one-click briefing. |
| **Rovo chat › Understudy agent** | "Prepare my handover for next week", "Who should cover this?", "I'm back, what needs me first?" |
| **Rovo Studio and MCP clients** | Five tools (`get-handover-brief`, `suggest-stand-ins`, `publish-handover-page`, `brief-stand-in`, `get-welcome-back-brief`) and two open `SKILL.md` playbooks. |

### Evidence, not magic

Every suggestion comes with reasons a person can check in Jira. Points per candidate and work item:

| Evidence | Points |
| --- | --- |
| Commented on this work item | 3 per comment, up to 9 |
| Reported it | 2 |
| Worked on other items in the same epic or parent | 3 each, up to 6 |
| Works on the same components | 1 each, up to 3 |
| Works with the same labels | 1 each, up to 2 |
| Recent items in the same project | 1 each, up to 3 |
| In one of the person's Atlassian teams (Teamwork Graph) | 1 |
| Already carries more than 5 open items | −0.5 per extra item, up to −6 |

Items are handled in order of urgency (overdue, due while away, blocked, high priority, open pull request, someone waiting for a reply, in progress), and every assignment adds to that stand-in's load, so the plan balances itself. An item whose best stand-in has fewer than 3 points of context is flagged as **only you know this**: it needs a walkthrough, not just a reassignment. When everyone with context is already overloaded (load penalty larger than their context), Understudy suggests nobody and asks a person to pick.

Only active people count: apps such as Automation for Jira, service desk customers and deactivated accounts are never suggested, and Understudy's own briefing comments are not counted as evidence. When someone has more open items than Understudy reads at once (100), the plan covers the most urgent ones and says so.

## How it is built

```
            Jira page (UI Kit)     Work item panel (UI Kit)     Rovo agent + 2 skills     MCP clients
                    │                        │                           │                     │
                    └──────── resolvers ─────┘                           └────── 5 actions ────┘
                                       │                                          │
                                       └──────────────── service.ts ──────────────┘
                                                            │
                          ┌─────────────────────────────────┼─────────────────────────────┐
                    core/ (pure, tested)              adapters/gather.ts              adapters/twg.ts
              risk · stand-ins · plan · render     Jira REST · Confluence REST     Teamwork Graph curated
                                                                                  queries (asUser)
```

- **Forge modules:** `jira:globalPage`, `jira:issuePanel`, `rovo:agent`, `rovo:skill` ×2, `rovo:mcp`, `action` ×5. Runtime `nodejs24.x`.
- **Teamwork Graph API** (curated queries, no Cypher to register): the person's teams and teammates (`atlassianUserInTeams`, `atlassianTeamMembers`), pull requests (`atlassianUserPullRequests`), pull requests linked to each work item (`jiraWorkItemLinkedExternalPullRequests`, batched with aliases), and goals and projects (`atlassianUserGoalsAndProjects`). Each query has a plainer fallback, and a missing scope degrades to "not available" instead of failing the handover.
- **Jira REST:** enhanced JQL search (with `expand=changelog` for Welcome back), users, comments with @-mentions in ADF, watchers.
- **Confluence REST:** CQL search for recent pages, v2 spaces and pages to publish the handover.
- **Everything runs as the user** (`asUser`), so nobody sees work they couldn't already open. The graph is read-only. Understudy writes only when a person confirms: a comment, a watcher, or a page. It stores nothing and calls no external service. Details in [PRIVACY.md](PRIVACY.md).

## Install and test (for judges)

1. Open the installation link from the Devpost submission and install Understudy on your Jira site. When asked, also connect it to Confluence on the same site (optional: needed only to publish handover pages and list recent pages).
2. **Grant the Teamwork Graph scopes** (site or org admin): Atlassian Administration › Apps › Sites › *your site* › Connected apps › Understudy › Permissions, and make sure the `read:graph:*` scopes are on. Without them the app still works from Jira and Confluence, and shows "Teamwork Graph: not available".
3. In Jira, open **Apps › Understudy**. On **Before you go**, keep yourself (or pick a teammate) and dates, then **Build handover**.
4. Open any work item and expand the **Understudy** panel.
5. Open **Rovo chat**, choose the **Understudy** agent and try a conversation starter.
6. Optional, MCP: Atlassian Administration › Apps › Sites › *your site* › Connected apps › Understudy › turn on the tools for external MCP clients, then add `https://mcp.atlassian.com/forge/<appId>` to your MCP client. The two playbooks in [`skills/`](skills) can be given to that client as skills.

Need data? `scripts/seed-demo.mjs` creates a small fictional team's work on a development site (three projects, an epic, due dates relative to today, a blocking link and comments). Read its header, then run it with your own API token.

## Develop

Requirements: Node.js 22.23.4+ or 24.22.1+ for the latest Forge CLI (this repo pins `@forge/cli` 14.2.0, which runs on Node 20.18+), and an Atlassian account.

```bash
npm install
npm run check          # TypeScript + 37 unit tests
npx forge login        # your Atlassian email and API token
npx forge register     # writes the real app id into manifest.yml
npx forge deploy
npx forge install --site <your-site>.atlassian.net --product jira
npx forge install --site <your-site>.atlassian.net --product confluence   # optional
```

`src/core` holds the logic with no Forge imports, tested in `test/`. `src/adapters` talk to Atlassian APIs, `src/service.ts` composes them for both the UI resolvers and the Rovo actions.

## Licence

MIT
