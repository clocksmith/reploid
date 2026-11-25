import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Grow, Row, Sheet, Stack, Wordmark } from '@reploid/poolday-ui';
import { completionOf, projectMessages, projectThreads } from '../application/projections';
import { modelKey, projectModelSheet, sideForModel, type SheetSelection } from '../application/answerSheet';
import type { ComposerState } from '../domain/chat';
import type { SheetSide } from '../domain/decisions';
import type { HostModel } from '../domain/session';
import { strings } from '../../../l10n/strings';
import { useChatServices, useChatState } from './chatServices';
import { ChatThread } from './ChatThread';
import { DownloadReview } from './DownloadReview';
import { ModelSheet } from './ModelSheet';
import { ThreadList } from './ThreadList';

const t = strings.chat;

/** A policy that keeps the prompt on this device (placement local-only, or no recipients). */
const keepsLocal = (privacy: unknown) => {
  const value = privacy as { placement?: string; recipients?: { kind?: string } } | null | undefined;
  return !value || value.placement === 'local-only' || value.recipients?.kind === 'none';
};

const gigabytes = (bytes: number) => `${(bytes / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`;

type Chosen = { readonly model: HostModel | null; readonly side: SheetSide; readonly privacy: unknown };

/**
 * The conversation screen on the host's real session: threads, the transcript with receipts, the
 * composer, and the "Answer on" sheet. The host executes and records; this screen only stages
 * choices and calls its commands.
 */
export function ChatWorkspace() {
  const { chat, decisions } = useChatServices();
  const state = useChatState();
  const thread = state.activeThread;
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const seen = useRef(new Map<string, string>());
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState(() => chat.getDraft(state.selectedId)?.text ?? '');
  const draftOwner = useRef(state.selectedId);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen>(() => ({ model: null, side: 'local', privacy: decisions.localPolicy() }));
  const [sendAfterChoice, setSendAfterChoice] = useState(false);
  // Send pressed while computers are still being found: it waits for one that runs this model.
  const [queued, setQueued] = useState(false);
  const [review, setReview] = useState<{ readonly model: HostModel; readonly size: string | null; readonly error: string | null } | null>(null);
  const [sheet, setSheet] = useState<{ readonly open: boolean; readonly forSend: boolean; readonly selection: SheetSelection }>({
    open: false,
    forSend: false,
    selection: { side: 'local', model: null, implied: false },
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Each thread keeps its own draft; switching threads restores the other one.
  useEffect(() => {
    if (draftOwner.current === state.selectedId) return;
    draftOwner.current = state.selectedId;
    setDraft(chat.getDraft(state.selectedId)?.text ?? '');
    setError(null);
  }, [chat, state.selectedId]);

  if (thread && thread.attempts.at(-1)?.status === 'completed') seen.current.set(thread.id, completionOf(thread));

  const privacy = thread ? thread.privacy : chosen.privacy;
  const side: SheetSide = thread ? (thread.permissions?.sharingScope === 'local' || keepsLocal(privacy) ? 'local' : 'network') : chosen.side;
  const model: HostModel | null =
    thread?.model ?? chosen.model ?? state.defaultModels?.[side] ?? state.defaultModel ?? state.models?.[0] ?? null;
  const block = decisions.contributorBlock({ activeThread: Boolean(thread), privacy, preset: null });
  const running = Boolean(thread && (state.runningIds ?? []).includes(thread.id));
  const outcome = decisions.describeAnswerChoice(model, side, { state, block, canDownload: decisions.canDownload, choice: null, locked: null, sending: false, implied: false });
  const usable = decisions.executionState(model, side).usable;

  const sheetState = useMemo(
    () => projectModelSheet(state, sheet.selection, { decisions, block, sending: sheet.forSend, labels: { thisDevice: strings.computers.thisDevice, contributors: strings.computers.contributors } }),
    [state, sheet.selection, sheet.forSend, decisions, block],
  );

  const act = (work: () => unknown) => {
    setError(null);
    Promise.resolve()
      .then(work)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const openSheet = (forSend: boolean) => setSheet({ open: true, forSend, selection: { side, model, implied: false } });
  // A new thread keeps the model, computer and privacy in use; it does not return to the defaults.
  const startNewThread = (after?: () => void) =>
    act(async () => {
      setChosen({ model, side, privacy });
      await chat.select(null);
      after?.();
    });
  const closeSheet = () => setSheet((current) => ({ ...current, open: false, forSend: false }));

  const canWait =
    side === 'network' &&
    Boolean(model?.identity) &&
    !model?.partition &&
    !model?.fleet &&
    !keepsLocal(privacy) &&
    !running &&
    !thread?.closed &&
    state.discoveryPhase === 'searching';

  const send = () =>
    act(async () => {
      const content = draft.trim();
      if (!content || running) return;
      if (!usable && canWait) {
        setQueued(true);
        return;
      }
      if (!usable) {
        openSheet(true);
        return;
      }
      setQueued(false);
      let threadId = state.selectedId;
      if (!threadId) {
        if (!model) return;
        threadId = await chat.createThread({ model, executionLocation: side, sharingScope: side === 'local' ? 'local' : 'mesh', privacy });
      }
      const completion = chat.send(threadId, content, []);
      completion.catch(() => undefined);
      setDraft('');
      await chat.saveDraft(threadId, null);
      if (state.selectedId === null) await chat.saveDraft(null, null);
      await completion;
    });

  const commit = (selection: SheetSelection) =>
    act(async () => {
      const policy = decisions.destinationPolicy(selection.side === 'local' ? 'device' : 'contributors');
      const forSend = sheet.forSend;
      if (thread && modelKey(thread.model) === modelKey(selection.model)) {
        await chat.setExecutionPrivacy(thread.id, policy);
        await chat.setExecutionLocation(thread.id, selection.side);
      } else {
        // A different model starts a new thread; the draft comes along.
        if (thread) {
          await chat.saveDraft(thread.id, null);
          await chat.select(null);
          await chat.saveDraft(null, { text: draft, files: [] });
        }
        setChosen({ model: selection.model, side: selection.side, privacy: policy });
      }
      closeSheet();
      if (forSend) setSendAfterChoice(true);
    });

  // A download is reviewed first: its size is checked and shown before anything downloads.
  const reviewDownload = (target: HostModel) => {
    closeSheet();
    setReview({ model: target, size: null, error: null });
    chat.getModelDownload(modelKey(target) ?? target.id).then(
      (info) => setReview((current) => (current?.model === target ? { ...current, size: gigabytes(info.sizeBytes) } : current)),
      (cause: unknown) => setReview((current) => (current?.model === target ? { ...current, error: cause instanceof Error ? cause.message : String(cause) } : current)),
    );
  };
  const approveDownload = () => {
    const target = review?.model;
    setReview(null);
    if (!target) return;
    setChosen({ model: target, side: 'local', privacy: decisions.localPolicy() });
    act(() => chat.downloadLocalModel(target.id, true));
  };

  const runAction = () => {
    const action = sheetState.outcome.action;
    if (action === 'download' && sheet.selection.model) reviewDownload(sheet.selection.model);
    else if (action === 'commit') commit(sheet.selection);
    else if (action === 'use-contributors' || action === 'use-device') {
      const nextSide: SheetSide = action === 'use-device' ? 'local' : 'network';
      const nextModel = decisions.modelForLocation(state.models, sheet.selection.model, nextSide, { state, canDownload: decisions.canDownload });
      commit({ side: nextSide, model: nextModel, implied: true });
    }
  };

  // A queued Send goes once a computer can answer, and lapses when waiting is no longer possible.
  useEffect(() => {
    if (!queued) return;
    if (usable) send();
    else if (!canWait) setQueued(false);
    // send reads the latest render; it runs when the wait resolves, so it is not a dependency.
  }, [queued, usable, canWait]);

  // Send pressed while the choice could not answer: send once the committed choice can.
  useEffect(() => {
    if (!sendAfterChoice || sheet.open) return;
    setSendAfterChoice(false);
    if (usable) send();
    // send reads the latest render; this runs once per committed choice, so send is not a dependency.
  }, [sendAfterChoice, sheet.open, usable]);

  const acquisition = state.acquisition;
  const downloading = acquisition?.phase === 'downloading';
  const received = acquisition?.progress?.receivedBytes;
  const total = acquisition?.progress?.totalBytes;
  const composer: ComposerState = {
    draft,
    running,
    answerOn: `${side === 'local' ? strings.computers.thisDevice : strings.computers.contributors} · ${model ? decisions.modelLabel(model) : t.noModel}`,
    status: running ? t.status.executing : queued && model ? `${t.waitingFor} ${decisions.modelLabel(model)}…` : downloading ? (acquisition?.progress?.message ?? strings.download.progress) : (outcome.issue ?? ''),
    error: error ?? (acquisition?.phase === 'failed' ? (acquisition.error ?? null) : null),
    progress: downloading ? (typeof received === 'number' && typeof total === 'number' && total > 0 ? received / total : 'unknown') : null,
    suggestion: null,
  };

  return (
    <Stack gap="lg" data={{ 'data-chat-workspace': true, 'data-react-shell': true }}>
      <Row gap="sm">
        <Wordmark />
        <Grow />
        <Button variant="quiet" icon="threads" label={t.threads} hasPopup="dialog" onPress={() => setThreadsOpen(true)} data={{ 'data-toggle-thread-rail': true }} />
        <Button
          variant="quiet"
          icon="plus"
          label={t.newThread}
          onPress={() => startNewThread()}
          data={{ 'data-new-thread': true }}
        />
      </Row>
      <ChatThread
        messages={projectMessages(thread, state, decisions)}
        composer={composer}
        onDraft={(text) => {
          setDraft(text);
          setQueued(false);
          void Promise.resolve(chat.saveDraft(state.selectedId, { text, files: [] })).catch(() => undefined);
        }}
        onSend={send}
        onStop={() => act(() => (thread ? chat.cancel(thread.id) : undefined))}
        onOpenAnswerOn={() => openSheet(false)}
        onCancelDownload={() => act(() => chat.cancelModelDownload())}
        onCancelQueued={queued ? () => setQueued(false) : undefined}
      />
      <DownloadReview
        state={{ model: review ? decisions.modelLabel(review.model) : '', size: review?.size ?? null, error: review?.error ?? null }}
        open={review !== null}
        onApprove={approveDownload}
        onCancel={() => setReview(null)}
      />
      <ModelSheet
        state={sheetState}
        open={sheet.open}
        onClose={closeSheet}
        onComputer={(computer) => {
          const nextSide: SheetSide = computer === 'local' ? 'local' : 'network';
          const nextModel = decisions.modelForLocation(state.models, sheet.selection.model, nextSide, { state, canDownload: decisions.canDownload });
          setSheet((current) => ({ ...current, selection: { side: nextSide, model: nextModel, implied: true } }));
          // A computer tap applies at once (under "Only your devices" a Contributors tap changes nothing);
          // the sheet stays open so its models can be checked there.
          if (nextSide === 'network' && block) return;
          const policy = decisions.destinationPolicy(nextSide === 'local' ? 'device' : 'contributors');
          if (thread) {
            act(async () => {
              await chat.setExecutionPrivacy(thread.id, policy);
              await chat.setExecutionLocation(thread.id, nextSide);
            });
          } else setChosen((current) => ({ ...current, side: nextSide, privacy: policy }));
        }}
        onModel={(id) => {
          const picked = (state.models ?? []).find((item) => modelKey(item) === id) ?? null;
          const nextSide = sideForModel(decisions, picked, sheet.selection.side, block);
          setSheet((current) => ({ ...current, selection: { side: nextSide, model: picked, implied: false } }));
        }}
        onCommit={runAction}
      />
      <Sheet title={t.threads} open={threadsOpen} onClose={() => setThreadsOpen(false)} closeLabel={strings.common.close} data={{ 'data-threads-dialog': true }}>
        <ThreadList
          threads={projectThreads(state, view, seen.current, now, t.status.new)}
          current={state.selectedId}
          view={view}
          onView={setView}
          onSelect={(id) =>
            act(async () => {
              await chat.select(id);
              setThreadsOpen(false);
            })
          }
          onNew={() => startNewThread(() => setThreadsOpen(false))}
        />
      </Sheet>
    </Stack>
  );
}
