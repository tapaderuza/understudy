#!/usr/bin/env node
// Seeds a Jira Cloud DEVELOPMENT site with a small, fictional team's work, so
// Understudy has something real to show in a demo. It creates three projects,
// components, an epic, work items with due dates relative to today, a
// blocking link and comments.
//
// Run it yourself, with your own API token, against a site you own:
//
//   JIRA_SITE=https://your-dev-site.atlassian.net \
//   JIRA_EMAIL=you@example.com JIRA_API_TOKEN=... \
//   DEMO_TEAMMATES=ben@example.com,chen@example.com,dee@example.com \
//   node scripts/seed-demo.mjs --yes
//
// Optional:
//   DEMO_TEAMMATE_TOKENS=tokenBen,tokenChen,tokenDee  same order as DEMO_TEAMMATES;
//                                     lets teammates' comments come from them
//   DEMO_KEYS=PAY,OPS,FIN             project keys to create (must not exist yet)
//   CONFLUENCE_SPACE=TEAM             also creates one design page in that space
//
// The token owner plays the person going away. Teammates must already be
// users on the site (invite them first). Nothing here is sent anywhere but
// your own site, and tokens are never printed.

const args = new Set(process.argv.slice(2));
const env = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    console.error(`Missing ${name}. See the header of this file.`);
    process.exit(1);
  }
  return v;
};

const site = env('JIRA_SITE').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i.test(site)) {
  console.error('JIRA_SITE must look like https://your-site.atlassian.net');
  process.exit(1);
}
if (!args.has('--yes')) {
  console.error(`This creates projects and work items on ${site}. Re-run with --yes to continue.`);
  process.exit(1);
}

const ownerAuth = 'Basic ' + Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64');
const mateEmails = env('DEMO_TEAMMATES').split(',').map((s) => s.trim()).filter(Boolean);
const mateTokens = (process.env.DEMO_TEAMMATE_TOKENS ?? '').split(',').map((s) => s.trim());
const [PAY, OPS, FIN] = env('DEMO_KEYS', 'PAY,OPS,FIN').split(',').map((s) => s.trim().toUpperCase());

async function call(method, path, body, auth = ownerAuth) {
  const res = await fetch(`${site}${path}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function main() {
  const me = await call('GET', '/rest/api/3/myself');
  console.log(`Owner (going away): ${me.displayName}`);

  const mates = [];
  for (const [i, email] of mateEmails.entries()) {
    const found = await call('GET', `/rest/api/3/user/search?query=${encodeURIComponent(email)}`);
    const user = (found ?? []).find((u) => u.accountType === 'atlassian');
    if (!user) throw new Error(`No user on the site for ${email}. Invite them first.`);
    const token = mateTokens[i];
    mates.push({ ...user, auth: token ? 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') : null });
  }
  if (mates.length === 0) throw new Error('Add at least one teammate in DEMO_TEAMMATES.');
  const ben = mates[0];
  const chen = mates[1] ?? mates[0];
  const dee = mates[2] ?? mates[mates.length - 1];
  console.log(`Teammates: ${mates.map((m) => m.displayName).join(', ')}`);

  // Projects (company-managed Kanban so components exist).
  for (const [key, name] of [[PAY, 'Payments'], [OPS, 'Operations'], [FIN, 'Finance reporting']]) {
    try {
      await call('GET', `/rest/api/3/project/${key}`);
      throw new Error(`Project ${key} already exists. Pick other keys with DEMO_KEYS.`);
    } catch (e) {
      if (!String(e.message).includes('404')) throw e;
    }
    await call('POST', '/rest/api/3/project', {
      key,
      name,
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
      leadAccountId: me.accountId,
      assigneeType: 'UNASSIGNED',
    });
    console.log(`Created project ${key}`);
  }

  const component = async (project, name) => (await call('POST', '/rest/api/3/component', { project, name })).id;
  const comp = {
    payments: await component(PAY, 'Payments'),
    ledger: await component(PAY, 'Ledger'),
    infra: await component(OPS, 'Infra'),
  };

  const create = async ({ project, summary, type = 'Task', priority = 'Medium', due, labels = [], components = [], assignee, parent }) => {
    const fields = {
      project: { key: project },
      summary,
      issuetype: { name: type },
      priority: { name: priority },
      labels,
      components: components.map((id) => ({ id })),
    };
    if (due) fields.duedate = due;
    if (assignee) fields.assignee = { accountId: assignee.accountId };
    if (parent) fields.parent = { key: parent };
    const { key } = await call('POST', '/rest/api/3/issue', { fields });
    return key;
  };
  const startProgress = async (key) => {
    const { transitions } = await call('GET', `/rest/api/3/issue/${key}/transitions`);
    const t = transitions.find((x) => x.to?.statusCategory?.key === 'indeterminate');
    if (t) await call('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
  };
  const comment = async (key, who, text) => {
    const auth = who === me ? ownerAuth : who.auth;
    if (!auth) return;
    await call('POST', `/rest/api/3/issue/${key}/comment`, { body: adf(text) }, auth);
  };

  // Unassigned, so the person going away has exactly seven open items.
  const epic = await create({ project: PAY, summary: 'Refunds v2', type: 'Epic', priority: 'High' });

  // Work that will need covering.
  const rounding = await create({ project: PAY, summary: 'Fix refund rounding for EUR', priority: 'High', due: day(3), labels: ['refunds'], components: [comp.payments], assignee: me, parent: epic });
  const ledger = await create({ project: PAY, summary: 'Write migration for the ledger table', components: [comp.ledger], assignee: me, parent: epic });
  const certs = await create({ project: OPS, summary: 'Rotate staging TLS certificates', priority: 'Highest', due: day(-2), components: [comp.infra], assignee: me });
  const tax = await create({ project: FIN, summary: 'Quarter-end tax export for Finance', due: day(2), labels: ['finance'], assignee: me });
  const flaky = await create({ project: PAY, summary: 'Investigate flaky refund webhook test', priority: 'High', labels: ['refunds'], components: [comp.payments], assignee: me });
  await create({ project: PAY, summary: 'Update README badges', priority: 'Low', assignee: me });
  await create({ project: PAY, summary: 'Tidy up old feature flags', priority: 'Low', assignee: me });
  for (const k of [rounding, ledger, tax]) await startProgress(k);

  // Teammates' recent work: the evidence Understudy uses.
  const sibling1 = await create({ project: PAY, summary: 'Refund API: partial refunds', components: [comp.payments], labels: ['refunds'], assignee: ben, parent: epic });
  await create({ project: PAY, summary: 'Refund API: idempotency keys', components: [comp.payments], assignee: ben, parent: epic });
  await create({ project: PAY, summary: 'Refund emails copy review', assignee: ben, parent: epic });
  for (let i = 1; i <= 5; i++) await create({ project: PAY, summary: `Payments support rotation item ${i}`, priority: 'Low', assignee: ben });
  await create({ project: PAY, summary: 'Ledger: backfill script', components: [comp.ledger], assignee: chen, parent: epic });
  await create({ project: PAY, summary: 'Ledger: reconcile nightly totals', components: [comp.ledger], assignee: chen });
  const runner = await create({ project: OPS, summary: 'Upgrade CI runners', components: [comp.infra], assignee: dee });
  await create({ project: OPS, summary: 'Renew production certificates', components: [comp.infra], assignee: dee });
  for (const k of [sibling1, runner]) await startProgress(k);

  // The flaky test is blocked by the CI runner upgrade.
  await call('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, outwardIssue: { key: runner }, inwardIssue: { key: flaky } });

  // Conversation on the items (teammates' comments need their tokens).
  await comment(rounding, ben, 'I hit the half-even case in the partial refunds work. Can we pair on it before Thursday?');
  await comment(rounding, me, 'Yes, the fix is in review. The open question is JPY, which has no minor unit.');
  await comment(rounding, ben, 'Did JPY get covered? Finance asked again today.');
  await comment(ledger, chen, 'The backfill depends on this migration, ping me when the schema is final.');
  await comment(certs, dee, 'Staging certs expire this week, this one is urgent.');

  const space = process.env.CONFLUENCE_SPACE;
  if (space) {
    const spaces = await call('GET', `/wiki/api/v2/spaces?keys=${encodeURIComponent(space)}`);
    const spaceId = spaces?.results?.[0]?.id;
    if (spaceId) {
      await call('POST', '/wiki/api/v2/pages', {
        spaceId,
        status: 'current',
        title: 'Refunds v2: rounding and currencies',
        body: { representation: 'storage', value: '<p>Decision: round half-even per currency minor unit. Open: JPY and other zero-decimal currencies.</p>' },
      });
      console.log(`Created a design page in ${space}`);
    }
  }

  console.log(`Done. Open Understudy in Jira and build a handover for ${me.displayName}.`);
  if (!mates.some((m) => m.auth)) console.log('Tip: set DEMO_TEAMMATE_TOKENS to add teammates\' comments too.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
