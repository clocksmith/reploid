import { Badge, Disclosure, Field, List, ListItem, Row, SingleChoice, Stack, Stats, Text } from '@reploid/poolday-ui';
import type { RoomServices, RoomSnapshot } from '../domain/rooms';
import { rooms as t } from '../../../l10n/rooms';
import { Caption, LifecycleFormView, NextWorkPanel, Panel, RecordCard, ReviewPanel } from './sections/ResearchWorkspacePanels';

type Props = { readonly view: RoomSnapshot; readonly services: RoomServices };

/**
 * The evidence-network workspace: its counts, the signed record collection, exact-model evidence, the review form, the
 * lifecycle forms, compatible-sequence discovery, the governed next-work queues and participation quality.
 */
export function ResearchWorkspace({ view, services }: Props) {
  const workspace = view.workspace;
  return (
    <Stack gap="md" data={{ 'data-pool-research-workspace': true, 'data-room-id': view.roomId }}>
      <Row justify="between">
        <Stack gap="xs">
          <Text variant="label" muted>
            {t.network}
          </Text>
          <Text variant="subheading" as="h2">
            {t.lifecycle}
          </Text>
          <Text variant="small">{t.lifecycleBody}</Text>
        </Stack>
        <Badge data={{ 'data-pool-research-sync': true }}>{workspace.sync}</Badge>
      </Row>
      <Stats label={t.stats} items={workspace.stats} data={{ 'data-research-stats': true }} />
      <Panel kicker={t.connect} title={t.collection}>
        <Field type="search" label={t.search} value={workspace.query} placeholder={t.searchPlaceholder} onChange={services.setQuery} data={{ 'data-research-search': true }} />
        {workspace.records.length ? (
          <Stack gap="md" data={{ 'data-research-records': true }}>
            {workspace.records.map((record) => (
              <RecordCard key={record.hash} record={record} />
            ))}
          </Stack>
        ) : (
          <Caption>{t.noEvidence}</Caption>
        )}
      </Panel>
      <Panel kicker={t.modelKicker} title={t.modelTitle} data={{ 'data-research-model-evidence': true }}>
        {workspace.modelEvidence.length ? (
          workspace.modelEvidence.map((evidence, index) => (
            <Stack key={index} gap="xs" data={{ 'data-research-model-evidence-entry': true }}>
              <Row justify="between">
                <Text as="strong">{evidence.title}</Text>
                <Caption>{evidence.sources}</Caption>
              </Row>
              {evidence.entries.length ? (
                <List>
                  {evidence.entries.map((entry) => (
                    <ListItem key={entry.identity} title={entry.title} status={[entry.counts, entry.identity, entry.residues, entry.boundaries].filter(Boolean).join(' ')} />
                  ))}
                </List>
              ) : (
                <Caption>{t.noModelOutput}</Caption>
              )}
              <Text variant="small">{t.agreementLine(evidence.agreement)}</Text>
              <Text variant="small">{t.disagreementLine(evidence.disagreement)}</Text>
              {evidence.shared !== '' && <Caption>{evidence.shared}</Caption>}
              <Disclosure summary={t.uncertaintyNext} quiet>
                {evidence.uncertainty.map((line) => (
                  <Text key={line} variant="small">
                    {line}
                  </Text>
                ))}
                <Text variant="small">{`${evidence.next.kind}: ${evidence.next.reason}`}</Text>
              </Disclosure>
            </Stack>
          ))
        ) : (
          <Caption>{t.noModelEvidence}</Caption>
        )}
        <Caption>{t.modelNote}</Caption>
      </Panel>
      <ReviewPanel view={view} services={services} />
      {workspace.forms.map((section) => (
        <Panel key={section.title} kicker={section.kicker} title={section.title} anchor={section.anchor} data={section.anchor ? { 'data-research-section': section.anchor } : { 'data-research-section': section.kicker }}>
          {section.parts.map((part, index) => (part.k === 'note' ? <Caption key={index}>{part.text}</Caption> : <LifecycleFormView key={part.action} form={part} services={services} />))}
        </Panel>
      ))}
      <Panel kicker={t.discoverKicker} title={t.discoverTitle} anchor="pool-room-discovery" data={{ 'data-pool-room-panel-target': 'discovery', 'data-pool-room-discovery': true }}>
        {workspace.discovery.results.length > 0 && (
          <SingleChoice label={t.similarityTarget} value={workspace.discovery.target || null} options={workspace.discovery.results} onChange={services.setSimilarityTarget} data={{ 'data-research-similarity-target': true }} />
        )}
        {workspace.discovery.similar.length ? (
          <List>
            {workspace.discovery.similar.map((entry, index) => (
              <ListItem key={index} title={entry.title} status={`${entry.detail} · ${entry.meta}`} />
            ))}
          </List>
        ) : (
          <Caption>{t.noSimilar}</Caption>
        )}
        <Disclosure summary={t.clusters(workspace.discovery.clusters.length)} quiet>
          {workspace.discovery.clusters.length ? (
            <List>
              {workspace.discovery.clusters.map((cluster) => (
                <ListItem key={cluster.title} title={cluster.title} status={`${cluster.detail} · ${cluster.meta}`} />
              ))}
            </List>
          ) : (
            <Caption>{t.noClusters}</Caption>
          )}
        </Disclosure>
        <Caption>{t.discoverNote}</Caption>
      </Panel>
      <NextWorkPanel view={view} services={services} />
      <Panel kicker={t.qualityKicker} title={t.qualityTitle}>
        {workspace.rewards.length ? (
          <List>
            {workspace.rewards.map((reward) => (
              <ListItem key={reward.title} title={reward.title} status={reward.detail} />
            ))}
          </List>
        ) : (
          <Caption>{t.noRewards}</Caption>
        )}
        <Caption>{t.qualityNote}</Caption>
      </Panel>
    </Stack>
  );
}
