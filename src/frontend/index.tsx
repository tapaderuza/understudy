import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Badge,
  Box,
  Button,
  DatePicker,
  DynamicTable,
  EmptyState,
  Heading,
  Icon,
  Inline,
  Label,
  Link,
  List,
  ListItem,
  LoadingButton,
  Lozenge,
  ProgressBar,
  SectionMessage,
  SectionMessageAction,
  Select,
  Spinner,
  Stack,
  Strong,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  Toggle,
  Tooltip,
  User,
  UserGroup,
  UserPicker,
  xcss,
} from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import type { UiBrief, UiWelcomeBack } from '../resolvers';
import { formatDay } from '../core/dates';
import { Evidence, contextPoints } from './evidence';

type Item = UiBrief['items'][number];
type Option = { label: string; value: string };
type Failure = { error: string };
type Glyph = Parameters<typeof Icon>[0]['glyph'];
type Sent = { ok: boolean; text: string };

const isFailure = (x: unknown): x is Failure => typeof x === 'object' && x !== null && 'error' in x;

/** Calls a resolver; unwraps the { body } form and turns exceptions into { error }. */
async function call<T>(key: string, payload?: Record<string, unknown>): Promise<T | Failure> {
  try {
    const r: unknown = await invoke(key, payload);
    if (r && typeof r === 'object' && 'body' in r && !('error' in r)) return (r as { body: T }).body;
    return r as T | Failure;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const AGENT = { type: 'forge' as const, agentKey: 'understudy-agent', agentName: 'Understudy' };

const day = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return day(d);
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const card = xcss({
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  borderRadius: 'radius.large',
  padding: 'space.300',
});

const tile = xcss({
  backgroundColor: 'color.background.neutral.subtle',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.medium',
  padding: 'space.150',
  minWidth: '140px',
});

const tileWarning = xcss({
  backgroundColor: 'color.background.warning',
  borderColor: 'color.border.warning',
  borderStyle: 'solid',
  borderWidth: 'border.width.selected',
  borderRadius: 'radius.medium',
  padding: 'space.150',
  minWidth: '140px',
});

const field = xcss({ minWidth: '220px' });
const picker = xcss({ minWidth: '170px' });

const TIER: Record<Item['tier'], { text: string; appearance: 'removed' | 'moved' | 'default' }> = {
  must: { text: 'Must cover', appearance: 'removed' },
  should: { text: 'Should cover', appearance: 'moved' },
  'can-wait': { text: 'Can wait', appearance: 'default' },
};

const CONFIDENCE: Record<Item['confidence'], { text: string; appearance: 'success' | 'inprogress' | 'discovery' }> = {
  high: { text: 'Knows this well', appearance: 'success' },
  medium: { text: 'Some context', appearance: 'inprogress' },
  low: { text: 'Needs a walkthrough', appearance: 'discovery' },
};

/** A compact number tile; the icon is decorative, the label carries the meaning. */
function Stat({ value, label, glyph, warning = false }: { value: number; label: string; glyph: Glyph; warning?: boolean }) {
  return (
    <Box xcss={warning ? tileWarning : tile}>
      <Stack space="space.050">
        <Inline space="space.075" alignBlock="center">
          <Icon glyph={glyph} label="" color={warning ? 'color.icon.warning' : 'color.icon.subtle'} />
          <Heading size="large" as="span">
            {String(value)}
          </Heading>
        </Inline>
        <Text size="small">{label}</Text>
      </Stack>
    </Box>
  );
}

const STEPS = ['Who and when', 'Check the cover plan', 'Brief and publish'];

/** "1 Who and when › 2 Check the cover plan › 3 Brief and publish". */
function Steps({ current, finished }: { current: number; finished: boolean }) {
  return (
    <Inline space="space.100" alignBlock="center" shouldWrap>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current || (finished && n === current);
        const now = n === current && !done;
        return (
          <Inline key={label} space="space.075" alignBlock="center">
            {done ? (
              <Icon glyph="check-circle" label={`Step ${n} done:`} color="color.icon.success" />
            ) : (
              <Badge appearance={now ? 'primary' : 'default'}>{n}</Badge>
            )}
            <Text weight={now ? 'bold' : 'regular'} color={now || done ? 'color.text' : 'color.text.subtle'}>
              {label}
            </Text>
            {n < STEPS.length && <Text color="color.text.subtlest">›</Text>}
          </Inline>
        );
      })}
    </Inline>
  );
}

function SourceLine({ brief }: { brief: UiBrief }) {
  const mark = (s: string) => (s === 'ok' ? 'connected' : s === 'empty' ? 'no data' : 'not available');
  return (
    <Stack space="space.050">
      <Text size="small" color="color.text.subtle">
        Sources: Jira {mark(brief.sources.jira)} · Confluence {mark(brief.sources.confluence)} · Teamwork Graph{' '}
        {mark(brief.sources.teamworkGraph)}
      </Text>
      {brief.sources.notes.map((n) => (
        <Text key={n} size="small" color="color.text.subtle">
          {n}
        </Text>
      ))}
    </Stack>
  );
}

const Handover = () => {
  const [me, setMe] = useState<{ accountId: string; displayName: string } | null>(null);
  const [personId, setPersonId] = useState<string>('');
  const [personName, setPersonName] = useState<string>('');
  const [start, setStart] = useState<string>(plusDays(1));
  const [end, setEnd] = useState<string>(plusDays(5));
  const [brief, setBrief] = useState<UiBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [spaces, setSpaces] = useState<Option[] | null>(null);
  const [spaceId, setSpaceId] = useState<string>('');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ url: string; title: string } | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<Record<string, Sent>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ ok: number; people: number; failed: number } | null>(null);

  useEffect(() => {
    call<{ accountId: string; displayName: string }>('whoAmI').then((r) => {
      if (!isFailure(r)) {
        setMe(r);
        setPersonId(r.accountId);
      }
    });
    call<{ spaces: { id: string; key: string; name: string }[] }>('listSpaces').then((r) => {
      setSpaces(isFailure(r) ? [] : r.spaces.map((s) => ({ label: `${s.name} (${s.key})`, value: s.id })));
    });
  }, []);

  const build = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    setPublished(null);
    setSent({});
    setOverrides({});
    setBulkResult(null);
    const r = await call<UiBrief>('buildBrief', { accountId: personId, start, end });
    setLoading(false);
    if (isFailure(r)) setError(r.error);
    else setBrief(r);
  };

  const chosen = (it: Item) => overrides[it.key] ?? it.standIn?.accountId ?? '';

  /** Briefs one stand-in; true when the briefing was sent. */
  const brieF = async (it: Item): Promise<boolean> => {
    const standInId = chosen(it);
    if (!standInId) return false;
    setSending(it.key);
    const r = await call<{ message: string }>('notify', { issueKey: it.key, standInId, start, end, note });
    setSending(null);
    setSent((prev) => ({ ...prev, [it.key]: isFailure(r) ? { ok: false, text: `Failed: ${r.error}` } : { ok: true, text: r.message } }));
    return !isFailure(r);
  };

  const doPublish = async () => {
    if (!spaceId) return;
    setPublishing(true);
    const r = await call<{ url: string; title: string }>('publish', { accountId: personId, start, end, overrides, spaceId });
    setPublishing(false);
    if (isFailure(r)) setError(r.error);
    else setPublished(r);
  };

  const askRovo = () => {
    const self = !me || personId === me.accountId;
    const who = self ? 'me' : brief?.person.displayName || personName || 'this person';
    rovo
      .open({
        ...AGENT,
        prompt: `Prepare the handover for ${who}, away from ${formatDay(start)} to ${formatDay(end)}. What must be covered, by whom, and why?`,
      })
      .catch(() => setError('Rovo chat is not available on this site.'));
  };

  const active = brief?.items.filter((i) => i.tier !== 'can-wait') ?? [];
  const later = brief?.items.filter((i) => i.tier === 'can-wait') ?? [];
  const optionsFor = (it: Item): Option[] => {
    const people = [it.standIn, ...it.alternatives].filter((p): p is NonNullable<typeof p> => Boolean(p));
    return people.map((p, i) => ({
      label: i === 0 && it.standIn && !it.chosenByHand ? `${p.displayName} (suggested)` : p.displayName,
      value: p.accountId,
    }));
  };
  const nameOf = (it: Item, accountId: string) =>
    [it.standIn, ...it.alternatives].find((p) => p?.accountId === accountId)?.displayName ?? 'Chosen stand-in';
  /** An alternative's context points, when the resolver sends them. */
  const altPoints = (it: Item, accountId: string): number | undefined => {
    const alt = it.alternatives.find((a) => a.accountId === accountId);
    const v = alt ? (alt as unknown as Record<string, unknown>).contextPoints : undefined;
    return typeof v === 'number' ? v : undefined;
  };

  // A gap: an item to cover with no stand-in, or whose stand-in has too
  // little context (under 3 points, the "low" confidence line).
  const isGap = (it: Item) => {
    const id = chosen(it);
    if (!id) return true;
    if (it.standIn?.accountId === id) return it.confidence === 'low';
    const p = altPoints(it, id);
    return p !== undefined && p < 3;
  };
  const gaps = active.filter(isGap).length;
  const coveredCount = active.length - gaps;

  // Who covers what, from the current picks rather than the first suggestion.
  const coverNow = new Map<string, { name: string; count: number }>();
  for (const it of active) {
    const id = chosen(it);
    if (!id) continue;
    const prev = coverNow.get(id);
    coverNow.set(id, { name: prev?.name ?? nameOf(it, id), count: (prev?.count ?? 0) + 1 });
  }
  const coverList = [...coverNow.entries()].sort((a, b) => b[1].count - a[1].count);

  const pending = active.filter((it) => chosen(it) && !sent[it.key]?.ok);
  const anyBriefed = Object.values(sent).some((s) => s.ok);
  const step = !brief ? 1 : anyBriefed || published ? 3 : 2;

  const briefAll = async () => {
    const queue = pending;
    if (!queue.length) return;
    setBulkResult(null);
    setBulk({ done: 0, total: queue.length });
    let ok = 0;
    const people = new Set<string>();
    let done = 0;
    for (const it of queue) {
      if (await brieF(it)) {
        ok++;
        people.add(chosen(it));
      }
      done++;
      setBulk({ done, total: queue.length });
    }
    setBulk(null);
    setBulkResult({ ok, people: people.size, failed: queue.length - ok });
  };

  const bulkText = (b: { ok: number; people: number; failed: number }) => {
    const main =
      b.ok === 0
        ? 'No stand-ins were briefed.'
        : b.people === b.ok
          ? `Briefed ${plural(b.ok, 'stand-in')}.`
          : `Briefed ${plural(b.people, 'stand-in')} on ${plural(b.ok, 'item')}.`;
    return b.failed ? `${main} ${b.failed} could not be sent; those rows say why.` : main;
  };

  const rows = active.map((it) => {
    const opts = optionsFor(it);
    const id = chosen(it);
    const current = opts.find((o) => o.value === id);
    const suggested = Boolean(it.standIn) && id === it.standIn?.accountId;
    const done = sent[it.key];
    return {
      key: it.key,
      cells: [
        {
          key: 'item',
          content: (
            <Stack space="space.050">
              <Inline space="space.100" alignBlock="center">
                <Link href={it.url} openNewTab>
                  {it.key}
                </Link>
                <Lozenge appearance={TIER[it.tier].appearance}>{TIER[it.tier].text}</Lozenge>
              </Inline>
              <Text>{it.summary}</Text>
              <Text size="small" color="color.text.subtle">
                {it.status}
                {it.dueDate ? ` · due ${formatDay(it.dueDate)}` : ''}
              </Text>
            </Stack>
          ),
        },
        {
          key: 'why',
          content: (
            <Inline space="space.050" shouldWrap>
              {it.flags.map((f) => (
                <Lozenge key={f}>{f}</Lozenge>
              ))}
            </Inline>
          ),
        },
        {
          key: 'who',
          content: opts.length ? (
            <Stack space="space.100">
              <Inline space="space.100" alignBlock="center">
                {id ? <User accountId={id} hideDisplayName /> : null}
                <Box xcss={picker}>
                  <Select
                    options={opts}
                    value={current}
                    placeholder="Pick a stand-in"
                    onChange={(o: Option) => setOverrides((prev) => ({ ...prev, [it.key]: o.value }))}
                    spacing="compact"
                  />
                </Box>
              </Inline>
              {suggested && it.standIn ? (
                <Evidence
                  name={it.standIn.displayName}
                  reasons={it.standIn.reasons}
                  points={contextPoints(it.standIn)}
                  high={it.confidence === 'high'}
                  showAll={showAll}
                  aside={<Lozenge appearance={CONFIDENCE[it.confidence].appearance}>{CONFIDENCE[it.confidence].text}</Lozenge>}
                />
              ) : id && altPoints(it, id) !== undefined ? (
                <Evidence
                  name={nameOf(it, id)}
                  reasons={[]}
                  points={altPoints(it, id)}
                  high={(altPoints(it, id) ?? 0) >= 6}
                  aside={<Lozenge appearance="default">Your pick</Lozenge>}
                />
              ) : id ? (
                <Text size="small" color="color.text.subtle">
                  Your pick. The briefing and the page use it.
                </Text>
              ) : (
                <Lozenge appearance="moved">Everyone with context is busy</Lozenge>
              )}
            </Stack>
          ) : (
            <Lozenge appearance="discovery">Nobody else has context</Lozenge>
          ),
        },
        {
          key: 'act',
          content: done?.ok ? (
            <Tooltip content={done.text}>
              <Lozenge appearance="success">Briefed</Lozenge>
            </Tooltip>
          ) : (
            <Stack space="space.050">
              <LoadingButton
                spacing="compact"
                isLoading={sending === it.key}
                isDisabled={!id || bulk !== null || (sending !== null && sending !== it.key)}
                onClick={() => brieF(it)}
              >
                Brief stand-in
              </LoadingButton>
              {done && (
                <Text size="small" color="color.text.danger">
                  {done.text}
                </Text>
              )}
            </Stack>
          ),
        },
      ],
    };
  });

  const tgOk = brief?.sources.teamworkGraph === 'ok';
  const tabs = brief
    ? [
        {
          key: 'later',
          title: `Can wait (${later.length})`,
          count: later.length,
          panel: (
            <Box padding="space.100">
              <List type="unordered">
                {later.slice(0, 30).map((it) => (
                  <ListItem key={it.key}>
                    <Link href={it.url} openNewTab>
                      {it.key}
                    </Link>{' '}
                    {it.summary} ({it.status})
                  </ListItem>
                ))}
              </List>
              {later.length > 30 && (
                <Text size="small" color="color.text.subtle">
                  {`And ${later.length - 30} more that can wait.`}
                </Text>
              )}
            </Box>
          ),
        },
        {
          key: 'code',
          title: `Code in flight (${brief.pullRequests.length})`,
          count: brief.pullRequests.length,
          panel: (
            <Box padding="space.100">
              <List type="unordered">
                {brief.pullRequests.map((p) => (
                  <ListItem key={p.id}>
                    <Lozenge appearance={p.status === 'OPEN' ? 'inprogress' : 'default'}>{p.status}</Lozenge>{' '}
                    {p.url ? (
                      <Link href={p.url} openNewTab>
                        {p.title}
                      </Link>
                    ) : (
                      p.title
                    )}
                    {p.workItemKey ? ` (${p.workItemKey})` : ''}
                  </ListItem>
                ))}
              </List>
            </Box>
          ),
        },
        {
          key: 'goals',
          title: `Goals and projects (${brief.goals.length})`,
          count: brief.goals.length,
          panel: (
            <Box padding="space.100">
              <List type="unordered">
                {brief.goals.map((g) => (
                  <ListItem key={g.id}>
                    {g.kind === 'goal' ? 'Goal: ' : 'Project: '}
                    {g.url ? (
                      <Link href={g.url} openNewTab>
                        {g.name}
                      </Link>
                    ) : (
                      g.name
                    )}
                    {g.state ? ` (${g.state.replace(/_/g, ' ').toLowerCase()})` : ''}
                  </ListItem>
                ))}
              </List>
            </Box>
          ),
        },
        {
          key: 'pages',
          title: `Pages (${brief.pages.length})`,
          count: brief.pages.length,
          panel: (
            <Box padding="space.100">
              <List type="unordered">
                {brief.pages.map((p) => (
                  <ListItem key={p.id}>
                    <Link href={p.url} openNewTab>
                      {p.title}
                    </Link>
                    {p.space ? ` in ${p.space}` : ''}
                  </ListItem>
                ))}
              </List>
            </Box>
          ),
        },
      ].filter((t) => t.count > 0)
    : [];

  return (
    <Stack space="space.300">
      <Steps current={step} finished={Boolean(published)} />

      <Text>Going away? Hand over your work with its context: what must be covered, who already knows it, and why.</Text>

      <Inline space="space.200" alignBlock="end" shouldWrap>
        <Box xcss={field}>
          {me ? (
            <UserPicker
              label="Who is going away?"
              name="person"
              defaultValue={me.accountId}
              onChange={(u) => {
                setPersonId(u?.id ?? me.accountId);
                setPersonName(u?.name ?? '');
              }}
            />
          ) : (
            <Spinner label="Loading" />
          )}
        </Box>
        <Stack space="space.050">
          <Label labelFor="away-from">Away from</Label>
          <DatePicker id="away-from" value={start} onChange={(v) => setStart(v)} />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="away-until">Until (inclusive)</Label>
          <DatePicker id="away-until" value={end} onChange={(v) => setEnd(v)} />
        </Stack>
        <LoadingButton appearance="primary" isLoading={loading} isDisabled={!personId} onClick={build}>
          Build handover
        </LoadingButton>
        <Button appearance="subtle" onClick={askRovo}>
          Ask Understudy in Rovo
        </Button>
      </Inline>

      {error && (
        <SectionMessage appearance="error" title="Something went wrong">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {!brief && !loading && (
        <EmptyState
          header="Pick who is going away and when"
          headingLevel={2}
          description="Understudy reads their open Jira work, pull requests, goals and pages, then suggests who should cover each item and explains why."
          primaryAction={
            <Button appearance="primary" isDisabled={!personId} onClick={build}>
              Build handover
            </Button>
          }
        />
      )}

      {loading && (
        <Box padding="space.400">
          <Stack space="space.150" alignInline="center">
            <Spinner size="large" label="Building the handover" />
            <Text color="color.text.subtle">
              Reading open Jira work items and their comments, related work, team load, pull requests, goals and Confluence pages
            </Text>
          </Stack>
        </Box>
      )}

      {brief && !loading && (
        <Stack space="space.300">
          <Box xcss={card}>
            <Stack space="space.200">
              <Inline space="space.150" alignBlock="center" spread="space-between" shouldWrap>
                <Heading size="medium" as="h2">
                  Plan health
                </Heading>
                {gaps === 0 ? (
                  <Lozenge appearance="success">Ready to hand over</Lozenge>
                ) : (
                  <Lozenge appearance="warning">{plural(gaps, 'gap')}</Lozenge>
                )}
              </Inline>
              <Text>{brief.headline}</Text>
              <Text size="small" color="color.text.subtle">
                Away {formatDay(brief.absence.start)} to {formatDay(brief.absence.end)}. Pick a different stand-in from any list; the briefings
                and the page you publish use your choices.
              </Text>
              {active.length > 0 && (
                <Stack space="space.075">
                  <Text size="small">
                    <Strong>{`${coveredCount} of ${active.length}`}</Strong> items to cover have a stand-in with context
                  </Text>
                  <ProgressBar
                    value={coveredCount / active.length}
                    appearance={gaps === 0 ? 'success' : 'default'}
                    ariaLabel={`${coveredCount} of ${active.length} items to cover have a stand-in with context`}
                  />
                </Stack>
              )}
              {coverList.length > 0 && (
                <Inline space="space.150" alignBlock="center" shouldWrap>
                  <UserGroup>
                    {coverList.map(([accountId]) => (
                      <User key={accountId} accountId={accountId} />
                    ))}
                  </UserGroup>
                  <Text size="small" color="color.text.subtle">
                    {coverList.map(([, c]) => `${c.name}: ${plural(c.count, 'item')}`).join(' · ')}
                  </Text>
                </Inline>
              )}
              <Inline space="space.150" shouldWrap>
                <Stat value={brief.stats.open} label="Open items" glyph="work-items" />
                <Stat value={brief.stats.must} label="Must be covered" glyph="flag" />
                <Stat value={brief.stats.dueWhileAway} label="Due while away" glyph="calendar" />
                <Stat
                  value={brief.stats.soloKnowledge}
                  label={`Only ${brief.person.displayName} knows`}
                  glyph="person-warning"
                  warning={brief.stats.soloKnowledge > 0}
                />
              </Inline>
            </Stack>
          </Box>

          {brief.soloKnowledge.length > 0 && (
            <SectionMessage appearance="warning" title={`Only ${brief.person.displayName} has context on these`}>
              <Stack space="space.075">
                <Text>Nobody else has commented on them or worked nearby. Book a short walkthrough before leaving.</Text>
                {brief.soloKnowledge.map((k) => {
                  const it = brief.items.find((i) => i.key === k);
                  return (
                    <Text key={k} maxLines={1}>
                      <Link href={it?.url ?? '#'} openNewTab>
                        {k}
                      </Link>
                      {it?.summary ? ` ${it.summary}` : ''}
                    </Text>
                  );
                })}
              </Stack>
            </SectionMessage>
          )}

          <Stack space="space.150">
            <Inline space="space.150" alignBlock="center" spread="space-between" shouldWrap>
              <Heading size="medium" as="h2">
                Cover plan
              </Heading>
              <Inline space="space.075" alignBlock="center">
                <Toggle id="show-reasons" label="Show every reason" isChecked={showAll} onChange={() => setShowAll((v) => !v)} />
                <Label labelFor="show-reasons">Show every reason</Label>
              </Inline>
            </Inline>
            <Stack space="space.050">
              <Label labelFor="briefing-note">Note added to every briefing (optional)</Label>
              <TextArea
                id="briefing-note"
                name="note"
                placeholder="For example, where the runbook is."
                value={note}
                onChange={(e) => setNote(String(e.target.value ?? ''))}
              />
            </Stack>
            <Inline space="space.150" alignBlock="center" shouldWrap>
              <LoadingButton appearance="primary" isLoading={bulk !== null} isDisabled={pending.length === 0 || sending !== null} onClick={briefAll}>
                {pending.length > 0 ? `Brief all stand-ins (${pending.length})` : 'Brief all stand-ins'}
              </LoadingButton>
              {bulk ? (
                <Text size="small">{`Briefing ${Math.min(bulk.done + 1, bulk.total)} of ${bulk.total}`}</Text>
              ) : bulkResult ? (
                <Inline space="space.075" alignBlock="center">
                  <Icon
                    glyph={bulkResult.failed ? 'warning' : 'check-circle'}
                    label=""
                    color={bulkResult.failed ? 'color.icon.warning' : 'color.icon.success'}
                  />
                  <Text size="small">{bulkText(bulkResult)}</Text>
                </Inline>
              ) : pending.length === 0 && anyBriefed ? (
                <Text size="small" color="color.text.subtle">
                  Every stand-in is briefed.
                </Text>
              ) : null}
            </Inline>
            {bulk && (
              <ProgressBar value={bulk.done / bulk.total} ariaLabel={`Briefed ${bulk.done} of ${bulk.total} stand-ins`} />
            )}
            <DynamicTable
              label="Cover plan"
              head={{
                cells: [
                  { key: 'item', content: 'Work item', width: 30 },
                  { key: 'why', content: 'Why it matters', width: 16 },
                  { key: 'who', content: 'Stand-in and evidence', width: 40 },
                  { key: 'act', content: 'Briefing', width: 14 },
                ],
              }}
              rows={rows}
              rowsPerPage={15}
              emptyView={
                <EmptyState
                  header="Nothing needs cover"
                  headingLevel={3}
                  width="narrow"
                  description="No open item is urgent enough to hand over. Items that can wait are listed below."
                />
              }
            />
          </Stack>

          {tabs.length > 0 && (
            <Tabs id="context">
              <TabList>
                {tabs.map((t) => (
                  <Tab key={t.key}>{t.title}</Tab>
                ))}
              </TabList>
              {tabs.map((t) => (
                <TabPanel key={t.key}>{t.panel}</TabPanel>
              ))}
            </Tabs>
          )}
          {!tgOk && (
            <Text size="small" color="color.text.subtle">
              {brief.sources.teamworkGraph === 'empty'
                ? 'Teamwork Graph has no code in flight or goals for this person.'
                : 'Code in flight and goals come from Teamwork Graph, which is not available on this site.'}
            </Text>
          )}

          <Stack space="space.100">
            <Heading size="medium" as="h2">
              Publish the handover
            </Heading>
            <Inline space="space.150" alignBlock="end" shouldWrap>
              <Box xcss={field}>
                {spaces === null ? (
                  <Spinner label="Loading spaces" />
                ) : spaces.length === 0 ? (
                  <Text size="small">Connect Understudy to Confluence to publish handover pages.</Text>
                ) : (
                  <Select placeholder="Confluence space" options={spaces} onChange={(o: Option) => setSpaceId(o.value)} />
                )}
              </Box>
              <LoadingButton appearance="primary" isLoading={publishing} isDisabled={!spaceId} onClick={doPublish}>
                Publish handover page
              </LoadingButton>
            </Inline>
            {published && (
              <SectionMessage
                appearance="success"
                title="Handover page published"
                actions={[
                  <SectionMessageAction key="open" href={published.url}>
                    Open handover page
                  </SectionMessageAction>,
                ]}
              >
                <Text>{published.title}</Text>
              </SectionMessage>
            )}
          </Stack>

          <SourceLine brief={brief} />
        </Stack>
      )}
    </Stack>
  );
};

const WelcomeBack = () => {
  const [me, setMe] = useState<{ accountId: string; displayName: string } | null>(null);
  const [personId, setPersonId] = useState('');
  const [personName, setPersonName] = useState('');
  const [since, setSince] = useState<string>(plusDays(-7));
  const [data, setData] = useState<UiWelcomeBack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<{ accountId: string; displayName: string }>('whoAmI').then((r) => {
      if (!isFailure(r)) {
        setMe(r);
        setPersonId(r.accountId);
      }
    });
  }, []);

  const run = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    const r = await call<UiWelcomeBack>('welcomeBack', { accountId: personId, since });
    setLoading(false);
    if (isFailure(r)) setError(r.error);
    else setData(r);
  };

  const askRovo = () => {
    const self = !me || personId === me.accountId;
    const who = data?.person.displayName || personName || 'this person';
    const prompt = self
      ? `Welcome me back. I was away from ${formatDay(since)}. What changed on my work and what needs me first?`
      : `${who} is back. ${who} was away from ${formatDay(since)}. What changed on ${who}'s work and what needs ${who} first?`;
    rovo.open({ ...AGENT, prompt }).catch(() => setError('Rovo chat is not available on this site.'));
  };

  const rows = (data?.items ?? []).map((i) => ({
    key: i.key,
    isHighlighted: i.needsYou,
    cells: [
      {
        key: 'item',
        content: (
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="center">
              <Link href={i.url} openNewTab>
                {i.key}
              </Link>
              <Lozenge appearance={i.statusCategory === 'done' ? 'success' : i.statusCategory === 'indeterminate' ? 'inprogress' : 'default'}>
                {i.status}
              </Lozenge>
            </Inline>
            <Text>{i.summary}</Text>
          </Stack>
        ),
      },
      {
        key: 'what',
        content: (
          <Inline space="space.050" shouldWrap>
            {i.needsYou && <Lozenge appearance="removed">Needs you</Lozenge>}
            {i.labels.map((l) => (
              <Lozenge key={l}>{l}</Lozenge>
            ))}
          </Inline>
        ),
      },
      {
        key: 'latest',
        content: (
          <Stack space="space.025">
            {i.events.map((e) => (
              <Text key={`${e.at}-${e.text}`} size="small">
                <Strong>{e.by}</Strong> {e.text}
              </Text>
            ))}
          </Stack>
        ),
      },
      { key: 'covered', content: <Text size="small">{i.coveredBy ?? '—'}</Text> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Text>Back from time off? See what moved on your work, who needs you, and what your stand-ins handled.</Text>
      <Inline space="space.200" alignBlock="end" shouldWrap>
        <Box xcss={field}>
          {me ? (
            <UserPicker
              label="Who is back?"
              name="returner"
              defaultValue={me.accountId}
              onChange={(u) => {
                setPersonId(u?.id ?? me.accountId);
                setPersonName(u?.name ?? '');
              }}
            />
          ) : (
            <Spinner label="Loading" />
          )}
        </Box>
        <Stack space="space.050">
          <Label labelFor="away-since">First day away</Label>
          <DatePicker id="away-since" value={since} onChange={(v) => setSince(v)} />
        </Stack>
        <LoadingButton appearance="primary" isLoading={loading} isDisabled={!personId} onClick={run}>
          What changed?
        </LoadingButton>
        <Button appearance="subtle" onClick={askRovo}>
          Ask Understudy in Rovo
        </Button>
      </Inline>

      {error && (
        <SectionMessage appearance="error" title="Something went wrong">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {!data && !loading && (
        <EmptyState
          header="Pick who is back and their first day away"
          headingLevel={2}
          description="Understudy reads what other people did on their work since then: status changes, reassignments, comments and mentions, and which stand-in covered what."
          primaryAction={
            <Button appearance="primary" isDisabled={!personId} onClick={run}>
              What changed?
            </Button>
          }
        />
      )}

      {loading && (
        <Box padding="space.400">
          <Stack space="space.150" alignInline="center">
            <Spinner size="large" label="Catching up" />
            <Text color="color.text.subtle">Reading status changes, reassignments, comments and mentions since {formatDay(since)}</Text>
          </Stack>
        </Box>
      )}

      {data && !loading && (
        <Stack space="space.300">
          <Box xcss={card}>
            <Stack space="space.200">
              <Inline space="space.150" alignBlock="center" spread="space-between" shouldWrap>
                <Heading size="medium" as="h2">
                  Catch-up
                </Heading>
                {data.stats.needsYou > 0 ? (
                  <Lozenge appearance="warning">{`${data.stats.needsYou} need you`}</Lozenge>
                ) : (
                  <Lozenge appearance="success">Nothing waiting on you</Lozenge>
                )}
              </Inline>
              <Text>{data.headline}</Text>
              {data.stats.changed > 0 && (
                <Stack space="space.075">
                  <Text size="small">
                    <Strong>{`${data.stats.needsYou} of ${data.stats.changed}`}</Strong> changed items need you. They are listed first.
                  </Text>
                  <ProgressBar
                    value={Math.min(1, data.stats.needsYou / data.stats.changed)}
                    ariaLabel={`${data.stats.needsYou} of ${data.stats.changed} changed items need you`}
                  />
                </Stack>
              )}
              <Inline space="space.150" shouldWrap>
                <Stat value={data.stats.changed} label="Items changed" glyph="changes" />
                <Stat value={data.stats.needsYou} label="Need you" glyph="person-warning" warning={data.stats.needsYou > 0} />
                <Stat value={data.stats.mentions} label="Mention you" glyph="comment" />
                <Stat value={data.stats.covered} label="Covered by a stand-in" glyph="people-group" />
              </Inline>
              {data.stats.finished > 0 && (
                <Text size="small" color="color.text.subtle">{`${plural(data.stats.finished, 'item')} finished while you were away.`}</Text>
              )}
            </Stack>
          </Box>
          <DynamicTable
            label="What changed while you were away"
            head={{
              cells: [
                { key: 'item', content: 'Work item', width: 32 },
                { key: 'what', content: 'What happened', width: 22 },
                { key: 'latest', content: 'Latest', width: 32 },
                { key: 'covered', content: 'Covered by', width: 14 },
              ],
            }}
            rows={rows}
            rowsPerPage={15}
            emptyView={<EmptyState header="Nothing changed while you were away" headingLevel={3} width="narrow" />}
          />
        </Stack>
      )}
    </Stack>
  );
};

const App = () => (
  <Stack space="space.200">
    <Tabs id="mode">
      <TabList>
        <Tab>Before you go</Tab>
        <Tab>Welcome back</Tab>
      </TabList>
      <TabPanel>
        <Box paddingBlockStart="space.200">
          <Handover />
        </Box>
      </TabPanel>
      <TabPanel>
        <Box paddingBlockStart="space.200">
          <WelcomeBack />
        </Box>
      </TabPanel>
    </Tabs>
  </Stack>
);

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
