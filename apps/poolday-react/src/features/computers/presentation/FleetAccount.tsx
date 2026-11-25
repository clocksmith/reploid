import { useEffect, useState } from 'react';
import { Button, Disclosure, Facts, Notice, Row, Section, Sheet, Stack, StatusLine, Text, List, ListItem } from '@reploid/poolday-ui';
import type { ComputersServices, CreditActivity, FleetAccountView } from '../domain/services';
import { computers as t } from '../../../l10n/computers';

const quiet = (work: () => Promise<unknown>) => () => void work().catch(() => undefined);

/** Activity rows: what was earned or spent, each with when. */
export function ActivityList({ rows, empty }: { readonly rows: ReadonlyArray<CreditActivity>; readonly empty: string }) {
  if (!rows.length) return <Text variant="small" muted>{empty}</Text>;
  return (
    <Stack gap="xs">
      {rows.map((row) => (
        <Text key={row.key} variant="small">
          {row.at ? `${row.text} · ${row.at}` : row.text}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * Computers › Your account: sign in, create the service-credit account, pair a computer by code, see the
 * balance, starter credit and recent activity, and save the statement. Every number is the server ledger's.
 */
export function FleetAccount({ view, services }: { readonly view: FleetAccountView; readonly services: ComputersServices }) {
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<ReadonlyArray<CreditActivity> | null>(null);
  const [activityError, setActivityError] = useState('');
  const [pairOpen, setPairOpen] = useState(false);
  const key = view.available ? view.activityKey : '';

  // The activity is read when opened and again when the balance moves.
  useEffect(() => {
    if (!activityOpen || !key) return undefined;
    let live = true;
    services.fleet.activity().then(
      (rows) => live && (setActivity(rows), setActivityError('')),
      (cause: unknown) => live && setActivityError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      live = false;
    };
  }, [activityOpen, key, services]);

  if (!view.available) return null;
  const pairing = view.pairing;
  const closePair = () => {
    setPairOpen(false);
    services.fleet.closePairing();
  };
  return (
    <Section title={t.account.title} data={{ 'data-fleet-account': true }}>
      <Stack gap="sm">
        <StatusLine muted={false} data={{ 'data-fleet-account-status': true }}>
          {view.status}
        </StatusLine>
        {!view.signedIn && (
          <Stack gap="sm" data={{ 'data-fleet-sign-in': true }}>
            <Text variant="caption" muted>
              {t.account.explain}
            </Text>
            <Row>
              <Button variant="primary" label={t.account.google} onPress={view.busy ? undefined : quiet(() => services.fleet.signIn('google'))} data={{ 'data-fleet-sign-in-google': true }} />
              <Button variant="quiet" label={t.account.guest} onPress={view.busy ? undefined : quiet(() => services.fleet.signIn('anonymous'))} data={{ 'data-fleet-sign-in-guest': true }} />
            </Row>
          </Stack>
        )}
        {view.signedIn && !view.hasAccount && (
          <Row>
            <Button variant="primary" label={t.account.create} onPress={view.busy ? undefined : quiet(() => services.fleet.createAccount())} data={{ 'data-fleet-create': true }} />
          </Row>
        )}
        {view.hasAccount && (
          <Stack gap="sm" data={{ 'data-fleet-details': true }}>
            <Text variant="caption" muted>
              {view.starter}
            </Text>
            <List data={{ 'data-fleet-computers': true }}>
              {view.computers.length === 0 && <ListItem title={t.account.noComputers} />}
              {view.computers.map((computer) => (
                <Row key={computer.id} justify="between" data={{ 'data-fleet-computer': computer.id }}>
                  <Stack gap="xs">
                    <Text variant="small">{computer.name}</Text>
                    <Text variant="caption" muted mono>
                      {computer.status}
                    </Text>
                  </Stack>
                  {computer.removable && (
                    <Button variant="quiet" label={t.account.remove} onPress={view.busy ? undefined : quiet(() => services.fleet.revoke(computer.id))} data={{ 'data-fleet-revoke': computer.id }} />
                  )}
                </Row>
              ))}
              <ListItem
                icon="peers"
                title={t.account.pair}
                status={t.account.pairStatus}
                disabled={view.busy}
                onPress={quiet(async () => {
                  await services.fleet.startPairing();
                  setPairOpen(true);
                })}
                data={{ 'data-fleet-pair': true }}
              />
            </List>
            <Disclosure quiet summary={t.account.activity} open={activityOpen} onToggle={setActivityOpen} data={{ 'data-fleet-activity-section': true }}>
              {activityError ? <Text variant="small" muted>{activityError}</Text> : activity && <ActivityList rows={activity} empty={t.account.noActivity} />}
              <Row>
                <Button variant="quiet" label={t.account.saveStatement} onPress={quiet(() => services.fleet.saveStatement())} data={{ 'data-fleet-statement': true }} />
              </Row>
              <Text variant="caption" muted>
                {`${t.account.statementHelp} `}
                <Text as="code" variant="caption" mono>
                  {t.account.statementCommand}
                </Text>
                .
              </Text>
            </Disclosure>
          </Stack>
        )}
        <Notice tone="error" data={{ 'data-fleet-error': true }}>
          {view.error || null}
        </Notice>
      </Stack>
      <Sheet
        title={t.account.pairTitle}
        open={pairOpen && pairing !== null}
        onClose={closePair}
        closeLabel={t.close}
        data={{ 'data-fleet-pair-dialog': true }}
        footerStatus={pairing?.status}
        footer={
          <>
            <Button variant="quiet" label={t.cancel} onPress={quiet(async () => {
              await services.fleet.cancelPairing();
              closePair();
            })} data={{ 'data-fleet-pair-cancel': true }} />
            {pairing && !pairing.confirmed && (
              <Button variant="primary" label={t.account.confirm} onPress={pairing.canConfirm ? quiet(() => services.fleet.confirmPairing()) : undefined} data={{ 'data-fleet-pair-confirm': true }} />
            )}
            {pairing?.confirmed && (
              <Button variant="primary" label={t.account.use} onPress={view.busy ? undefined : quiet(async () => {
                await services.fleet.useThisComputer();
                closePair();
              })} data={{ 'data-fleet-use': true }} />
            )}
          </>
        }
      >
        {pairing && (
          <Stack gap="md">
            <Stack gap="xs">
              <Text variant="small">{`1. ${t.account.pairRun}`}</Text>
              <Text variant="small" mono data={{ 'data-fleet-pair-command': true }}>
                {pairing.command}
              </Text>
              <Text variant="small">{`2. ${t.account.pairFingerprint}`}</Text>
              <Text variant="small">{`3. ${t.account.pairStart}`}</Text>
            </Stack>
            <Facts items={[[t.account.code, pairing.code], [t.account.computer, pairing.computer], [t.account.fingerprint, pairing.fingerprint]]} />
            <Text variant="caption" muted>
              {t.account.pairNote}
            </Text>
          </Stack>
        )}
      </Sheet>
    </Section>
  );
}
