import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Disclosure, Field, List, ListItem, Row, Section, Stack, StatusLine, Text } from '@reploid/poolday-ui';
import type { CreditAccountPort, Store } from '../../domain/services';
import { settingsStrings as t } from '../../../../l10n/settings';

const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.getState);
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Credits appear only when the page's server publishes an earning service (host/credits/browser.js). */
export function CreditsSection({ account }: { readonly account: Promise<CreditAccountPort | null> }) {
  const [port, setPort] = useState<CreditAccountPort | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let current = true;
    account.then(
      (opened) => current && setPort(opened),
      (cause: unknown) => current && setFailure(message(cause)),
    );
    return () => {
      current = false;
    };
  }, [account]);
  if (!port) return failure ? <StatusLine data={{ 'data-earning-status': true }}>{failure}</StatusLine> : null;
  return <CreditAccount port={port} />;
}

function CreditAccount({ port }: { readonly port: CreditAccountPort }) {
  const account = useStore(port.account);
  const [limit, setLimit] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const report = (work: Promise<unknown>) => void work.catch((cause: unknown) => setStatus(message(cause)));
  return (
    <Section title={t.credits} data={{ 'data-earning-account': true }}>
      <List>
        <Stack gap="sm" data={{ 'data-earning-sign-in': true }}>
          {port.local ? <LocalSignIn port={port} onError={setStatus} /> : <EmailSignIn port={port} />}
        </Stack>
        {account.ready && (
          <Stack gap="sm" data={{ 'data-earning-ready': true }}>
            <StatusLine muted={false} data={{ 'data-earning-balance': true }}>
              {account.balance}
            </StatusLine>
            {account.topUps.length > 0 && (
              <Row data={{ 'data-earning-top-ups': true }}>
                {account.topUps.map((topUp) => (
                  <Button key={topUp.id} label={topUp.label} onPress={() => report(port.topUp(topUp.id))} data={{ 'data-earning-top-up': topUp.id }} />
                ))}
              </Row>
            )}
            {account.checkout && (
              <Text variant="small" muted data={{ 'data-earning-checkout': true }}>
                {account.checkout}
              </Text>
            )}
            <Field
              type="number"
              label={t.spendLimit}
              hint={t.spendLimitNote}
              value={limit ?? (account.spendingLimit === null ? '' : String(account.spendingLimit))}
              onChange={setLimit}
              data={{ 'data-earning-limit': true }}
            />
            <Row>
              <Button
                label={t.saveLimit}
                onPress={() => {
                  port.setSpendingLimit(limit ?? (account.spendingLimit === null ? '' : String(account.spendingLimit)));
                  setLimit(null);
                }}
                data={{ 'data-earning-limit-save': true }}
              />
            </Row>
            {account.quote !== '' && (
              <Text variant="small" muted data={{ 'data-earning-quote': true }}>
                {account.quote}
              </Text>
            )}
            <Disclosure quiet summary={t.recentActivity} data={{ 'data-earning-activity': true }}>
              <List data={{ 'data-earning-journal': true }}>
                {account.journal.length === 0 ? (
                  <ListItem title={t.noActivity} />
                ) : (
                  account.journal.map((entry) => <ListItem key={entry.id} title={entry.text} data={{ 'data-earning-entry': entry.type }} />)
                )}
              </List>
            </Disclosure>
            {port.local && (
              <Row>
                <Button variant="quiet" label={t.signOut} onPress={() => report(port.accountSignOut())} data={{ 'data-earning-sign-out': true }} />
              </Row>
            )}
          </Stack>
        )}
      </List>
      <StatusLine data={{ 'data-earning-status': true }}>{status || account.status}</StatusLine>
    </Section>
  );
}

function LocalSignIn({ port, onError }: { readonly port: CreditAccountPort; readonly onError: (text: string) => void }) {
  const signedIn = useStore(port.localSignedIn);
  const [name, setName] = useState('');
  if (signedIn)
    return (
      <Text variant="small" muted data={{ 'data-earning-local-signed-in': true }}>
        {signedIn}
      </Text>
    );
  return (
    <Stack gap="xs" data={{ 'data-earning-local-form': true }}>
      <Text variant="small" muted>
        {t.localSignInNote}
      </Text>
      <Field label={t.name} value={name} onChange={setName} autoComplete="username" required data={{ 'data-earning-local-subject': true }} />
      <Row>
        <Button label={t.signIn} onPress={() => void port.useSubject(name).catch((cause: unknown) => onError(message(cause)))} data={{ 'data-earning-local-submit': true }} />
      </Row>
    </Stack>
  );
}

/** Sign-in through a one-time link sent to the person's email; the address goes to Supabase, which sends it. */
function EmailSignIn({ port }: { readonly port: CreditAccountPort }) {
  const view = useStore(port.signIn);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Stack gap="sm" data={{ 'data-account-sign-in': true }}>
      <Text variant="subheading" as="h3">
        {t.account}
      </Text>
      <Text variant="small" muted data={{ 'data-account-sign-in-summary': true }}>
        {view.summary}
      </Text>
      {view.formShown && (
        <Stack gap="xs" data={{ 'data-account-sign-in-form': true }}>
          <Field type="email" label={t.email} value={email} onChange={setEmail} autoComplete="email" required data={{ 'data-account-sign-in-email': true }} />
          <Row>
            <Button
              label={t.sendLink}
              onPress={view.sendDisabled ? undefined : () => void port.requestLink(email).catch((cause: unknown) => setStatus(message(cause)))}
              data={{ 'data-account-sign-in-send': true }}
            />
          </Row>
        </Stack>
      )}
      {view.signedIn && (
        <Row data={{ 'data-account-signed-in': true }}>
          <Button variant="quiet" label={t.signOut} onPress={() => void port.signOut().catch((cause: unknown) => setStatus(message(cause)))} data={{ 'data-account-sign-out': true }} />
        </Row>
      )}
      <StatusLine data={{ 'data-account-sign-in-status': true }}>{status ?? view.message}</StatusLine>
    </Stack>
  );
}
