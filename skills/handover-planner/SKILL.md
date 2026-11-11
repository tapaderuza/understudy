---
name: handover-planner
description: Plans a handover before someone goes away (holiday, leave, conference, sick days). Use it when a user asks to prepare a handover, find who should cover their work, see what only they know, publish a handover page, or brief a stand-in on a Jira work item.
compatibility: Jira Cloud with the Understudy Forge app installed. Confluence is optional and needed only to publish handover pages.
license: MIT
allowed-tools: get-handover-brief suggest-stand-ins publish-handover-page brief-stand-in brief-all-stand-ins
metadata:
  app: understudy
  version: "1.2"
---
# Handover planner

Understudy turns "I'm off next week" into a cover plan: which open work must be covered, who already has the context for each item, the evidence for that choice, and the work only the leaver knows.

## Tools

| Tool | Verb | Use it to |
| --- | --- | --- |
| `get-handover-brief` | GET | Build the full brief for one person and one absence |
| `suggest-stand-ins` | GET | Rank stand-ins for one work item, with reasons |
| `publish-handover-page` | CREATE | Publish the brief as a Confluence page |
| `brief-stand-in` | CREATE | Comment on a work item to brief the chosen stand-in and add them as a watcher |
| `brief-all-stand-ins` | CREATE | Brief every stand-in in the plan at once (one confirmation) |

## Procedure

1. **Who and when.** "Me", "my" or nothing means the current user; leave `person` empty. Convert relative dates ("next week", "Monday to Friday") to `YYYY-MM-DD` using today's date. `endDate` is the last day away, inclusive. If the dates are ambiguous, ask once.
2. **Build the brief.** Call `get-handover-brief` with `person`, `startDate` and `endDate`.
3. **Answer in this order:**
   1. The `headline`, as one sentence.
   2. **Only this person has context on**: list `onlyThisPersonHasContext` first, with the advice to book a short walkthrough before leaving. This is the most important warning in a handover.
   3. **Must cover / Should cover**: one line per item in `coverPlan`: key as a link, summary, `whyItMatters`, `suggestedStandIn` and the strongest line of `because`.
   4. **Who covers what**: one line per entry in `whoCoversWhat`.
   5. Pull requests in flight and goals, only when present.
   6. Offer the next steps: publish the page, brief the stand-ins.
4. **One item only?** Call `suggest-stand-ins` with `issueKey`, or with no key when the user is viewing the item. Show the top candidates with `because` and `openItems`, and warn when the best-placed person already carries a lot of open work.
5. **Changes in chat.** When the user swaps a stand-in ("give PAY-3 to Max instead"), keep a running list and pass it as `standIns` (`PAY-3=Max Taylor; PAY-5=Cassi Owens`) to `publish-handover-page` and `brief-all-stand-ins`, so what is published and briefed is the plan the user agreed, not the first suggestion.
6. **Publish.** Confirm the Confluence space key and the dates, then call `publish-handover-page` and share the link.
7. **Brief.** For one item, confirm the work item and the person, then call `brief-stand-in` with `issueKey`, `standIn` and an optional `note`. For the whole plan, list who will be briefed on what, ask once, then call `brief-all-stand-ins` and report `briefed` and `skipped`. Briefing someone again updates the earlier comment.
8. **Only you know.** For each item in `onlyThisPersonHasContext`, offer a short walkthrough agenda: what the item is, its status, what is due, and the open questions to cover in 15 minutes.

## How to read the results

- `confidence` is how much context the best stand-in already has: `high` (commented on the item or worked in the same epic), `medium` (shared components or project), `low` (no one else has touched it).
- `because` lists checkable evidence with points. A negative line means the person is already busy; the plan spreads work rather than overloading the expert.
- `dataSources` says which sources answered. When Teamwork Graph is `empty` or `unavailable`, say so in one sentence: teams, goals and pull requests may be missing, and an admin may need to grant the app's graph scopes.

## Rules

- Suggestions are not decisions. Always show the reasons, and say the user can pick someone else.
- Never reassign work. Only comment, watch or publish, and only after the user confirms.
- Refer to people by name; do not guess pronouns.
- If a tool returns `error`, explain it plainly and say what to do next (for example, "that name matches several people: which one?").
