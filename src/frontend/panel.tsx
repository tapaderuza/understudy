import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  TextArea,
  User,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import type { IssuePanelData } from '../resolvers';
import { Evidence, contextPoints, plainNumber } from './evidence';

type Failure = { error: string };
const isFailure = (x: unknown): x is Failure => typeof x === 'object' && x !== null && 'error' in x;

async function call<T>(key: string, payload?: Record<string, unknown>): Promise<T | Failure> {
  try {
    const r: unknown = await invoke(key, payload);
    if (r && typeof r === 'object' && 'body' in r && !('error' in r)) return (r as { body: T }).body;
    return r as T | Failure;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Reads a field the resolver may or may not send yet (e.g. noAssignee). */
const fieldOf = (o: object, k: string): unknown => (o as Record<string, unknown>)[k];

const card = xcss({
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  borderRadius: 'radius.large',
  padding: 'space.150',
});

const CONFIDENCE = {
  high: { text: 'Someone knows this well', appearance: 'success' as const },
  medium: { text: 'Some shared context', appearance: 'inprogress' as const },
  low: { text: 'Only the owner knows this', appearance: 'discovery' as const },
};

const Panel = () => {
  const [data, setData] = useState<IssuePanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    call<IssuePanelData>('issueStandIns').then((r) => (isFailure(r) ? setError(r.error) : setData(r)));
  }, []);

  const brief = async (accountId: string) => {
    if (!data) return;
    setSending(accountId);
    const r = await call<{ message: string }>('notify', { issueKey: data.item.key, standInId: accountId, note });
    setSending(null);
    if (isFailure(r)) setError(r.error);
    else setSent(r.message);
  };

  if (error) {
    return (
      <SectionMessage appearance="warning" title="Understudy could not read this work item">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!data) {
    return (
      <Stack space="space.100" alignInline="center">
        <Spinner label="Finding who could cover this" />
        <Text size="small" color="color.text.subtle">
          Reading comments, related work and team load
        </Text>
      </Stack>
    );
  }

  const key = data.item?.key ?? 'this work item';
  const ownerName = data.owner?.displayName;
  // The resolver may flag this as noAssignee or unassigned, or just send no owner.
  if (fieldOf(data, 'noAssignee') === true || fieldOf(data, 'unassigned') === true || !data.owner?.accountId) {
    const message = fieldOf(data, 'notice') ?? fieldOf(data, 'message');
    return (
      <SectionMessage appearance="information" title="This work item has no assignee">
        <Text>
          {typeof message === 'string' && message
            ? message
            : `Assign ${key} to someone and Understudy shows who could cover it while they are away.`}
        </Text>
      </SectionMessage>
    );
  }

  const best = data.candidates[0];
  const shown = data.candidates.slice(0, 3);

  return (
    <Stack space="space.200">
      <Stack space="space.075">
        <Heading size="small" as="h3">
          {best ? `${best.displayName} can cover ${key}` : `Nobody else has context on ${key}`}
        </Heading>
        <Text size="small" color="color.text.subtle">
          If <Strong>{ownerName ?? 'the assignee'}</Strong> is away, this is who already knows the work.
        </Text>
        <Inline space="space.050" shouldWrap>
          <Lozenge appearance={CONFIDENCE[data.confidence].appearance}>{CONFIDENCE[data.confidence].text}</Lozenge>
          {data.whyItMatters.map((w) => (
            <Lozenge key={w}>{w}</Lozenge>
          ))}
        </Inline>
      </Stack>

      {shown.length === 0 && (
        <SectionMessage appearance="discovery" title="Book a short walkthrough">
          <Text>No one else has commented on this item or worked nearby. A 15-minute walkthrough now saves days later.</Text>
        </SectionMessage>
      )}

      {shown.map((c, i) => {
        const open = Boolean(expanded[c.accountId]);
        return (
          <Box key={c.accountId} xcss={card}>
            <Stack space="space.100">
              <Inline space="space.100" alignBlock="center" spread="space-between" shouldWrap>
                <Inline space="space.100" alignBlock="center">
                  <User accountId={c.accountId} />
                  {i === 0 && <Lozenge appearance="success">Best fit</Lozenge>}
                </Inline>
                <Text size="small" color="color.text.subtle">{`Score ${plainNumber(c.score)}`}</Text>
              </Inline>
              <Evidence name={c.displayName} reasons={c.reasons} high={contextPoints(c) >= 6} showAll={open} />
              <Inline space="space.100" alignBlock="center" shouldWrap>
                {sent ? null : (
                  <LoadingButton
                    spacing="compact"
                    appearance={i === 0 ? 'primary' : 'default'}
                    isLoading={sending === c.accountId}
                    isDisabled={sending !== null && sending !== c.accountId}
                    onClick={() => brief(c.accountId)}
                  >
                    {`Brief ${c.displayName}`}
                  </LoadingButton>
                )}
                {c.reasons.length > 0 && (
                  <Button
                    appearance="subtle"
                    spacing="compact"
                    onClick={() => setExpanded((prev) => ({ ...prev, [c.accountId]: !open }))}
                  >
                    {open ? 'Hide full reasons' : 'Show full reasons'}
                  </Button>
                )}
              </Inline>
            </Stack>
          </Box>
        );
      })}

      {sent ? (
        <SectionMessage appearance="success" title="Stand-in briefed">
          <Text>{sent}</Text>
        </SectionMessage>
      ) : (
        shown.length > 0 && (
          <Stack space="space.050">
            <Label labelFor="panel-note">Note for the stand-in (optional)</Label>
            <TextArea
              id="panel-note"
              name="note"
              placeholder="For example, where the runbook is."
              value={note}
              onChange={(e) => setNote(String(e.target.value ?? ''))}
            />
          </Stack>
        )
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
