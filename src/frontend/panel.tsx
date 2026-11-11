import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Inline, LoadingButton, Lozenge, SectionMessage, Spinner, Stack, Strong, Text, TextArea, User, xcss } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { IssuePanelData } from '../resolvers';

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

const card = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.medium',
  padding: 'space.100',
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
  if (!data) return <Spinner label="Finding who could cover this" />;

  return (
    <Stack space="space.150">
      <Text>
        If <Strong>{data.owner.displayName}</Strong> is away, who could cover {data.item.key}?
      </Text>
      <Inline space="space.050" shouldWrap>
        <Lozenge appearance={CONFIDENCE[data.confidence].appearance}>{CONFIDENCE[data.confidence].text}</Lozenge>
        {data.whyItMatters.map((w) => (
          <Lozenge key={w}>{w}</Lozenge>
        ))}
      </Inline>

      {data.candidates.length === 0 && (
        <SectionMessage appearance="discovery" title="Nobody else has context yet">
          <Text>No one else has commented on this item or worked nearby. A 15-minute walkthrough now saves days later.</Text>
        </SectionMessage>
      )}

      {data.candidates.slice(0, 3).map((c, i) => (
        <Box key={c.accountId} xcss={card}>
          <Stack space="space.075">
            <Inline spread="space-between" alignBlock="center">
              <User accountId={c.accountId} />
              {i === 0 ? <Lozenge appearance="success">Best fit</Lozenge> : <Text size="small">{`Score ${c.score}`}</Text>}
            </Inline>
            {c.reasons.map((r) => (
              <Text key={r.text} size="small" color={r.points < 0 ? 'color.text.warning' : 'color.text.subtle'}>
                {r.points > 0 ? `+${r.points}` : String(r.points)} {r.text}
              </Text>
            ))}
            {sent ? null : (
              <LoadingButton spacing="compact" isLoading={sending === c.accountId} onClick={() => brief(c.accountId)}>
                Brief {c.displayName}
              </LoadingButton>
            )}
          </Stack>
        </Box>
      ))}

      {sent ? (
        <SectionMessage appearance="success">
          <Text>{sent}</Text>
        </SectionMessage>
      ) : (
        data.candidates.length > 0 && (
          <TextArea
            name="note"
            placeholder="Optional note for the stand-in, e.g. where the runbook is."
            value={note}
            onChange={(e) => setNote(String(e.target.value ?? ''))}
          />
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
