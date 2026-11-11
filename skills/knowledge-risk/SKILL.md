---
name: knowledge-risk
description: Finds single points of knowledge in a team before anyone goes away. Use it when a user (often a manager or team lead) asks which work only one person understands, how ready the team is to cover someone, who is a bus-factor risk, or who should learn what, and to request walkthroughs.
compatibility: Jira Cloud with the Understudy Forge app installed.
license: MIT
allowed-tools: get-team-knowledge-risk request-walkthrough
metadata:
  app: understudy
  version: "1.0"
---
# Knowledge risk

A handover is easiest when nobody is the only person who understands a piece of work. This skill looks at a whole project and finds the open work items that only their assignee has context on, using the same evidence as a handover: comments, work in the same epic, components, labels and project.

## Tools

| Tool | Verb | Use it to |
| --- | --- | --- |
| `get-team-knowledge-risk` | GET | Check one or more projects for single points of knowledge |
| `request-walkthrough` | CREATE | Ask an item's assignee, in a comment, to walk a colleague through it |

## Procedure

1. **Which projects.** Use the project keys the user names (`projects`, comma-separated). If they name none, leave it empty: the tool uses the projects of their own open work.
2. **Check.** Call `get-team-knowledge-risk`.
3. **Answer in this order:**
   1. The `headline`, as one sentence, and `coverReadinessPercent` ("72% of open work has someone else with context").
   2. **People most at risk**: for each entry in `people` with `onlyTheyKnow` not empty, one line: name, how many items only they know (`urgentOnlyTheyKnow` first), and `bestBackup` when there is one.
   3. **Items only one person knows**: up to 8 entries of `knowledgeAtRisk`, most urgent first: key as a link, summary, owner, `whyItMatters`, and `closestColleague` with the strongest line of `closestColleagueEvidence`, or "nobody else yet".
   4. Offer to request walkthroughs for the most urgent items.
4. **Request a walkthrough.** Confirm the work item and the colleague with the user, then call `request-walkthrough` with `issueKey` and `learner`. Say that the owner was asked in a comment and the colleague was added as a watcher.

## How to read the results

- An item is a single point of knowledge when nobody else has 3 or more points of evidence on it. That is the same line as "Needs a walkthrough" in a handover.
- `coverReadinessPercent` is the share of open items someone else could pick up today.
- `closestColleague` can have little evidence. Say so; it is a suggestion for who should learn the work, not proof that they know it.
- `notes` explain anything left out (for example, when a project has more open work than is read at once).

## Rules

- Never reassign work. You only comment and add watchers, and only after the user confirms.
- This is about spreading knowledge, not judging people. Describe items and context, never anyone's performance.
- Refer to people by name and do not guess anyone's pronouns.
