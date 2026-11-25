import { useState, type ReactNode } from 'react';
import {
  Badge,
  Disclosure,
  Frame,
  List,
  Navigator,
  PooldayRoot,
  Row,
  Section,
  SidebarLayout,
  SingleChoice,
  Spinner,
  Stack,
  Notice,
  Surface,
  Text,
  TokenSwatch,
  useScrollSpy,
  Wordmark,
  type NavigatorItem,
  type Theme,
} from '@reploid/poolday-ui';
import { TOKEN_GROUP_ORDER, type DesignIndex, type DesignToken, type TokenValues } from '../domain/designIndex';
import { strings } from '../../../l10n/strings';
import { PrimitiveSpecimen } from './primitiveSpecimens';

const t = strings.design;

/** One composition as the page shows it: named states, each rendered by the composition layer. */
export type CompositionSpecimen = {
  readonly name: string;
  readonly states: ReadonlyArray<{ readonly id: string; readonly label: string; readonly render: () => ReactNode }>;
};

export type TokenValueState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly values: TokenValues };

const groupRank = (group: string) => {
  const index = TOKEN_GROUP_ORDER.indexOf(group);
  return index < 0 ? TOKEN_GROUP_ORDER.length : index;
};

function groupTokens(tokens: ReadonlyArray<DesignToken>) {
  const groups = new Map<string, DesignToken[]>();
  for (const token of tokens) groups.set(token.group, [...(groups.get(token.group) ?? []), token]);
  return [...groups.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b));
}

function TokenRow({ token, values }: { readonly token: DesignToken; readonly values: TokenValueState }) {
  const value = values.status === 'ready' ? values.values.get(token.name) : undefined;
  const valueText =
    value === undefined ? '' : value.light === null ? value.dark : `${t.darkValue}: ${value.dark} · ${t.lightValue}: ${value.light}`;
  return (
    <Stack gap="xs" data={{ 'data-token': token.name }}>
      <Row gap="md">
        {token.layer === 'semantic' ? (
          <>
            <PooldayRoot theme="dark" inline>
              <TokenSwatch name={token.name} kind={token.kind} />
            </PooldayRoot>
            <PooldayRoot theme="light" inline>
              <TokenSwatch name={token.name} kind={token.kind} />
            </PooldayRoot>
          </>
        ) : (
          <TokenSwatch name={token.name} kind={token.kind} />
        )}
        <Stack gap="xs">
          <Text variant="small" mono as="code">
            {token.name}
          </Text>
          <Text variant="caption" muted mono>
            {valueText}
          </Text>
        </Stack>
      </Row>
      <Row gap="sm">
        {token.uses === 0 ? <Badge tone="pending">{t.unused}</Badge> : <Badge>{t.uses(token.uses)}</Badge>}
        {token.themed && <Badge>{t.themed}</Badge>}
        <Text variant="caption" muted>
          {`${t.usedBy}: ${token.primitives.length ? token.primitives.join(', ') : t.none}`}
        </Text>
      </Row>
    </Stack>
  );
}

function TokenLayer({
  id,
  title,
  tokens,
  values,
}: {
  readonly id: string;
  readonly title: string;
  readonly tokens: ReadonlyArray<DesignToken>;
  readonly values: TokenValueState;
}) {
  return (
    <Stack gap="md" data={{ 'data-design-anchor': id }}>
      <Text variant="subheading" as="h3" id={id}>
        {title}
      </Text>
      {groupTokens(tokens).map(([group, members]) => (
        <Section key={group} title={`${group} (${members.length})`}>
          <List>
            {members.map((token) => (
              <TokenRow key={token.name} token={token} values={values} />
            ))}
          </List>
        </Section>
      ))}
    </Stack>
  );
}

function CompositionBlock({ specimen, width, primitives }: { readonly specimen: CompositionSpecimen; readonly width: 'wide' | 'narrow'; readonly primitives: ReadonlyArray<string> }) {
  const [state, setState] = useState(specimen.states[0]?.id ?? '');
  const shown = specimen.states.find((entry) => entry.id === state) ?? specimen.states[0];
  return (
    <Surface variant="card" as="article" data={{ 'data-composition': specimen.name }}>
      <Stack gap="md">
        <Text variant="heading" as="h3" id={`composition-${specimen.name}`}>
          {specimen.name}
        </Text>
        <Text variant="caption" muted>
          {`${t.composedOf}: ${primitives.length ? primitives.join(', ') : t.none}`}
        </Text>
        {/* Rows, not segments: state names are longer than short modes and must fit a phone. */}
        {specimen.states.length > 1 && (
          <SingleChoice
            label={`${specimen.name} ${t.state}`}
            value={state}
            onChange={setState}
            options={specimen.states.map((entry) => ({ value: entry.id, title: entry.label }))}
          />
        )}
        <Frame width={width} label={`${specimen.name}: ${shown?.label ?? ''}`}>
          {shown?.render()}
        </Frame>
      </Stack>
    </Surface>
  );
}

/**
 * The design system page: tokens, then primitives, then compositions, each read from the
 * generated index and the live stylesheets. Built only from packages/poolday-ui.
 */
export function DesignPage({
  index,
  tokenValues,
  compositions,
  theme,
  onTheme,
}: {
  readonly index: DesignIndex;
  readonly tokenValues: TokenValueState;
  readonly compositions: ReadonlyArray<CompositionSpecimen>;
  readonly theme: Theme;
  readonly onTheme: (theme: Theme) => void;
}) {
  const [width, setWidth] = useState<'wide' | 'narrow'>('wide');
  const raw = index.tokens.filter((token) => token.layer === 'raw');
  const semantic = index.tokens.filter((token) => token.layer === 'semantic');
  const shownCompositions = index.compositions.flatMap((entry) => compositions.filter((specimen) => specimen.name === entry.name));
  const nav: NavigatorItem[] = [
    {
      id: 'tokens',
      label: t.tokens,
      children: [
        { id: 'tokens-raw', label: t.rawTokens },
        { id: 'tokens-semantic', label: t.semanticTokens },
      ],
    },
    { id: 'primitives', label: t.primitives, children: index.primitives.map((primitive) => ({ id: `primitive-${primitive.name}`, label: primitive.name })) },
    { id: 'compositions', label: t.compositions, children: shownCompositions.map((specimen) => ({ id: `composition-${specimen.name}`, label: specimen.name })) },
  ];
  const spy = useScrollSpy(nav);

  return (
    <PooldayRoot theme={theme} data={{ 'data-design-page': true }}>
      <SidebarLayout navLabel={t.navLabel} nav={<Navigator items={nav} current={spy.current} onSelect={spy.select} />}>
        <Stack gap="md">
          <Wordmark />
          <Text variant="title" as="h1">
            {t.title}
          </Text>
          <Text muted>{t.lede}</Text>
          <Row gap="md">
            <SingleChoice
              layout="segmented"
              label={t.theme}
              value={theme}
              onChange={onTheme}
              options={[
                { value: 'dark', title: t.dark },
                { value: 'light', title: t.light },
              ]}
              data={{ 'data-design-theme': true }}
            />
            <SingleChoice
              layout="segmented"
              label={t.width}
              value={width}
              onChange={setWidth}
              options={[
                { value: 'wide', title: t.wide },
                { value: 'narrow', title: t.narrow },
              ]}
              data={{ 'data-design-width': true }}
            />
          </Row>
        </Stack>

        <Stack gap="lg">
          <Text variant="title" as="h2" id="tokens">
            {t.tokens}
          </Text>
          <Text variant="small" muted>
            {t.tokensNote}
          </Text>
          {tokenValues.status === 'loading' && <Spinner label={t.loadingTokens} />}
          <Notice tone="error">{tokenValues.status === 'failed' ? t.tokensFailed : null}</Notice>
          <TokenLayer id="tokens-raw" title={t.rawTokens} tokens={raw} values={tokenValues} />
          <TokenLayer id="tokens-semantic" title={t.semanticTokens} tokens={semantic} values={tokenValues} />
        </Stack>

        <Stack gap="lg">
          <Text variant="title" as="h2" id="primitives">
            {t.primitives}
          </Text>
          <Text variant="small" muted>
            {t.primitivesNote}
          </Text>
          {index.primitives.map((primitive) => (
            <Surface key={primitive.name} variant="card" as="article" data={{ 'data-primitive': primitive.name }}>
              <Stack gap="md">
                <Text variant="heading" as="h3" id={`primitive-${primitive.name}`}>
                  {primitive.name}
                </Text>
                <Text variant="small" muted>
                  {t.purpose[primitive.name] ?? ''}
                </Text>
                <PrimitiveSpecimen name={primitive.name} />
                <Text variant="caption" muted>
                  {`${t.usedIn}: ${primitive.compositions.length ? primitive.compositions.join(', ') : t.none}`}
                </Text>
                <Disclosure summary={`${t.usesTokens} (${primitive.tokens.length})`}>
                  <Text variant="caption" mono muted>
                    {primitive.tokens.join(' ')}
                  </Text>
                </Disclosure>
              </Stack>
            </Surface>
          ))}
        </Stack>

        <Stack gap="lg">
          <Text variant="title" as="h2" id="compositions">
            {t.compositions}
          </Text>
          <Text variant="small" muted>
            {t.compositionsNote}
          </Text>
          {shownCompositions.map((specimen) => (
            <CompositionBlock
              key={specimen.name}
              specimen={specimen}
              width={width}
              primitives={index.compositions.find((entry) => entry.name === specimen.name)?.primitives ?? []}
            />
          ))}
        </Stack>
      </SidebarLayout>
    </PooldayRoot>
  );
}
