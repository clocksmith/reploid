import { Badge, Button, Dialog, Field, Notice, Row, Spinner, Stack, Text } from '@reploid/poolday-ui';
import type { PairingState } from '../domain/computers';
import { strings } from '../../../l10n/strings';

const t = strings.connect;

/** Pair a desktop: the command to run, its code, and the pairing state as it changes. */
export function ConnectDesktop({
  state,
  open,
  onClose,
  onCopy,
  onNewCode,
  presentation = 'modal',
}: {
  readonly state: PairingState;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCopy: () => void;
  readonly onNewCode: () => void;
  readonly presentation?: 'modal' | 'inline';
}) {
  return (
    <Dialog
      title={t.title}
      open={open}
      onClose={onClose}
      closeLabel={strings.common.close}
      presentation={presentation}
      data={{ 'data-connect-desktop-dialog': true }}
      footer={
        state.phase === 'failed' ? (
          <Button variant="primary" label={t.newCode} onPress={onNewCode} />
        ) : (
          <Button variant="quiet" label={strings.common.close} onPress={onClose} />
        )
      }
    >
      <Stack gap="md">
        <Text variant="small">{t.steps}</Text>
        <Field label={t.command} value={state.command} onChange={() => undefined} readOnly data={{ 'data-pairing-command': true }} />
        <Row justify="between">
          <Text variant="small" muted>
            {`${t.code}: `}
            <Text as="code" variant="small" mono>
              {state.code}
            </Text>
          </Text>
          <Button variant="secondary" icon="copy" label={t.copyCommand} onPress={onCopy} />
        </Row>
        {state.phase === 'waiting' && <Spinner label={t.waiting} />}
        {state.phase === 'waiting' && (
          <Text variant="small" muted>
            {t.waiting}
          </Text>
        )}
        {state.phase === 'connected' && <Badge tone="ready">{`${t.connected}: ${state.desktop ?? ''}`}</Badge>}
        <Notice tone="error">{state.phase === 'failed' ? t.failed : null}</Notice>
      </Stack>
    </Dialog>
  );
}
