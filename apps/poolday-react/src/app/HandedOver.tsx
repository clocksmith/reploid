import { useSyncExternalStore } from 'react';
import { Button, Notice, Stack } from '@reploid/poolday-ui';
import type { HandoverPort } from '../features/shell/domain/host';
import { strings } from '../l10n/strings';

const t = strings.handover;

/** Where this browser's conversation history is, while another tab holds it, and the way to take it back. */
export function HistoryHandoverNotice({ handover }: { readonly handover: HandoverPort }) {
  const state = useSyncExternalStore(handover.subscribe, handover.getState);
  const away = state && ['elsewhere', 'moved', 'waiting'].includes(state.state);
  return (
    <Notice
      data={{ 'data-history-handover': true }}
      action={away ? <Button variant="primary" label={t.take} onPress={state.state === 'waiting' ? undefined : handover.request} data={{ 'data-history-handover-take': true }} /> : undefined}
    >
      {away ? (state.failed ? t.failed : state.state === 'moved' ? t.moved : t.elsewhere) : null}
    </Notice>
  );
}

/** The page a tab shows after handing its history to another tab. */
export function HandedOver({ handover }: { readonly handover: HandoverPort }) {
  return (
    <Stack gap="lg" data={{ 'data-handed-over': true }}>
      <HistoryHandoverNotice handover={handover} />
    </Stack>
  );
}
