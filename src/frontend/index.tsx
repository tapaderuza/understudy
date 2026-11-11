import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DatePicker,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Label,
  Link,
  List,
  ListItem,
  LoadingButton,
  Lozenge,
  SectionMessage,
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
  User,
  UserPicker,
  xcss,
} from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import type { UiBrief, UiWelcomeBack } from '../resolvers';
import { formatDay } from '../core/dates';

type Item = UiBrief['items'][number];
type Option = { label: string; value: string };
type Failure = { error: string };

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

const tile = xcss({
  backgroundColor: 'color.background.neutral.subtle',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.medium',
  padding: 'space.150',
  minWidth: '120px',
});

const field = xcss({ minWidth: '220px' });

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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Box xcss={tile}>
      <Stack space="space.050">
        <Heading size="large">{String(value)}</Heading>
        <Text size="small">{label}</Text>
      </Stack>
    </Box>
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
  const [sent, setSent] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);

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
    setLoading(true);
    setError(null);
    setPublished(null);
    setSent({});
    setOverrides({});
    const r = await call<UiBrief>('buildBrief', { accountId: personId, start, end });
    setLoading(false);
    if (isFailure(r)) setError(r.error);
    else setBrief(r);
  };

  const chosen = (it: Item) => overrides[it.key] ?? it.standIn?.accountId ?? '';

  const brieF = async (it: Item) => {
    const standInId = chosen(it);
    if (!standInId) return;
    setSending(it.key);
    const r = await call<{ message: string }>('notify', { issueKey: it.key, standInId, start, end, note });
    setSending(null);
    setSent((prev) => ({ ...prev, [it.key]: isFailure(r) ? `Failed: ${r.error}` : r.message }));
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

  const rows = active.map((it) => {
    const opts = optionsFor(it);
    const current = opts.find((o) => o.value === chosen(it));
    const reasons = it.standIn && chosen(it) === it.standIn.accountId ? it.standIn.reasons : [];
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
            <Stack space="space.050">
              <Select
                options={opts}
                value={current}
                placeholder="Pick a stand-in"
                onChange={(o: Option) => setOverrides((prev) => ({ ...prev, [it.key]: o.value }))}
                spacing="compact"
              />
              {it.standIn ? (
                <Lozenge appearance={CONFIDENCE[it.confidence].appearance}>{CONFIDENCE[it.confidence].text}</Lozenge>
              ) : (
                <Lozenge appearance="moved">Everyone with context is busy</Lozenge>
              )}
            </Stack>
          ) : (
            <Lozenge appearance="discovery">Nobody else has context</Lozenge>
          ),
        },
        {
          key: 'because',
          content: (
            <Stack space="space.025">
              {reasons.slice(0, 4).map((r) => (
                <Text key={r.text} size="small" color={r.points < 0 ? 'color.text.warning' : 'color.text'}>
                  {r.points > 0 ? `+${r.points}` : String(r.points)} {r.text}
                </Text>
              ))}
            </Stack>
          ),
        },
        {
          key: 'act',
          content: sent[it.key] ? (
            <Text size="small">{sent[it.key]}</Text>
          ) : (
            <LoadingButton isLoading={sending === it.key} isDisabled={!chosen(it)} onClick={() => brieF(it)}>
              Brief stand-in
            </LoadingButton>
          ),
        },
      ],
    };
  });

  return (
    <Stack space="space.300">
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
          description="Understudy reads their open Jira work, pull requests, goals and pages, then suggests who should cover each item and explains why."
        />
      )}

      {brief && (
        <Stack space="space.300">
          <SectionMessage appearance={brief.stats.soloKnowledge > 0 ? 'warning' : 'information'} title={brief.headline}>
            <Text>
              Away {formatDay(brief.absence.start)} to {formatDay(brief.absence.end)}. Pick a different stand-in from any list; the page you
              publish uses your choices.
            </Text>
          </SectionMessage>

          <Inline space="space.150" shouldWrap>
            <Stat value={brief.stats.open} label="Open items" />
            <Stat value={brief.stats.must} label="Must be covered" />
            <Stat value={brief.stats.dueWhileAway} label="Due while away" />
            <Stat value={brief.stats.soloKnowledge} label={`Only ${brief.person.displayName} knows`} />
            <Stat value={brief.stats.openPullRequests} label="Pull requests in flight" />
            <Stat value={brief.stats.standIns} label="Stand-ins" />
          </Inline>

          {brief.soloKnowledge.length > 0 && (
            <SectionMessage appearance="warning" title={`Only ${brief.person.displayName} has context on these`}>
              <Stack space="space.100">
                <Text>Nobody else has commented on them or worked nearby. Book a short walkthrough before leaving.</Text>
                <List type="unordered">
                  {brief.soloKnowledge.map((k) => {
                    const it = brief.items.find((i) => i.key === k);
                    return (
                      <ListItem key={k}>
                        <Link href={it?.url ?? '#'} openNewTab>
                          {k}
                        </Link>{' '}
                        {it?.summary}
                      </ListItem>
                    );
                  })}
                </List>
              </Stack>
            </SectionMessage>
          )}

          {brief.cover.length > 0 && (
            <Stack space="space.100">
              <Heading size="medium">Who covers what</Heading>
              <Inline space="space.200" shouldWrap>
                {brief.cover.map((c) => (
                  <Inline key={c.accountId} space="space.100" alignBlock="center">
                    <User accountId={c.accountId} />
                    <Text>
                      <Strong>{String(c.itemKeys.length)}</Strong> {c.itemKeys.length === 1 ? 'item' : 'items'}
                    </Text>
                  </Inline>
                ))}
              </Inline>
            </Stack>
          )}

          <Stack space="space.100">
            <Heading size="medium">Cover plan</Heading>
            <DynamicTable
              caption={active.length ? undefined : 'Nothing urgent to cover.'}
              head={{
                cells: [
                  { key: 'item', content: 'Work item' },
                  { key: 'why', content: 'Why it matters' },
                  { key: 'who', content: 'Stand-in' },
                  { key: 'because', content: 'Why this stand-in' },
                  { key: 'act', content: '' },
                ],
              }}
              rows={rows}
              rowsPerPage={15}
              emptyView={<Text>Nothing urgent to cover.</Text>}
            />
            <TextArea
              name="note"
              placeholder="Optional note added to every stand-in briefing, e.g. where the runbook is."
              value={note}
              onChange={(e) => setNote(String(e.target.value ?? ''))}
            />
          </Stack>

          <Tabs id="context">
            <TabList>
              <Tab>{`Can wait (${later.length})`}</Tab>
              <Tab>{`Code in flight (${brief.pullRequests.length})`}</Tab>
              <Tab>{`Goals and projects (${brief.goals.length})`}</Tab>
              <Tab>{`Pages (${brief.pages.length})`}</Tab>
            </TabList>
            <TabPanel>
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
            </TabPanel>
            <TabPanel>
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
            </TabPanel>
            <TabPanel>
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
            </TabPanel>
            <TabPanel>
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
            </TabPanel>
          </Tabs>

          <Stack space="space.100">
            <Heading size="medium">Publish the handover</Heading>
            <Inline space="space.150" alignBlock="end" shouldWrap>
              <Box xcss={field}>
                {spaces === null ? (
                  <Spinner label="Loading spaces" />
                ) : spaces.length === 0 ? (
                  <Text size="small">Connect Understudy to Confluence to publish handover pages.</Text>
                ) : (
                  <Select
                    placeholder="Confluence space"
                    options={spaces}
                    onChange={(o: Option) => setSpaceId(o.value)}
                  />
                )}
              </Box>
              <LoadingButton appearance="primary" isLoading={publishing} isDisabled={!spaceId} onClick={doPublish}>
                Publish handover page
              </LoadingButton>
            </Inline>
            {published && (
              <SectionMessage appearance="success" title="Handover page published">
                <Link href={published.url} openNewTab>
                  {published.title}
                </Link>
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
          description="Understudy reads what other people did on their work since then: status changes, reassignments, comments and mentions, and which stand-in covered what."
        />
      )}

      {data && (
        <Stack space="space.200">
          <SectionMessage appearance={data.stats.needsYou > 0 ? 'warning' : 'success'} title={data.headline}>
            <Text>Items that need you are listed first.</Text>
          </SectionMessage>
          <Inline space="space.150" shouldWrap>
            <Stat value={data.stats.changed} label="Items changed" />
            <Stat value={data.stats.needsYou} label="Need you" />
            <Stat value={data.stats.mentions} label="Mention you" />
            <Stat value={data.stats.finished} label="Finished" />
            <Stat value={data.stats.covered} label="Covered by a stand-in" />
          </Inline>
          <DynamicTable
            head={{
              cells: [
                { key: 'item', content: 'Work item' },
                { key: 'what', content: 'What happened' },
                { key: 'latest', content: 'Latest' },
                { key: 'covered', content: 'Covered by' },
              ],
            }}
            rows={rows}
            rowsPerPage={15}
            emptyView={<Text>Nothing changed while you were away.</Text>}
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
