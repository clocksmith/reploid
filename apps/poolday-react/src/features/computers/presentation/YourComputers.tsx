import { useEffect, useRef, useState } from 'react';
import {
  Button,
  DetailSheet,
  Disclosure,
  EmptyState,
  Facts,
  Field,
  InlineAlert,
  List,
  ListItem,
  Row,
  Section,
  Stack,
  StatusLine,
  Text,
} from '@reploid/poolday-ui';
import type { ComputersServices, ComputersView, GuestInvite, PrivateAccount, PrivateComputersView } from '../domain/services';
import { computers as t } from '../../../l10n/computers';
import { ActivityList } from './FleetAccount';

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Connect a desktop: paste the link the desktop shows, or enter its fields by hand; then forget it. */
function OwnerPairing({ view, services }: { readonly view: NonNullable<ComputersView['ownerPairing']>; readonly services: ComputersServices }) {
  const [open, setOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [link, setLink] = useState('');
  const [fields, setFields] = useState({ hostParticipantId: '', code: '', hostLabel: '', roomId: '' });
  const [status, setStatus] = useState('');
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);

  const applyLink = (raw: string) => {
    const target = services.owner.parseLink(raw);
    if (!target) return false;
    setFields({ hostParticipantId: target.hostParticipantId, code: target.code, hostLabel: target.hostLabel || '', roomId: target.roomId || '' });
    setOpen(true);
    setStatus('');
    return true;
  };
  const onLink = (value: string) => {
    setLink(value);
    if (!value.trim() || applyLink(value.trim())) return;
    setFields({ hostParticipantId: '', code: '', hostLabel: '', roomId: '' });
  };
  const connect = () => {
    let target = fields;
    if (link.trim()) {
      const parsed = services.owner.parseLink(link.trim());
      if (!parsed) return setStatus(t.owner.invalidLink);
      target = { hostParticipantId: parsed.hostParticipantId, code: parsed.code, hostLabel: parsed.hostLabel || '', roomId: parsed.roomId || '' };
    }
    const hostParticipantId = target.hostParticipantId.trim(), code = target.code.trim();
    const hostLabel = target.hostLabel.trim(), roomId = target.roomId.trim();
    if (!hostParticipantId || !code) {
      setManualOpen(true);
      return setStatus(t.owner.missing);
    }
    setStatus(t.owner.approve);
    services.owner.pair({ hostParticipantId, code, ...(hostLabel ? { hostLabel } : {}), ...(roomId ? { roomId } : {}) }).then(
      (result) => {
        if (!live.current) return;
        setFields((current) => ({ ...current, code: '' }));
        setLink('');
        setManualOpen(false);
        setStatus(t.owner.paired(result.hostLabel));
      },
      (cause: unknown) => live.current && setStatus(messageOf(cause) || t.owner.failed),
    );
  };
  const set = (name: keyof typeof fields) => (value: string) => setFields((current) => ({ ...current, [name]: value }));
  return (
    <Disclosure quiet summary={t.owner.title} status={view.status} open={open} onToggle={setOpen} data={{ 'data-owner-pairing': true }}>
      <Stack gap="md">
        <Text variant="small" muted>
          {t.owner.explain}
        </Text>
        <Stack gap="sm" data={{ 'data-owner-pairing-form': true }}>
          <Field type="url" label={t.owner.link} placeholder={t.owner.linkPlaceholder} autoComplete="off" value={link} onChange={onLink} data={{ 'data-owner-pairing-link-field': true }} />
          <Row gap="md">
            <Button variant="primary" label={t.owner.connect} onPress={view.busy ? undefined : connect} data={{ 'data-owner-pairing-connect': true }} />
            <StatusLine data={{ 'data-owner-pairing-status': true }}>{view.error || status}</StatusLine>
          </Row>
          <Disclosure quiet summary={t.owner.manual} open={manualOpen} onToggle={setManualOpen} data={{ 'data-pairing-manual': true }}>
            <Field label={t.owner.hostId} placeholder="peer:…" autoComplete="off" spellCheck={false} value={fields.hostParticipantId} onChange={set('hostParticipantId')} />
            <Field label={t.owner.code} autoComplete="off" spellCheck={false} value={fields.code} onChange={set('code')} />
            <Field label={t.owner.name} placeholder={t.owner.namePlaceholder} autoComplete="off" value={fields.hostLabel} onChange={set('hostLabel')} />
            <Field label={t.owner.room} placeholder="reploid-swarm-…" autoComplete="off" spellCheck={false} value={fields.roomId} onChange={set('roomId')} />
          </Disclosure>
        </Stack>
        {view.paired && (
          <Row>
            <Button
              variant="quiet"
              label={t.owner.forget}
              onPress={() => {
                services.owner.unpair();
                setStatus(t.owner.forgotten);
              }}
              data={{ 'data-owner-pairing-unpair': true }}
            />
          </Row>
        )}
      </Stack>
    </Disclosure>
  );
}

/** Your private computers: connect the native host, see each enrolled computer, its account and statement. */
function PrivateComputers({ view, services }: { readonly view: Extract<PrivateComputersView, { available: true }>; readonly services: ComputersServices }) {
  const [address, setAddress] = useState('');
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState<PrivateAccount | null>(null);
  const [tick, setTick] = useState(0);

  const act = (work: () => Promise<unknown>) => {
    setPending(true);
    setError('');
    work()
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setPending(false));
  };
  // The account is read when opened, again when this pool's active work changes, and at most every 10 s while open.
  useEffect(() => {
    if (!accountOpen || !view.connected) return undefined;
    let live = true;
    services.privateComputers.account().then(
      (next) => live && setAccount(next),
      (cause: unknown) => live && setError(messageOf(cause)),
    );
    const timer = setTimeout(() => setTick((value) => value + 1), 10000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [accountOpen, view.connected, view.activityKey, tick, services]);

  return (
    <>
      <ListItem title={t.private.title} status={view.status} data={{ 'data-private-computers': true }} />
      {!view.connected && (
        <Disclosure quiet summary={t.private.connectTitle} data={{ 'data-private-pair': true }}>
          <Text variant="small" muted>
            {t.private.explain}
          </Text>
          <Field type="url" label={t.private.address} placeholder={t.private.addressPlaceholder} required value={address} onChange={setAddress} />
          <Field type="password" label={t.private.secret} autoComplete="off" required value={secret} onChange={setSecret} />
          <Row>
            <Button
              label={t.private.connect}
              onPress={pending || !address.trim() || !secret ? undefined : () => act(async () => {
                await services.privateComputers.connect(address, secret);
                setSecret('');
              })}
              data={{ 'data-private-connect': true }}
            />
          </Row>
        </Disclosure>
      )}
      {view.computers.map((computer) => (
        <DetailSheet
          key={computer.id}
          title={computer.name}
          status={computer.status}
          closeLabel={t.close}
          data={{ 'data-private-computer': computer.id, 'data-private-tone': computer.tone }}
        >
          <Facts items={computer.facts} />
        </DetailSheet>
      ))}
      {view.connected && (
        <Disclosure quiet summary={t.private.credits} open={accountOpen} onToggle={setAccountOpen} data={{ 'data-private-account': true }}>
          <Text variant="caption" muted>
            {t.private.creditsExplain}
          </Text>
          {account ? (
            <>
              <Text variant="small" data={{ 'data-private-own-account': true }}>
                {account.own}
              </Text>
              {account.activity ? <ActivityList rows={account.activity} empty={t.account.noActivity} /> : <Text variant="small" muted>{t.private.noStatement}</Text>}
              {account.others && (
                <Text variant="caption" muted>
                  {account.others}
                </Text>
              )}
              {account.hasStatement && (
                <Row>
                  <Button variant="quiet" label={t.account.saveStatement} onPress={() => act(() => services.privateComputers.saveStatement())} data={{ 'data-private-statement': true }} />
                </Row>
              )}
            </>
          ) : (
            <Text variant="small" muted>
              {t.private.loading}
            </Text>
          )}
        </Disclosure>
      )}
      {view.hasRequester && (
        <Row>
          <Button variant="quiet" label={t.private.disconnect} onPress={pending ? undefined : () => act(() => services.privateComputers.disconnect())} data={{ 'data-private-disconnect': true }} />
        </Row>
      )}
      <InlineAlert tone="error" data={{ 'data-private-error': true }}>
        {error || view.error || null}
      </InlineAlert>
    </>
  );
}

/** Invite a guest: a link that lets one person ask your computers a few questions, with its limits and usage. */
function GuestInvites({ services }: { readonly services: ComputersServices }) {
  const [open, setOpen] = useState(false);
  const [limits, setLimits] = useState({ hours: '24', maxRequests: '10', maxOutputTokens: '256' });
  const [rows, setRows] = useState<ReadonlyArray<GuestInvite>>([]);
  const [shared, setShared] = useState<{ readonly id: string; readonly link: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);

  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    action()
      .then(() => services.invites.list())
      .then((next) => {
        if (!live.current) return;
        setRows(next);
        setShared((current) => (current && next.some((row) => row.id === current.id && row.active) ? current : null));
      })
      .catch((cause: unknown) => live.current && setStatus(messageOf(cause)))
      .finally(() => live.current && setBusy(false));
  };
  const create = () => {
    const hours = Number(limits.hours), maxRequests = Number(limits.maxRequests), maxOutputTokens = Number(limits.maxOutputTokens);
    const whole = (value: number, max: number) => Number.isInteger(value) && value >= 1 && value <= max;
    if (!whole(hours, 720) || !whole(maxRequests, 1000) || !whole(maxOutputTokens, 32768)) return setStatus(t.invites.invalid);
    run(async () => {
      const invite = await services.invites.issue({ hours, maxRequests, maxOutputTokens });
      if (!live.current) return;
      setShared(invite);
      setStatus(t.invites.ready);
    });
  };
  const set = (name: keyof typeof limits) => (value: string) => setLimits((current) => ({ ...current, [name]: value }));
  return (
    <Disclosure
      quiet
      summary={t.invites.title}
      open={open}
      onToggle={(next) => {
        setOpen(next);
        if (next) run(async () => undefined);
      }}
      data={{ 'data-circle-invites': true }}
    >
      <Stack gap="sm" data={{ 'data-circle-invite-create': true }}>
        <Text variant="small" muted>
          {t.invites.explain}
        </Text>
        <Row>
          <Button label={t.invites.create} onPress={busy ? undefined : create} data={{ 'data-circle-invite-submit': true }} />
          <Button variant="quiet" label={t.invites.refresh} onPress={() => run(async () => undefined)} data={{ 'data-circle-invite-refresh': true }} />
        </Row>
        <List>
          <DetailSheet
            title={t.invites.limits}
            status={`${limits.hours}h · ${limits.maxRequests} req · ${limits.maxOutputTokens} tok`}
            closeLabel={t.close}
          >
            <Stack gap="sm">
              <Field type="number" label={t.invites.hours} min={1} max={720} required value={limits.hours} onChange={set('hours')} />
              <Field type="number" label={t.invites.requests} min={1} max={1000} required value={limits.maxRequests} onChange={set('maxRequests')} />
              <Field type="number" label={t.invites.tokens} min={1} max={32768} required value={limits.maxOutputTokens} onChange={set('maxOutputTokens')} />
            </Stack>
          </DetailSheet>
        </List>
        <Text variant="caption" muted>
          {t.invites.policy}
        </Text>
      </Stack>
      {shared && (
        <Stack gap="sm" data={{ 'data-circle-invite-share': true }}>
          <Field type="url" label={t.invites.link} readOnly value={shared.link} onChange={() => undefined} data={{ 'data-circle-invite-link': true }} />
          <Row>
            <Button
              variant="quiet"
              label={t.invites.copy}
              onPress={() => {
                const copied = shared.link;
                services.invites.copy(copied).then(
                  () => setStatus(t.invites.copied),
                  () => setStatus(t.invites.selectCopy),
                );
              }}
              data={{ 'data-circle-invite-copy': true }}
            />
          </Row>
        </Stack>
      )}
      {rows.length > 0 ? (
        <List data={{ 'data-circle-invite-list': true }}>
          {rows.map((row) => (
            <Stack key={row.id} gap="xs" data={{ 'data-circle-invite-row': row.id, 'data-circle-invite-state': row.state }}>
              <Text variant="small">{row.summary}</Text>
              <Text variant="small" muted>
                {row.usage}
              </Text>
              {row.queued && <Text variant="small" muted>{row.queued}</Text>}
              {row.active && (
                <Row>
                  <Button
                    variant="quiet"
                    label={t.invites.revoke}
                    onPress={() => run(async () => {
                      const text = await services.invites.revoke(row.id);
                      if (!live.current) return;
                      setShared((current) => (current?.id === row.id ? null : current));
                      setStatus(text);
                    })}
                    data={{ 'data-circle-invite-revoke': row.id }}
                  />
                </Row>
              )}
            </Stack>
          ))}
        </List>
      ) : (
        <EmptyState title={t.invites.title} description={t.invites.explain} data={{ 'data-circle-invite-list': true }} />
      )}
      <StatusLine data={{ 'data-circle-invite-status': true }}>{status}</StatusLine>
    </Disclosure>
  );
}

/** Your computers: the paired desktop, the private computers of your native host, and guest links. */
export function YourComputers({ view, services }: { readonly view: ComputersView; readonly services: ComputersServices }) {
  const privateView = view.privateComputers;
  if (!view.ownerPairing && !privateView.available && !view.circleInvites) return null;
  return (
    <Section title={t.yours.title}>
      <List>
        {view.ownerPairing && <OwnerPairing view={view.ownerPairing} services={services} />}
        {privateView.available && <PrivateComputers view={privateView} services={services} />}
        {view.circleInvites && <GuestInvites services={services} />}
      </List>
    </Section>
  );
}
