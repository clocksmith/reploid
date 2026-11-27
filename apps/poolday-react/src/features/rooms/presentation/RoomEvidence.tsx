import { Badge, Button, Disclosure, Facts, List, ListItem, Notice, Row, Stack, Text } from '@reploid/poolday-ui';
import type { ReactNode } from 'react';
import type { RoomServices, RoomSnapshot } from '../domain/rooms';
import { rooms as t } from '../../../l10n/rooms';

type Props = { readonly view: RoomSnapshot; readonly services: RoomServices };
type Data = Record<`data-${string}`, string | boolean>;

/** A room section: its kicker, heading and a count or status beside it, as the vanilla room labelled each one. */
function Section({ kicker, title, badge, badgeData, children, data }: { readonly kicker: string; readonly title: string; readonly badge?: string; readonly badgeData?: Data; readonly children: ReactNode; readonly data: Data }) {
  return (
    <Stack gap="sm" data={data}>
      <Row justify="between">
        <Stack gap="xs">
          <Text variant="label" muted>
            {kicker}
          </Text>
          <Text variant="subheading" as="h2">
            {title}
          </Text>
        </Stack>
        {badge !== undefined && <Badge data={badgeData}>{badge}</Badge>}
      </Row>
      {children}
    </Stack>
  );
}

const Muted = ({ children }: { readonly children: ReactNode }) => (
  <Text variant="small" muted>
    {children}
  </Text>
);

/**
 * The room's governance sections: the replay checkpoint, the predeclared resolution criteria, the adjudication proof,
 * the public-protein campaign and exact-sequence prior-room evidence, each with its stated boundary.
 */
export function RoomEvidence({ view, services }: Props) {
  const room = view.room;
  const { contract, resolution, proof, campaign, prior } = room;
  return (
    <Stack gap="lg" data={{ 'data-pool-room-evidence': true }}>
      <Section kicker={t.replay} title={t.contract} badge={contract.label} data={{ 'data-pool-room-contract': true, 'data-contract-status': contract.status }}>
        <Muted>{t.contractBoundary}</Muted>
        {contract.facts.length ? <Facts items={contract.facts} /> : <Muted>{t.noCheckpoint}</Muted>}
        {contract.unfrozen !== '' && <Muted>{contract.unfrozen}</Muted>}
        {contract.triggers !== '' && <Muted>{contract.triggers}</Muted>}
        <Row>
          <Button
            label={contract.button}
            disabled={!contract.canCheckpoint}
            pending={view.pending.checkpoint === true}
            pendingLabel={t.checkpointing}
            onPress={() => void services.freezeContract()}
            data={{ 'data-pool-room-freeze-contract': true }}
          />
        </Row>
        {view.errors.checkpoint ? <Notice tone="error">{view.errors.checkpoint}</Notice> : null}
      </Section>
      <Section kicker={t.decisionBoundary} title={t.resolution} badge={resolution.label} data={{ 'data-pool-room-resolution': true, 'data-resolution-status': resolution.status }}>
        <Muted>{resolution.boundary}</Muted>
        {resolution.facts.length ? <Facts items={resolution.facts} /> : <Muted>{t.noCriteria}</Muted>}
      </Section>
      <Section kicker={t.proofKicker} title={t.proof} data={{ 'data-pool-room-adjudication-proof': true }}>
        <Muted>{t.proofStatus(proof.status)}</Muted>
        {proof.frozen ? (
          <>
            <Facts items={proof.facts} />
            <Muted>{t.proofRule}</Muted>
            {proof.evaluated ? (
              <List>
                {proof.metrics.map((metric) => (
                  <ListItem key={metric.title} title={metric.title} status={metric.detail} trailing={<Badge>{metric.meta ?? ''}</Badge>} />
                ))}
              </List>
            ) : (
              <Muted>{t.noEvaluation}</Muted>
            )}
          </>
        ) : (
          <Muted>{t.notFrozen}</Muted>
        )}
        {proof.gaps !== '' && <Muted>{proof.gaps}</Muted>}
      </Section>
      <Section kicker={t.campaignKicker} title={t.campaign} badge={t.count(campaign.count)} data={{ 'data-pool-protein-campaign': true }}>
        <Text variant="small">{campaign.state}</Text>
        {campaign.dimensions.length > 0 && (
          <List>
            {campaign.dimensions.map((dimension) => (
              <ListItem key={dimension.title} title={dimension.title} status={dimension.detail} trailing={<Badge>{dimension.meta ?? ''}</Badge>} />
            ))}
          </List>
        )}
        {campaign.eligible.length > 0 && (
          <List>
            {campaign.eligible.map((entry) => (
              <ListItem key={entry.href + entry.title} title={entry.title} status={entry.detail} href={entry.href} label={t.openRoom} />
            ))}
          </List>
        )}
        <Muted>{campaign.boundary}</Muted>
        <Muted>{t.campaignNote}</Muted>
      </Section>
      <Section kicker={t.reuse} title={t.prior} badge={t.count(prior.candidates.length)} badgeData={{ 'data-pool-room-count': true }} data={{ 'data-pool-room-prior-evidence': true }}>
        <Muted>{t.priorBoundary(prior.boundary)}</Muted>
        {prior.searching && <Muted>{t.priorSearching}</Muted>}
        {prior.error !== '' && <Muted>{prior.error}</Muted>}
        {prior.candidates.length ? (
          prior.candidates.map((candidate) => (
            <Stack key={`${candidate.originRoomId}:${candidate.hash}`} gap="xs" data={{ 'data-prior-room-qualification': candidate.qualification }}>
              <Text as="strong">{candidate.title}</Text>
              <Text variant="small">{candidate.summary}</Text>
              {candidate.details.map((detail) => (
                <Muted key={detail}>{detail}</Muted>
              ))}
              {candidate.attached !== '' ? (
                <Badge>{candidate.attached}</Badge>
              ) : candidate.attachable ? (
                <Row>
                  <Button
                    label={t.attachPrior}
                    pending={view.pending[`prior:${candidate.hash}`] === true}
                    pendingLabel={t.attaching}
                    onPress={() => void services.attachPrior(candidate.hash, candidate.originRoomId)}
                    data={{ 'data-pool-room-attach-prior': candidate.hash, 'data-pool-room-prior-origin': candidate.originRoomId }}
                  />
                </Row>
              ) : (
                <Badge>{t.manualQualification}</Badge>
              )}
              {view.errors[`prior:${candidate.hash}`] ? <Notice tone="error">{view.errors[`prior:${candidate.hash}`]}</Notice> : null}
              <Text variant="caption" muted>
                {candidate.meta}
              </Text>
            </Stack>
          ))
        ) : (
          <Muted>{prior.empty}</Muted>
        )}
      </Section>
    </Stack>
  );
}

/** The room's signed proposals, each with what supports it, what is missing and what would distinguish it. */
export function RoomProposals({ view }: { readonly view: RoomSnapshot }) {
  const proposals = view.room.proposals;
  return (
    <Section kicker={t.inspiration} title={t.proposals} badge={t.count(proposals.length)} data={{ 'data-pool-room-proposals': true }}>
      <Muted>{t.proposalsBoundary}</Muted>
      {proposals.length ? (
        proposals.map((proposal, index) => (
          <Stack key={index} gap="xs" data={{ 'data-proposal-kind': proposal.kind }}>
            <Row justify="between">
              <Text as="strong">{proposal.title}</Text>
              <Badge>{proposal.status}</Badge>
            </Row>
            <Text variant="small">{proposal.summary}</Text>
            <Facts items={proposal.facts} />
            <Row>
              <Button variant="quiet" label={t.inspectProposal} href={proposal.href} />
            </Row>
          </Stack>
        ))
      ) : (
        <Muted>{t.noProposals}</Muted>
      )}
    </Section>
  );
}

/** Accepted, disputed and missing evidence side by side, once the room has a question, a result or memory. */
export function AdjudicationCanvas({ view }: { readonly view: RoomSnapshot }) {
  const canvas = view.room.canvas;
  if (!canvas) return null;
  const column = (title: string, badge: string, items: ReadonlyArray<{ readonly title: string; readonly detail?: string }>, empty: string, state: string) => (
    <Stack gap="xs" data={{ 'data-pool-room-canvas-column': state }}>
      <Row justify="between">
        <Text as="strong">{title}</Text>
        <Badge>{badge}</Badge>
      </Row>
      {items.length ? (
        <List>
          {items.map((item, index) => (
            <ListItem key={index} title={item.title} status={item.detail} />
          ))}
        </List>
      ) : (
        <Muted>{empty}</Muted>
      )}
    </Stack>
  );
  return (
    <Section kicker={t.canvasKicker} title={t.canvas} data={{ 'data-pool-room-adjudication-canvas': true }}>
      {column(t.canvasAccepted(canvas.accepted.length), t.admitted, canvas.accepted, t.noAccepted, 'accepted')}
      {column(t.canvasDisputed(canvas.disputed.length), t.unresolvedBadge, canvas.disputed, t.noDisputed, 'disputed')}
      {column(t.canvasMissing, t.pendingBadge, canvas.missing, t.noMissing, 'missing')}
    </Section>
  );
}

/** The room timeline: anchors and the latest entries, with intervening events folded behind a disclosure. */
export function RoomTimeline({ view }: { readonly view: RoomSnapshot }) {
  const room = view.room;
  const entry = (item: (typeof room.timelineShown)[number], index: number) => (
    <ListItem key={index} title={item.title} status={`${item.summary} ${item.meta}`} trailing={<Badge>{item.status}</Badge>} />
  );
  return (
    <Section kicker={t.causal} title={t.timeline} badge={t.count(room.timeline.length)} data={{ 'data-pool-room-timeline': true }}>
      <List>{room.timeline.length ? room.timelineShown.map(entry) : <ListItem title={t.roomCreated} status={t.roomCreatedBody} />}</List>
      {room.timelineHidden.length > 0 && (
        <Disclosure summary={t.intervening(room.timelineHidden.length)} quiet>
          <List>{room.timelineHidden.map(entry)}</List>
        </Disclosure>
      )}
    </Section>
  );
}
