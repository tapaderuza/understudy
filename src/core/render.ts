import type { Brief, BriefItem } from './brief';
import { formatDay } from './dates';
import { RISK_LABELS, type Tier } from './risk';
import type { Absence } from './types';

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Colour = 'Grey' | 'Red' | 'Yellow' | 'Green' | 'Blue' | 'Purple';

function status(title: string, colour: Colour): string {
  return (
    '<ac:structured-macro ac:name="status">' +
    `<ac:parameter ac:name="colour">${colour}</ac:parameter>` +
    `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>` +
    '</ac:structured-macro>'
  );
}

function panel(kind: 'info' | 'warning' | 'note', body: string): string {
  return `<ac:structured-macro ac:name="${kind}"><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;
}

function user(accountId: string): string {
  return `<ac:link><ri:user ri:account-id="${escapeXml(accountId)}" /></ac:link>`;
}

function link(url: string | undefined, text: string): string {
  return url ? `<a href="${escapeXml(url)}">${escapeXml(text)}</a>` : escapeXml(text);
}

const TIER_STATUS: Record<Tier, [string, Colour]> = {
  must: ['Must cover', 'Red'],
  should: ['Should cover', 'Yellow'],
  'can-wait': ['Can wait', 'Grey'],
};

export function handoverTitle(name: string, absence: Absence): string {
  return `Handover: ${name}, ${formatDay(absence.start)} to ${formatDay(absence.end)}`;
}

function itemRow(b: BriefItem): string {
  const [tierText, tierColour] = TIER_STATUS[b.risk.tier];
  const why = b.risk.flags.length ? b.risk.flags.map((f) => escapeXml(RISK_LABELS[f])).join('<br />') : '—';
  const who = b.standIn ? user(b.standIn.accountId) : '<em>Nobody suggested</em>';
  const because = b.standIn
    ? b.standIn.reasons.map((r) => escapeXml(r.text)).join('<br />')
    : 'Nobody else has worked on this.';
  const confidence = b.confidence === 'low' ? `<br />${status('Needs a walkthrough', 'Purple')}` : '';
  return (
    '<tr>' +
    `<td>${link(b.item.url, b.item.key)} ${escapeXml(b.item.summary)}</td>` +
    `<td>${status(tierText, tierColour)}<br />${escapeXml(b.item.status)}${b.item.dueDate ? `<br />Due ${escapeXml(formatDay(b.item.dueDate))}` : ''}</td>` +
    `<td>${why}</td>` +
    `<td>${who}${confidence}</td>` +
    `<td>${because}</td>` +
    '</tr>'
  );
}

/** Confluence storage-format body for the handover page. */
export function renderHandoverPage(b: Brief): { title: string; body: string } {
  const name = b.person.displayName;
  const sources = [
    'Jira',
    b.sources.confluence === 'ok' ? 'Confluence' : null,
    b.sources.teamworkGraph === 'ok' ? 'Teamwork Graph' : null,
  ].filter(Boolean);

  const out: string[] = [];
  out.push(
    panel(
      'info',
      `<p><strong>${escapeXml(b.headline)}</strong></p>` +
        `<p>${user(b.person.accountId)} is away from ${escapeXml(formatDay(b.absence.start))} to ${escapeXml(formatDay(b.absence.end))}. ` +
        `Built by Understudy on ${escapeXml(formatDay(b.today))} from ${escapeXml(sources.join(', '))}.</p>`,
    ),
  );

  if (b.cover.length > 0) {
    out.push('<h2>Who covers what</h2><ul>');
    for (const c of b.cover) {
      const keys = c.itemKeys
        .map((k) => {
          const item = b.items.find((x) => x.item.key === k)?.item;
          return link(item?.url, k);
        })
        .join(', ');
      out.push(`<li>${user(c.accountId)}: ${keys}</li>`);
    }
    out.push('</ul>');
  }

  if (b.soloKnowledge.length > 0) {
    const list = b.soloKnowledge
      .map((k) => {
        const item = b.items.find((x) => x.item.key === k)?.item;
        return `<li>${link(item?.url, k)} ${escapeXml(item?.summary ?? '')}</li>`;
      })
      .join('');
    out.push(
      panel(
        'warning',
        `<p><strong>Only ${escapeXml(name)} has context on ${b.soloKnowledge.length === 1 ? 'this item' : 'these items'}.</strong> ` +
          'Book a short walkthrough with the stand-in before leaving.</p>' +
          `<ul>${list}</ul>`,
      ),
    );
  }

  const active = b.items.filter((x) => x.risk.tier !== 'can-wait');
  if (active.length > 0) {
    out.push('<h2>Cover plan</h2>');
    out.push(
      '<table><tbody><tr><th>Item</th><th>Status</th><th>Why it matters</th><th>Stand-in</th><th>Why this stand-in</th></tr>' +
        active.map(itemRow).join('') +
        '</tbody></table>',
    );
  }

  const later = b.items.filter((x) => x.risk.tier === 'can-wait');
  if (later.length > 0) {
    out.push(`<h2>Can wait until ${escapeXml(name)} is back</h2><ul>`);
    for (const x of later) out.push(`<li>${link(x.item.url, x.item.key)} ${escapeXml(x.item.summary)} (${escapeXml(x.item.status)})</li>`);
    out.push('</ul>');
  }

  const prs = b.pullRequests.filter((p) => p.status === 'OPEN' || p.status === 'DRAFT');
  if (prs.length > 0) {
    out.push('<h2>Code in flight</h2><ul>');
    for (const p of prs) {
      const on = p.workItemKey ? ` (for ${escapeXml(p.workItemKey)})` : '';
      out.push(`<li>${status(p.status === 'DRAFT' ? 'Draft' : 'Open', p.status === 'DRAFT' ? 'Grey' : 'Blue')} ${link(p.url, p.title)}${on}</li>`);
    }
    out.push('</ul>');
  }

  if (b.goals.length > 0) {
    out.push('<h2>Goals and projects</h2><ul>');
    for (const g of b.goals) {
      const state = g.state ? ` ${status(g.state.replace(/_/g, ' '), g.state === 'AT_RISK' || g.state === 'OFF_TRACK' ? 'Red' : 'Grey')}` : '';
      out.push(`<li>${g.kind === 'goal' ? 'Goal' : 'Project'}: ${link(g.url, g.name)}${state}</li>`);
    }
    out.push('</ul>');
  }

  if (b.pages.length > 0) {
    out.push(`<h2>Pages ${escapeXml(name)} worked on recently</h2><ul>`);
    for (const p of b.pages) out.push(`<li>${link(p.url, p.title)}${p.space ? ` in ${escapeXml(p.space)}` : ''}</li>`);
    out.push('</ul>');
  }

  out.push(
    '<p><em>Stand-ins are suggestions with their reasons shown. ' +
      'Talk to each stand-in before relying on this plan.</em></p>',
  );

  return { title: handoverTitle(name, b.absence), body: out.join('') };
}

// ---- Jira comment (Atlassian Document Format) ----

type AdfNode = Record<string, unknown>;

const text = (t: string, marks?: AdfNode[]): AdfNode => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const strong = (t: string): AdfNode => text(t, [{ type: 'strong' }]);
const paragraph = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });

export interface StandInCommentInput {
  itemKey: string;
  standIn: { accountId: string; displayName: string };
  ownerName: string;
  /** Left out when nobody gave dates (the issue panel), so the comment never invents them. */
  absence?: Absence;
  whyItMatters: string[];
  because: string[];
  note?: string;
}

/** The comment that tells a stand-in what they are covering and why they were picked. */
export function standInComment(c: StandInCommentInput): AdfNode {
  const content: AdfNode[] = [
    paragraph(
      { type: 'mention', attrs: { id: c.standIn.accountId, text: `@${c.standIn.displayName}` } },
      text(
        c.absence
          ? ` you are covering ${c.itemKey} while ${c.ownerName} is away (${formatDay(c.absence.start)} to ${formatDay(c.absence.end)}).`
          : ` you are covering ${c.itemKey} while ${c.ownerName} is away.`,
      ),
    ),
  ];
  if (c.whyItMatters.length) content.push(paragraph(strong('Why it matters: '), text(c.whyItMatters.join(', '))));
  if (c.because.length) content.push(paragraph(strong('Why you: '), text(c.because.join('; '))));
  if (c.note && c.note.trim()) content.push(paragraph(strong(`Note from the handover: `), text(c.note.trim().slice(0, 2000))));
  content.push(paragraph(text('Sent with Understudy.', [{ type: 'em' }])));
  return { type: 'doc', version: 1, content };
}

export interface WalkthroughCommentInput {
  itemKey: string;
  owner: { accountId: string; displayName: string };
  learner: { accountId: string; displayName: string };
  whyItMatters: string[];
  note?: string;
}

/**
 * Asks the only person with context on an item to walk a colleague through
 * it, so the work can be covered when they are away. Ends with a signature
 * (WALKTHROUGH_SIGNATURE in adapters/parse) so it never counts as evidence.
 */
export function walkthroughComment(c: WalkthroughCommentInput): AdfNode {
  const content: AdfNode[] = [
    paragraph(
      { type: 'mention', attrs: { id: c.owner.accountId, text: `@${c.owner.displayName}` } },
      text(' could you give '),
      { type: 'mention', attrs: { id: c.learner.accountId, text: `@${c.learner.displayName}` } },
      text(
        ` a 15-minute walkthrough of ${c.itemKey}? Right now nobody else has context on it, so it would be hard to cover if you were away.`,
      ),
    ),
  ];
  if (c.whyItMatters.length) content.push(paragraph(strong('Why it matters: '), text(c.whyItMatters.join(', '))));
  if (c.note && c.note.trim()) content.push(paragraph(strong('Note: '), text(c.note.trim().slice(0, 2000))));
  content.push(paragraph(text('Requested with Understudy.', [{ type: 'em' }])));
  return { type: 'doc', version: 1, content };
}
