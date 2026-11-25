import { Button, Dialog, Facts, Notice, Spinner, Stack, Text } from '@reploid/poolday-ui';
import { strings } from '../../../l10n/strings';

const t = strings.download;

export type DownloadReviewState = {
  readonly model: string;
  /** The checked download size, or null while it is being checked. */
  readonly size: string | null;
  readonly error: string | null;
};

/** A download is approved only after its size is shown; Send never downloads. */
export function DownloadReview({
  state,
  open,
  onApprove,
  onCancel,
  presentation = 'modal',
}: {
  readonly state: DownloadReviewState;
  readonly open: boolean;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
  readonly presentation?: 'modal' | 'inline';
}) {
  return (
    <Dialog
      title={`${t.title} ${state.model}`}
      open={open}
      onClose={onCancel}
      closeLabel={strings.common.close}
      presentation={presentation}
      data={{ 'data-download-review': true }}
      footerStatus={state.size === null && !state.error ? t.checking : null}
      footer={
        <>
          <Button variant="quiet" label={strings.common.cancel} onPress={onCancel} />
          <Button variant="primary" label={t.approve} onPress={state.size !== null && !state.error ? onApprove : undefined} data={{ 'data-download-confirm': true }} />
        </>
      }
    >
      <Stack gap="md">
        <Text variant="small">{t.explain}</Text>
        {state.size === null && !state.error ? <Spinner label={t.checking} /> : null}
        {state.size !== null && <Facts items={[[t.size, state.size], [t.where, t.browserStorage]]} />}
        <Notice tone="error">{state.error}</Notice>
      </Stack>
    </Dialog>
  );
}
