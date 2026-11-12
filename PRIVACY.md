# Understudy privacy policy

Last updated: 11 November 2026

Understudy is a Forge app for Jira and Confluence. It helps a person hand over their work before time off and catch up when they come back. This page explains what data it reads, what it writes, and what it keeps.

## Summary

- Understudy **stores no personal data** and keeps no database of its own.
- It runs entirely on Atlassian Forge, inside Atlassian's cloud. It sends **no data to any service outside Atlassian**.
- It reads data **as the person using it** (`asUser`), so it can only see what that person can already see. The one exception is the draft handover described below, which Understudy prepares as the app.
- It **writes only when a person asks it to**: a comment and a watcher on a work item, or a Confluence page. The exception: when someone creates a work item that announces time off (for example with the label `time-off`), Understudy posts one comment on that item with a draft handover for the person who filed it (its reporter), never for anyone else. The draft lists work item keys and people's names, no summaries, and is not sent to anyone else.

## What Understudy reads

When someone builds a handover, opens the issue panel, or asks the Understudy Rovo agent, Understudy reads, for the person and dates chosen:

- **Jira:** open work items assigned to the person, with their status, priority, due date, labels, components, parent, links, reporter and comments; recent work items of teammates in the same projects; counts of open work items per possible stand-in; and, for "Welcome back", the changelog and comments of the person's work since their first day away.
- **Jira users:** names and account IDs of the people involved, to show and mention them.
- **Confluence:** pages the person recently contributed to, and the list of spaces, so a handover page can be published.
- **Teamwork Graph:** the person's teams and their members, goals and projects, and pull requests linked to the person or their work items. These scopes are read-only.

This data is used only to build the answer shown on screen or returned to the Rovo agent or MCP client that asked, and is discarded when the request ends.

## What Understudy writes

Only after a person clicks a button or confirms an agent action:

- **Brief stand-in:** adds a comment to the work item that mentions the chosen stand-in and explains why, and adds the stand-in as a watcher.
- **Publish handover page:** creates a Confluence page in the space the person chooses.

These are ordinary Jira comments and Confluence pages, owned and governed by your Atlassian site like any other content.

## What Understudy keeps

Nothing. It uses no Forge storage. Forge function logs contain only counts and error messages (for example, how many teams the Teamwork Graph returned), never names, account IDs or content. Site admins can turn off log sharing with the developer at any time in Atlassian Administration.

## Data residency and security

Understudy is a Forge app that "runs on Atlassian": its code runs in Atlassian's Forge runtime, and it declares no external egress. Access is limited to the scopes listed in the app's manifest, which an admin can review before installing.

## Contact

Questions or requests: open an issue at https://github.com/tapaderuza/understudy/issues.
