import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Disclosure, Stack, StatusLine, Text } from '@reploid/poolday-ui';
import type { ComputersServices, PairingTarget } from '../domain/services';
import { computers as t } from '../../../l10n/computers';

type Step = { readonly kind: 'request' } | { readonly kind: 'waiting' } | { readonly kind: 'done'; readonly heading: string; readonly message: string; readonly detail: string };

/**
 * A desktop's pairing link opened on this device: one action, Connect, then Approve on your desktop, then the
 * result. The link is taken out of the address bar once it is used or dismissed, so a reload cannot reuse it.
 */
export function PairingLinkDialog({ services, presentation = 'modal' }: { readonly services: ComputersServices; readonly presentation?: 'modal' | 'inline' }) {
  const [target, setTarget] = useState<PairingTarget | null>(() => services.owner.linkTarget());
  const [step, setStep] = useState<Step>({ kind: 'request' });
  const controller = useRef(new AbortController());

  useEffect(() => () => controller.current.abort(), []);
  if (!target) return null;

  const name = target.hostLabel || t.pairingLink.yourDesktop;
  const close = () => {
    controller.current.abort();
    services.owner.forgetLink();
    setTarget(null);
  };
  const finish = (heading: string, message: string, detail: string) => {
    services.owner.forgetLink();
    setStep({ kind: 'done', heading, message, detail });
  };
  const connect = () => {
    setStep({ kind: 'waiting' });
    const { signal } = controller.current;
    services.owner.pair(target, { signal }).then(
      (result) => {
        if (signal.aborted) return;
        const path = services.owner.transportPath();
        finish(target.hostLabel ? t.pairingLink.paired(result.hostLabel) : t.pairingLink.desktopPaired, '', path ? t.pairingLink.connection(path) : '');
      },
      (cause: unknown) => {
        if (signal.aborted) return;
        finish(t.pairingLink.failed, t.pairingLink.failedHelp, cause instanceof Error ? cause.message : String(cause));
      },
    );
  };
  const title = step.kind === 'done' ? step.heading : step.kind === 'waiting' ? t.pairingLink.approve : t.pairingLink.connectTo(name);
  return (
    <Dialog
      title={title}
      open
      presentation={presentation}
      onClose={close}
      closeLabel={t.close}
      data={{ 'data-owner-pairing-link': true }}
      footer={
        step.kind === 'done' ? (
          <Button variant="primary" label={t.pairingLink.done} onPress={close} data={{ 'data-pairing-connect': true, 'data-autofocus': true }} />
        ) : (
          <Button
            variant="primary"
            label={step.kind === 'waiting' ? t.pairingLink.waiting : t.pairingLink.connect}
            onPress={step.kind === 'waiting' ? undefined : connect}
            data={{ 'data-pairing-connect': true, 'data-autofocus': true }}
          />
        )
      }
    >
      <Stack gap="sm">
        {step.kind === 'done' && step.message && <StatusLine muted={false} data={{ 'data-pairing-message': true }}>{step.message}</StatusLine>}
        <Disclosure quiet summary={t.pairingLink.details}>
          <Text variant="caption" muted wrapAnywhere data={{ 'data-pairing-identity': true }}>
            {t.pairingLink.desktopId(target.hostParticipantId)}
          </Text>
          {step.kind === 'done' && step.detail && (
            <Text variant="caption" muted wrapAnywhere data={{ 'data-pairing-connection': true }}>
              {step.detail}
            </Text>
          )}
        </Disclosure>
      </Stack>
    </Dialog>
  );
}
