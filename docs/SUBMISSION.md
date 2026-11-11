# Codegeist 2026 submission: Understudy

Text to paste into the Devpost form. All submission material must be in English (Official Rules, Language Requirements).

---

## Project name

Understudy

## Elevator pitch (short tagline)

Going away? Understudy hands your Jira work to the right people with the context and the reasons, flags what only you know, and catches you up when you're back.

## Category

**Apps for Business Teams.** Handovers before leave are a people problem every team has (finance, ops, support, engineering), and the demo shows finance and operations work as well as code.

**Who it's for.** Anyone in a business team whose work lives in Jira and who goes on leave or covers for someone: a finance lead handing over the quarter-end close, an HR operations specialist before parental leave, a support team lead before a conference. And their managers, who can build the handover for a teammate and see who covers what.

## Bonus prizes to tick

The rules allow one Grand Prize plus one Bonus Prize per submission, and the Devpost form takes **one** bonus prize. The draft picks **Best Agents (Rovo)**, the strongest and fully live part; the other two below are still worth describing in the story:

- **Best Agents (Rovo).** Forge `rovo:agent` with five `action` modules and two reusable `rovo:skill` modules (`handover-planner`, `welcome-back`) that other agents can load.
- **Best app with Atlassian MCP.** `rovo:mcp` exposes the five actions as tools; the two `SKILL.md` files in the repo are open-source skill files users can add to third-party agents.
- **Best apps with Teamwork Graph integration.** Consumes the Teamwork Graph API with five curated queries (teams, team members, pull requests, pull requests per work item, goals and projects).

## Installation link

Distribution is set to "Sharing with anyone" (production environment, Jira, with Confluence as an optional connection). Copy the link with the copy icon in developer.atlassian.com › Console › Understudy › Distribution › Installation link, and paste it here and in the Devpost form.

## Try it out links

- Code: https://github.com/tapaderuza/understudy
- Privacy policy: https://github.com/tapaderuza/understudy/blob/main/PRIVACY.md

## Demo video (YouTube, public, under 5 minutes)

https://youtu.be/pooYSBFNaFw (public, 2:37)

## About the project

### Inspiration

Every team has the same Thursday-before-leave ritual: a rushed handover doc, a list of tickets, and a vague "ping Ben if anything breaks". It misses the one thing only you understood, it buries the most experienced person, and nobody tells the stand-ins why they were picked. Then you come back and spend a morning reconstructing what happened.

The context to do this well already exists in Atlassian: who commented on what, who works in the same epic and components, who is on your team, which pull requests are open, which goals your work rolls up to. Codegeist asked us to turn that connected context into confident decisions. A handover is exactly that decision.

### Why it matters

Handovers weigh on people before and after leave. [46% of US workers with paid time off take less than they are offered, and 43% of them would feel bad about coworkers taking on extra work](https://www.pewresearch.org/social-trends/2023/03/30/how-americans-view-their-jobs/) (Pew Research Center, 2023). Coming back is slow: [53% of knowledge workers need three or more days to feel caught up after time off](https://finviz.com/news/387479/zoom-study-reveals-inbox-anxiety-is-the-hidden-cost-of-vacation) (Zoom and Morning Consult, 2026; a vendor-commissioned survey). And what a rushed handover loses is often held by one person: [42% of institutional knowledge is unique to the person in the role](https://www.hrdive.com/news/inefficient-knowledge-sharing-costs-large-us-businesses-47m-a-year/527892/) (Panopto and YouGov, 2018, via HR Dive). Understudy works on all three: it spreads the cover so nobody is buried, flags the knowledge only you hold, and shows what needs you first when you return.

### What it does

**Before you go.** Pick a person and dates. Understudy reads their open Jira work and ranks it by what must be covered: overdue, due while away, blocked, high priority, open pull request, someone waiting for a reply, in progress. For each item it suggests a stand-in **with the evidence**: "Commented 2 times on this item (+6), worked on 2 other items in Refunds v2 (+6), knows the Payments component (+1), already carries 9 open items (−2)". It assigns items in order of urgency and counts each assignment against that person's load, so the plan spreads work instead of burying the expert.

It also flags **work only you have context on**: items where nobody else has commented or worked nearby. Those need a 15-minute walkthrough before you leave, not a reassignment, and that is the knowledge most handovers lose.

Then one click briefs each stand-in: a comment on the work item that @-mentions them with what they cover, why it matters and why they were picked, and adds them as a watcher. Another click publishes the whole handover as a Confluence page.

**Welcome back.** When you return, Understudy shows what other people did on your work since your first day away (status changes, reassignments, comments), with what needs you first: mentions, items handed to you, replies waiting. It recognizes its own briefings, so it can tell you which stand-in covered what.

**Everywhere you work:**
- a Jira page with two tabs, *Before you go* and *Welcome back*;
- an Understudy panel on every work item: "If Ada is away, who could cover this?";
- a Rovo agent ("Prepare my handover for next week", "I'm back, what needs me first?");
- an MCP server and two open skills, so a team's own Rovo Studio agents, or Claude and other MCP clients, can plan handovers too.

**How it differs:**
- Out-of-office apps on the Marketplace make you name a coverer in advance and then reassign by rule; Understudy suggests a stand-in for each work item from evidence anyone can check in Jira, and shows why.
- Rules move tickets; Understudy changes no assignee. It finds the work only you understand, so it gets a walkthrough instead of a silent reassignment, and spreads the load so your one expert is not buried.
- Chat assistants summarize what you missed after you return; Understudy plans the cover before you leave, briefs each stand-in on the work item itself, publishes the handover page, and then closes the loop when you are back.

### How we built it

- **Forge**, runtime `nodejs24.x`, UI Kit for the Jira global page and the issue panel.
- **Rovo:** `rovo:agent` with a prompt resource, five `action` modules, and two `rovo:skill` modules whose `SKILL.md` playbooks follow the Agent Skills format.
- **MCP:** `rovo:mcp` exposes the same five actions as tools for Rovo Studio and for external MCP clients.
- **Teamwork Graph API:** curated queries `atlassianUserInTeams` and `atlassianTeamMembers` (who is on the person's teams), `atlassianUserPullRequests` and `jiraWorkItemLinkedExternalPullRequests` (code in flight, batched with GraphQL aliases) and `atlassianUserGoalsAndProjects` (what the work rolls up to). Each query has a plainer fallback, and missing scopes degrade to "not available" rather than failing the handover.
- **Jira and Confluence REST:** enhanced JQL search (with changelogs for Welcome back), ADF comments with mentions, watchers, CQL page search, and v2 pages to publish.
- **Design for trust:** every call runs as the user (`asUser`), the graph is read-only, nothing is stored, nothing leaves Atlassian, and Understudy only writes (a comment, a watcher, a page) after a person confirms. Agent inputs come from an LLM, so identity always comes from the invocation context, and every key and account ID is validated before it reaches JQL.
- **Quality:** the scoring, planning, rendering and parsing logic is pure TypeScript with 37 unit tests. We checked every REST endpoint we call against Atlassian's published OpenAPI specs to keep the scope list minimal and complete, and then tested every surface live on a Forge demo site with 25 projects and thousands of work items.

### Challenges we ran into

- **Explaining, not just ranking.** A single score nobody could question was not trustworthy. We built the scoring so every point is a sentence a teammate can verify in Jira, and the UI and agent always show those reasons.
- **The expert problem.** Pure "who knows most" sends everything to one person. Processing items by urgency and charging each assignment to the stand-in's load produces plans that spread the work.
- **Empty graphs.** A missing Teamwork Graph scope returns success with no rows. Each source reports its own state (connected, no data, not available) so users and the agent can be honest about gaps.
- **Real data is messier than test data.** Testing on Atlassian's demo site found what unit tests could not. One person there has 2,447 open items, so Understudy now plans the 100 most urgent and says so. A single load search let that person use up the result limit and made everyone else look idle, so load is now counted per person. Automation for Jira, service desk customers and deactivated accounts were showing up as possible stand-ins, and Understudy's own briefing comments counted as the sender knowing the work; all of that is filtered now. And when everyone who knows an item is already overloaded, Understudy no longer suggests the least-bad option: it asks a person to decide.

### Accomplishments that we're proud of

- The "only you know this" warning: the part of a handover that usually gets lost, found automatically.
- One engine behind four surfaces (page, issue panel, Rovo agent, MCP), so they always agree.
- A complete loop: hand over, brief, publish, and hand back.
- Every surface (the Jira page, the work item panel, the Rovo agent and the MCP tools) was exercised live on an Atlassian demo site; the Teamwork Graph queries are implemented and degrade gracefully, and for the demo site's fictional users the graph returned no data, which the app reports in its sources line ("Teamwork Graph no data") instead of hiding.

### What we learned

Context only builds confidence when people can see where it came from. Evidence lines change how a suggestion reads: from "the AI says Ben" to "Ben commented twice on this and owns the sibling ticket".

### What's next for Understudy

- Spot upcoming time off from calendar events in the Teamwork Graph and suggest starting a handover a few days ahead.
- Automation: run the handover agent from a Jira Automation rule when someone sets their status to away.
- A team view for managers: who is a single point of knowledge across the team, before anyone goes away.

## How the project meets the main technology requirement

Understudy is a Forge app (`manifest.yml`, runtime `nodejs24.x`) that integrates with Jira (global page, issue panel, JQL, comments, watchers), Confluence (page search and publishing), Rovo (agent, actions, skills, MCP) and the Teamwork Graph API (five curated queries, read-only `read:graph:*` scopes).

## Testing instructions for judges

1. Install with the installation link on your Jira site, and connect Confluence on the same site when asked (optional: needed to publish pages).
2. As a site or org admin, open Atlassian Administration › Apps › Sites › *your site* › Connected apps › Understudy › Permissions and make sure the `read:graph:*` scopes are on.
3. Jira › Apps › Understudy › **Before you go**: keep yourself or pick a teammate, choose dates, **Build handover**. Change a stand-in, press **Brief stand-in**, pick a space and **Publish handover page**.
4. Open any work item and expand the **Understudy** panel.
5. Jira › Apps › Understudy › **Welcome back**: choose a first day away and press **What changed?**
6. Rovo chat › **Understudy** agent: try "Prepare my handover for next week".
7. Optional MCP: enable the tools for external clients in Connected apps, then connect an MCP client to `https://mcp.atlassian.com/forge/f822ce82-2fbb-4e00-878f-0798dda01b8c`.

Understudy works on any Jira site where people share projects, epics and components. For an empty development site, `scripts/seed-demo.mjs` creates a small fictional team's work to try it on.

## Built with

forge, ui-kit, rovo, rovo-agent, rovo-skill, rovo-mcp, teamwork-graph, graphql, jira, confluence, typescript, react, vitest

---

# Demo video script (the original storyboard; the published video is shorter, 2:37, and follows the same flow)

Recorded on the Forge demo site (one-atlas-kxyj.atlassian.net), using its fictional team: **Ada Isadora** goes on leave from tomorrow for five days; **Max Taylor**, **Cassi Owens**, **Ryan Lee** and the narrator are the team. The data lives in the projects PAY (Payments, epic PAY-1 "Refunds v2"), OPS (Platform Operations) and FIN (Finance Reporting). The numbers below were measured live on 11 Nov 2026. Due dates are relative, so check the numbers on screen on the recording day. Speak slowly; show, don't tell.

| Time | Screen | Voice |
| --- | --- | --- |
| 0:00 | Ada's work in Jira (filter: assignee = Ada) | "Ada goes on leave tomorrow. Seven open items, one rushed handover doc, and the one thing only Ada understands is not in it." |
| 0:12 | Title card: Understudy | "Understudy hands over your work with its context, and catches you up when you're back." |
| 0:20 | Apps › Understudy › Before you go; pick Ada and the dates; Build handover | "Pick who is going away and when. Understudy reads Ada's Jira work, the Teamwork Graph and recent Confluence pages." |
| 0:35 | Headline and stat tiles | "Seven open items. Four must be covered. Two fall due during the leave, one is already overdue, and one only Ada has context on." |
| 0:50 | Warning panel: FIN-1, the quarter-end tax export | "This is what handovers lose: nobody else has ever touched the quarter-end tax export. Understudy says so, and asks for a walkthrough before Ada leaves." |
| 1:05 | Cover plan row PAY-2 "Fix refund rounding for EUR", reasons | "For each item, a stand-in with the evidence. Max reported this item and has two more in the same epic, knows the Payments component and the refunds work. And Understudy noticed a question on it is waiting for Ada's reply." |
| 1:25 | Who covers what: Max, Cassi, Ryan and the narrator | "Every assignment adds to that person's load, so the plan spreads the work across four people instead of burying one expert. Someone who already carries too much is never suggested: the plan asks a person to decide." |
| 1:40 | Change a stand-in in the dropdown | "Suggestions, not decisions: you can pick someone else." |
| 1:50 | Brief stand-in on PAY-2, then open PAY-2 and show the comment | "One click briefs Max right on the work item: what to cover, why it matters, and why Max was picked. Max is added as a watcher." |
| 2:05 | Publish handover page; open the Confluence page | "And one click publishes the whole handover in Confluence, with mentions, status and the reasons." |
| 2:20 | Issue panel on PAY-2 | "On any work item, the Understudy panel answers: if Ada is away, who could cover this?" |
| 2:35 | Rovo chat with the Understudy agent | "It's also a Rovo agent. 'Ada is on leave from tomorrow, prepare the handover' gives the same plan in chat, from the same actions and skills." |
| 2:55 | MCP client calling get-handover-brief (optional) | "Through Atlassian's MCP server, Claude or any MCP client can plan handovers too." |
| 3:05 | Welcome back tab: Ada, What changed? | "When Ada comes back: what changed, what needs Ada first, and which stand-in covered what." |
| 3:20 | Sources line; close on title card | "Everything runs as the user, reads the graph, stores nothing. Understudy: hand over your work without losing its context." |

Note for the voice-over: Ada, Max, Cassi and Ryan are fictional people that come with the Forge demo site. The script uses names instead of pronouns on purpose.
