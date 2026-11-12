# Codegeist 2026 submission: Understudy

Text to paste into the Devpost form. All submission material must be in English (Official Rules, Language Requirements).

---

## Project name

Understudy

## Elevator pitch (short tagline)

Going away? Understudy hands your Jira work to the right people with the context and the reasons, flags what only you know, and catches you up when you're back.

## Category

**Apps for Business Teams.** Handovers before leave are a people problem every team has (finance, ops, support, engineering). Examples of work it handles: a month-end close, vendor contracts, tax exports, onboarding. The demo data mixes that kind of work ("Quarter-end tax export for Finance", "Update the refund policy page", "Archive closed chargeback disputes") with code.

**Who it's for.** Anyone in a business team whose work lives in Jira and who goes on leave or covers for someone: a finance lead handing over the quarter-end close, an HR operations specialist before parental leave, a support team lead before a conference. And their managers, who can build the handover for a teammate, see who covers what, and find the work only one person knows before anyone goes away.

## Bonus prizes to tick

The rules allow one Grand Prize plus one Bonus Prize per submission, and the Devpost form takes **one** bonus prize. The draft picks **Best Agents (Rovo)**, the strongest and fully live part; the other two below are still worth describing in the story:

- **Best Agents (Rovo).** Forge `rovo:agent` with eight `action` modules and three reusable `rovo:skill` modules (`handover-planner`, `welcome-back`, `knowledge-risk`) that other agents can load.
- **Best app with Atlassian MCP.** `rovo:mcp` exposes the eight actions as tools; the three `SKILL.md` files in the repo are open-source skill files users can add to third-party agents.
- **Best apps with Teamwork Graph integration.** Queries the Teamwork Graph API through five curated queries: teams, team members, pull requests (the user's, and those linked to each work item), and goals and projects. Each source reports its own state. On the Forge demo site used for the video the graph returned no data for the fictional users, so the demo does not show graph evidence.

## Installation link

Distribution is set to "Sharing with anyone" (production environment, Jira, with Confluence as an optional connection). Copy the link with the copy icon in developer.atlassian.com › Console › Understudy › Distribution › Installation link, and paste it here and in the Devpost form.

## Try it out links

- Code: https://github.com/tapaderuza/understudy
- Privacy policy: https://github.com/tapaderuza/understudy/blob/main/PRIVACY.md

## Demo video (YouTube, public, under 5 minutes)

https://youtu.be/SRo6VDJBfxs (public, 3:05). It shows the whole app live, including Team risk.

## About the project

- **What it is:** a Forge app for Jira and Confluence, with a Rovo agent and an MCP server, that plans a handover before someone goes away and catches them up when they are back.
- **Who it is for:** anyone in a business team whose work lives in Jira and who goes on leave or covers for someone, and the managers who plan that cover.
- **What is new:** a stand-in for each work item with evidence anyone can check, a warning for the work only one person knows, and a Team risk view that finds those single points of knowledge across a team before anyone leaves.

### Inspiration

Every team has the same Thursday-before-leave ritual: a rushed handover doc, a list of tickets, and a vague "ping Ben if anything breaks". It misses the one thing only you understood, it buries the most experienced person, and nobody tells the stand-ins why they were picked. Then you come back and spend a morning reconstructing what happened.

The context to do this well already exists in Atlassian: who commented on what, who works in the same epic and components, who is on your team, which pull requests are open, which goals your work rolls up to. Codegeist asked us to turn that connected context into confident decisions. A handover is exactly that decision.

### Why it matters

Handovers weigh on people before and after leave. [46% of US workers with paid time off take less than they are offered, and 43% of them would feel bad about coworkers taking on extra work](https://www.pewresearch.org/social-trends/2023/03/30/how-americans-view-their-jobs/) (Pew Research Center, 2023). Coming back is slow: [53% of knowledge workers need three or more days to feel caught up after time off](https://finviz.com/news/387479/zoom-study-reveals-inbox-anxiety-is-the-hidden-cost-of-vacation) (Zoom and Morning Consult, 2026; a vendor-commissioned survey). And what a rushed handover loses is often held by one person: [42% of institutional knowledge is unique to the person in the role](https://www.hrdive.com/news/inefficient-knowledge-sharing-costs-large-us-businesses-47m-a-year/527892/) (Panopto and YouGov, 2018, via HR Dive). Understudy works on all three: it spreads the cover so nobody is buried, flags the knowledge only you hold, and shows what needs you first when you return.

### What it does

**Before you go.** Pick a person and dates. Understudy reads their open Jira work and ranks it by what must be covered: overdue, due while away, blocked, high priority, open pull request, someone waiting for a reply, in progress. For example, with Ada Isadora away from 12 Nov 2026 to 14 Nov 2026 on the demo site, the headline reads: "Ada Isadora has 7 open items: 4 must be covered from 12 Nov 2026, 2 fall due by 14 Nov 2026, 1 already overdue, 1 only Ada Isadora has context on." For each item it suggests a stand-in **with the evidence**. An illustrative example of those evidence lines (not taken from the video): "Commented 2 times on this item (+6), worked on 2 other items in Refunds v2 (+6), knows the Payments component (+1), already carries 9 open items (−2)". It assigns items in order of urgency and counts each assignment against that person's load, so the plan spreads work instead of burying the expert.

It also flags **work only you have context on**: items where nobody else has 3 or more points of evidence, because nobody else has commented or worked nearby. Those need a 15-minute walkthrough before you leave, not a reassignment, and that is the knowledge most handovers lose.

Then one click briefs every stand-in (or one at a time): a comment on the work item that @-mentions them with what they cover, why it matters and why they were picked, and adds them as a watcher. Briefing the same stand-in again updates your earlier briefing comment instead of adding a duplicate. Another click publishes the whole handover as a Confluence page.

**Welcome back.** When you return, Understudy shows what other people did on your work since your first day away (status changes, reassignments, comments), with what needs you first: mentions, items handed to you, replies waiting. It recognizes its own briefings, so it can tell you which stand-in covered what.

**Team risk.** Before anyone goes away, a manager or team lead picks up to 5 projects. Understudy checks every open assigned work item (up to the 100 most urgent) with the same evidence as a handover and finds the single points of knowledge: items where nobody else has 3 or more points of evidence. On the demo site, for PAY, OPS and FIN: "Only one person has context on 3 of the 14 open items in PAY, OPS, FIN, 2 of them due or urgent in the next two weeks. Ryan Lee holds the most: 2 of 2 items." Cover readiness, the share of open work someone else could pick up today, is 79%.

The view shows tiles (open items checked, only one person knows, of those urgent soon, people with open work), a stacked bar chart "Who holds knowledge alone", a table "Work only one person knows" with the closest colleague and their evidence, and a People table with each person's cover readiness and best backup ("Could cover 3 of 5 today"). **Request walkthrough** posts a comment on the work item that @-mentions the owner, asks for a 15-minute walkthrough with the chosen colleague and adds the colleague as a watcher; the row then shows "Walkthrough asked for *name*". Nothing is reassigned, and the comment, signed "Requested with Understudy.", never counts as evidence.

The handover warning counts only work that must be covered while someone is away, and the team view counts every open item, including work that can wait, so its numbers can be higher.

**Everywhere you work:**
- a Jira page with three tabs, *Before you go*, *Welcome back* and *Team risk*;
- an Understudy panel on every work item: "If Ada is away, who could cover this?";
- a Rovo agent ("Prepare my handover for next week", "I'm back, what needs me first?", "Where is our team's knowledge held by one person?");
- an MCP server with eight tools and three open skills, so a team's own Rovo Studio agents, or Claude and other MCP clients, can plan handovers too.

**How it differs:**
- Out-of-office apps on the Marketplace make you name a coverer in advance and then reassign by rule; Understudy suggests a stand-in for each work item from evidence anyone can check in Jira, and shows why.
- Rules move tickets; Understudy changes no assignee. It finds the work only you understand, so it gets a walkthrough instead of a silent reassignment, and spreads the load so your one expert is not buried.
- Chat assistants summarize what you missed after you return; Understudy plans the cover before you leave, briefs each stand-in on the work item itself, publishes the handover page, and then closes the loop when you are back.
- Out-of-office apps act once someone is away; none we found on the Marketplace shows a team's single points of knowledge before anyone leaves. Understudy's Team risk tab does, and turns each one into a walkthrough request.

### How we built it

- **Forge**, runtime `nodejs24.x`, UI Kit for the Jira global page (three tabs, with a UI Kit bar chart on Team risk) and the issue panel.
- **Rovo:** `rovo:agent` with a prompt resource, eight `action` modules, and three `rovo:skill` modules (`handover-planner`, `welcome-back`, `knowledge-risk`) whose `SKILL.md` playbooks follow the Agent Skills format. The actions are `get-handover-brief`, `suggest-stand-ins`, `publish-handover-page`, `brief-stand-in`, `brief-all-stand-ins` (briefs every stand-in in the plan with one confirmation), `get-welcome-back-brief`, `get-team-knowledge-risk` (input `projects`, comma-separated keys; empty means the projects of the current user's open work) and `request-walkthrough` (inputs `issueKey`, `learner`, `note`). `publish-handover-page` and `brief-all-stand-ins` accept `standIns` ("PAY-3=Max Taylor; PAY-5=Cassi Owens"), so a plan edited in chat is what gets published and briefed.
- **MCP:** `rovo:mcp` exposes the same eight actions as tools for Rovo Studio and for external MCP clients.
- **Teamwork Graph API:** curated queries `atlassianUserInTeams` and `atlassianTeamMembers` (who is on the person's teams), `atlassianUserPullRequests` and `jiraWorkItemLinkedExternalPullRequests` (the user's pull requests and those linked to each work item, batched with GraphQL aliases) and `atlassianUserGoalsAndProjects` (what the work rolls up to). Each query has a plainer fallback, and each source reports its own state (connected, no data, not available), so missing scopes or an empty graph never fail the handover. On the Forge demo site used for the video, the graph returned no data for the fictional users and intermittently refused reads with "User is not permitted to query this organization" (a known demo-site issue, reported on the Atlassian developer community). The app now retries that error up to 3 times with backoff and then shows "Teamwork Graph no data" honestly; the demo does not show graph evidence.
- **Jira and Confluence REST:** enhanced JQL search (with changelogs for Welcome back), ADF comments with mentions (a repeat briefing updates the earlier comment), watchers, CQL page search, and v2 pages to publish.
- **Design for trust:** every call runs as the user (`asUser`), the graph is read-only, nothing is stored, nothing leaves Atlassian, and Understudy only writes (a comment, a watcher, a page) after a person confirms. Agent inputs come from an LLM, so identity always comes from the invocation context, and every key and account ID is validated before it reaches JQL.
- **Quality:** the scoring, planning, team-risk, rendering and parsing logic is pure TypeScript with 80 unit tests. We checked every REST endpoint we call against Atlassian's published OpenAPI specs to keep the scope list minimal and complete, and then tested every surface live on a Forge demo site with 25 projects and thousands of work items.

### Challenges we ran into

- **Explaining, not just ranking.** A single score nobody could question was not trustworthy. We built the scoring so every point is a sentence a teammate can verify in Jira, and the UI and agent always show those reasons.
- **The expert problem.** Pure "who knows most" sends everything to one person. Processing items by urgency and charging each assignment to the stand-in's load produces plans that spread the work.
- **Empty graphs.** A missing Teamwork Graph scope returns success with no rows, and on the demo site some reads were intermittently refused with "User is not permitted to query this organization". Each source reports its own state (connected, no data, not available), and that refusal is retried, so users and the agent can be honest about gaps.
- **Real data is messier than test data.** Testing on Atlassian's demo site found what unit tests could not. One person there has 2,447 open items, so Understudy now plans the 100 most urgent and says so. A single load search let that person use up the result limit and made everyone else look idle, so load is now counted per person. Automation for Jira, service desk customers and deactivated accounts were showing up as possible stand-ins, and Understudy's own briefing comments counted as the sender knowing the work; all of that is filtered now. And when everyone who knows an item is already overloaded, Understudy no longer suggests the least-bad option: it asks a person to decide.

### Accomplishments that we're proud of

- The "only you know this" warning: the part of a handover that usually gets lost, found automatically.
- A team view that finds single points of knowledge before anyone goes away, from the same evidence as a handover, and turns each one into a walkthrough request instead of a reassignment.
- One engine behind four surfaces (page, issue panel, Rovo agent, MCP), so they always agree.
- A complete loop: hand over, brief, publish, and hand back.
- Every surface was exercised live on an Atlassian demo site: the Jira page, the work item panel, the Rovo agent, and the MCP tools from an external client (MCP Inspector) through Atlassian's MCP server. The Teamwork Graph queries are implemented and degrade gracefully: on the demo site the graph had no data for the fictional users and intermittently refused reads, and the app says so in its sources line instead of hiding it.

### What we learned

Context only builds confidence when people can see where it came from. Evidence lines change how a suggestion reads: from "the AI says Ben" to "Ben commented twice on this and owns the sibling ticket".

### What's next for Understudy

- Spot upcoming time off from calendar events in the Teamwork Graph and suggest starting a handover a few days ahead.
- Automation: run the handover agent from a Jira Automation rule when someone sets their status to away.
- A scheduled weekly knowledge-risk digest, so a team lead sees new single points of knowledge without opening the page.

## How the project meets the main technology requirement

Understudy is a Forge app (`manifest.yml`, runtime `nodejs24.x`) that integrates with Jira (global page, issue panel, JQL, comments, watchers), Confluence (page search and publishing), Rovo (agent, eight actions, three skills, MCP) and the Teamwork Graph API (five curated queries, read-only `read:graph:*` scopes).

## Testing instructions for judges

1. Install with the installation link on your Jira site, and connect Confluence on the same site when asked (optional: needed to publish pages).
2. As a site or org admin, open Atlassian Administration › Apps › Sites › *your site* › Connected apps › Understudy › Permissions and make sure the `read:graph:*` scopes are on.
3. Jira › Apps › Understudy › **Before you go**: keep yourself or pick a teammate, choose dates, **Build handover**. Change a stand-in, press **Brief stand-in**, pick a space and **Publish handover page**.
4. Open any work item and expand the **Understudy** panel.
5. Jira › Apps › Understudy › **Welcome back**: choose a first day away and press **What changed?**
6. Jira › Apps › Understudy › **Team risk**: choose up to 5 projects and press **Check knowledge risk**. **Request walkthrough** on a row posts a comment on that work item.
7. Rovo chat › **Understudy** agent: try "Prepare my handover for next week" or "Where is our team's knowledge held by one person?".
8. Optional MCP: enable the tools for external clients in Connected apps, then connect an MCP client to `https://mcp.atlassian.com/forge/f822ce82-2fbb-4e00-878f-0798dda01b8c`.

Understudy works on any Jira site where people share projects, epics and components. For an empty development site, `scripts/seed-demo.mjs` creates a small fictional team's work to try it on.

## Built with

forge, ui-kit, rovo, rovo-agent, rovo-skill, rovo-mcp, teamwork-graph, graphql, jira, confluence, typescript, react, vitest

---

# Demo video

The demo video is https://youtu.be/SRo6VDJBfxs (3:05). It was recorded live on the Forge demo site with the fictional people that come with it (Ada Isadora, Max Taylor, Cassi Owens, Ryan Lee) and the projects PAY, OPS and FIN: the handover plan, briefing and publishing, Team risk with a walkthrough request, the work item panel, the Rovo agent, an external MCP client and Welcome back.
