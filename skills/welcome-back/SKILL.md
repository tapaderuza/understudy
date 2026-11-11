---
name: welcome-back
description: Catches someone up after time away. Use it when a user says they are back from holiday, leave or a trip and asks what changed on their work, what needs them first, who mentioned them, or what their stand-ins handled.
compatibility: Jira Cloud with the Understudy Forge app installed.
license: MIT
allowed-tools: get-welcome-back-brief
metadata:
  app: understudy
  version: "1.1"
---
# Welcome back

The second half of a handover: what happened to someone's work while they were away, with the items that need them first.

## Tool

`get-welcome-back-brief` (GET) takes `person` (empty or "me" for the current user, or a name) and `since`, the first day away as `YYYY-MM-DD`. Without `since` it looks back 14 days.

## Procedure

1. Work out the first day away. "Last week" or "since Monday" become a `YYYY-MM-DD` date from today's date. Ask once if it is unclear.
2. Call `get-welcome-back-brief`.
3. Answer in this order:
   1. The `headline`.
   2. **Needs you first**: every entry in `needsYou`, as key (link), summary, `why`, and the latest line of `latest`. Mentions and items handed to the person come first.
   3. **Also changed**: a short list from `otherChanges`, grouped as finished, moved, or discussed, naming `coveredBy` where a stand-in handled the item.
4. Offer to open a specific item, or to thank the stand-ins named in `coveredBy`.

## Rules

- Report only what the tool returned. Changes made by the person themselves are left out on purpose.
- Keep it short: someone just back from leave wants the three things that matter, not a log.
- Refer to people by name; do not guess pronouns.
