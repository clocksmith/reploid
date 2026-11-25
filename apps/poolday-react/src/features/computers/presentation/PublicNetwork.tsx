import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Disclosure, Facts, Field, List, Progress, Row, Section, Stack, StatusLine, Text, Toggle } from '@reploid/poolday-ui';
import type { ComputersServices, ComputersView, PeerView } from '../domain/services';
import { computers as t } from '../../../l10n/computers';

const PENDING_MODEL = 'Model status pending';

/** A local name and a local block for one computer: they change only where this device sends its own requests. */
function LocalPreferences({ peer, services, onError }: { readonly peer: PeerView; readonly services: ComputersServices; readonly onError: (message: string) => void }) {
  const [name, setName] = useState(peer.localName);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!edited) setName(peer.localName);
  }, [peer.localName, peer.identity, edited]);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    work()
      .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <Disclosure quiet summary={t.network.preferences} data={{ 'data-computer-preferences': true }}>
      {peer.identity && (
        <Stack gap="xs" data={{ 'data-computer-rename': true }}>
          <Field
            label={t.network.localName}
            hint={t.network.localNameHint}
            maxLength={64}
            autoComplete="off"
            value={name}
            disabled={busy}
            onChange={(value) => {
              setName(value);
              setEdited(true);
            }}
            data={{ 'data-computer-name-input': true }}
          />
          <Row>
            <Button variant="quiet" label={t.network.saveName} onPress={busy ? undefined : () => run(async () => {
              await services.preferences.rename(peer.id, name, peer.identity);
              setEdited(false);
            })} />
          </Row>
        </Stack>
      )}
      <Stack gap="xs" data={{ 'data-computer-block': true }}>
        <Row>
          <Button
            variant="quiet"
            label={peer.blocked ? t.network.unblock : t.network.block}
            onPress={busy ? undefined : () => run(() => services.preferences.setBlocked(peer.id, !peer.blocked, peer.identity))}
            data={{ 'data-computer-block-toggle': true }}
          />
        </Row>
        <Text variant="caption" muted>
          {peer.blockNote}
        </Text>
      </Stack>
    </Disclosure>
  );
}

/** One computer on the network: its status, model and reported GPU, then its connection and contribution facts. */
function PeerRow({ peer, model, preferences, services, onError }: {
  readonly peer: PeerView;
  readonly model: { readonly label: string; readonly value: string };
  readonly preferences: boolean;
  readonly services: ComputersServices;
  readonly onError: (message: string) => void;
}) {
  return (
    <Stack gap="xs" data={{ 'data-computer-id': peer.id, 'data-peer-phase': peer.phase, 'data-computer-state': peer.state, 'data-blocked': String(peer.blocked), 'data-quiet': String(peer.quiet) }}>
      <Row justify="between">
        <Text variant="small" data={{ 'data-computer-name': true }}>
          {peer.name}
        </Text>
        <Badge tone={peer.tone} data={{ 'data-computer-status': true }}>
          {peer.status}
        </Badge>
      </Row>
      <Facts items={peer.hardware ? [[model.label, model.value], [t.network.gpu, peer.hardware]] : [[model.label, model.value]]} />
      {peer.detail && (
        <Text variant="caption" muted data={{ 'data-computer-detail': true }}>
          {peer.detail}
        </Text>
      )}
      {peer.progress && <Progress label={peer.status} value={peer.progress.value} max={peer.progress.max} />}
      <Disclosure quiet summary={t.network.details} data={{ 'data-computer-details': true }}>
        <Facts items={peer.connection} />
        <Text variant="small">{t.network.contribution}</Text>
        <Facts items={peer.usage} />
        <Disclosure quiet summary={t.network.technicalIds} data={{ 'data-computer-identifiers': true }}>
          <Facts items={peer.ids} />
        </Disclosure>
        {preferences && <LocalPreferences peer={peer} services={services} onError={onError} />}
      </Disclosure>
    </Stack>
  );
}

/** Public network: the discovery connection, the computers it found and how many can answer now. */
export function PublicNetwork({ view, services, onClearFilter, onError }: {
  readonly view: ComputersView;
  readonly services: ComputersServices;
  readonly onClearFilter: () => void;
  readonly onError: (message: string) => void;
}) {
  const [showQuiet, setShowQuiet] = useState(false);
  // A computer whose status is pending keeps showing the model it last reported.
  const lastModels = useRef(new Map<string, string>());
  const modelOf = (peer: PeerView) => {
    if (peer.model !== PENDING_MODEL) {
      lastModels.current.set(peer.id, peer.model);
      return { label: t.network.model, value: peer.model };
    }
    const last = lastModels.current.get(peer.id);
    return last ? { label: t.network.lastModel, value: last } : { label: t.network.model, value: peer.model };
  };
  const visible = view.peers.filter((peer) => showQuiet || !peer.quiet);
  return (
    <Section title={t.network.title}>
      <List>
        <Toggle
          icon="peers"
          title={t.network.connection}
          status={view.connection.label}
          checked={view.connection.on}
          onChange={() => void services.network.toggleConnection()}
          data={{ 'data-mesh-connect': true, 'data-connection-label': view.connection.label }}
        />
        <StatusLine data={{ 'data-connection-detail': true }}>{view.connection.detail}</StatusLine>
        {view.filterLabel && (
          <Row justify="between" data={{ 'data-roster-filter': true }}>
            <Text variant="small">{view.filterLabel}</Text>
            <Button variant="quiet" label={t.network.showAll} onPress={onClearFilter} data={{ 'data-clear-roster-filter': true }} />
          </Row>
        )}
        <Text variant="small" muted data={{ 'data-peer-readiness': true }}>
          {view.readiness}
        </Text>
        <Stack gap="md" data={{ 'data-insp-device-list': true }}>
          {view.empty ? (
            <Text variant="small" muted>
              {view.empty}
            </Text>
          ) : (
            visible.map((peer) => (
              <PeerRow key={peer.id} peer={peer} model={modelOf(peer)} preferences={view.diagnostic.available} services={services} onError={onError} />
            ))
          )}
        </Stack>
        {view.quiet && (
          <Row>
            <Button variant="quiet" label={showQuiet ? view.quiet.hide : view.quiet.show} expanded={showQuiet} onPress={() => setShowQuiet((value) => !value)} data={{ 'data-quiet-computers': true }} />
          </Row>
        )}
        {view.peers.length > 0 && (
          <Disclosure quiet summary={t.network.usageHelp} data={{ 'data-computer-usage-help': true }}>
            <Text variant="small" muted>
              {t.network.usageScope}
            </Text>
          </Disclosure>
        )}
        {view.connection.privateScope && (
          <Row>
            <Button variant="quiet" label={t.network.invite} onPress={() => void services.network.copyInvite()} data={{ 'data-mesh-invite': true }} />
          </Row>
        )}
      </List>
    </Section>
  );
}
