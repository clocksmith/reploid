import { useSyncExternalStore } from 'react';
import { Badge, Button, Disclosure, Facts, Field, List, ListItem, Notice, Row, SingleChoice, Stack, StatusLine, Text, TextArea, Toggle } from '@reploid/poolday-ui';
import type { RoomServices, RoomSnapshot, RoomView } from '../domain/rooms';
import { rooms as t } from '../../../l10n/rooms';
import { ResearchWorkspace } from './ResearchWorkspace';
import { AdjudicationCanvas, RoomEvidence, RoomProposals, RoomTimeline } from './RoomEvidence';

type Props = { readonly view: RoomSnapshot; readonly services: RoomServices };

/** A room section: its kicker, heading and an optional count, as the vanilla room labelled each one. */
function Heading({ kicker, title, count }: { readonly kicker: string; readonly title: string; readonly count?: number }) {
  return (
    <Row justify="between">
      <Stack gap="xs">
        <Text variant="label" muted>
          {kicker}
        </Text>
        <Text variant="subheading" as="h2">
          {title}
        </Text>
      </Stack>
      {count !== undefined && <Badge data={{ 'data-pool-room-count': true }}>{t.count(count)}</Badge>}
    </Row>
  );
}

/** The research request: sequence, model, publication consent, the bounded question and verification. */
function RoomRequest({ view, services }: Props) {
  const draft = view.draft;
  return (
    <Stack gap="md" data={{ 'data-pool-room-1-request': true, 'data-pool-run': true }}>
      <Text variant="heading" as="h2">
        {t.request}
      </Text>
      <TextArea label={t.sequence} rows={3} value={draft.sequence} onChange={(value) => services.setDraft('sequence', value)} data={{ 'data-pool-run-prompt': true }} />
      <SingleChoice label={t.model} value={draft.model} onChange={(value) => services.setDraft('model', value)} options={view.models} data={{ 'data-pool-run-model': true }} />
      <Disclosure summary={t.modelDetails} quiet data={{ 'data-pool-pack-summary': true }}>
        <Facts items={view.pack} />
      </Disclosure>
      <Stack gap="xs">
        <Text variant="label" muted>
          {t.publication}
        </Text>
        <Toggle title={t.sequencePublic} checked={draft.sequencePublic} onChange={(value) => services.setDraft('sequencePublic', value)} controlData={{ 'data-pool-run-sequence-public': true }} />
        <Toggle title={t.researchPublic} checked={draft.researchPublic} onChange={(value) => services.setDraft('researchPublic', value)} controlData={{ 'data-pool-run-research-public': true }} />
        <Text variant="small" muted>
          {t.publicationNote}
        </Text>
      </Stack>
      <SingleChoice label={t.intent} value={draft.intentKind} onChange={(value) => services.setDraft('intentKind', value)} options={view.intentKinds} data={{ 'data-pool-run-intent-kind': true }} />
      <Field label={t.shortLabel} value={draft.intentLabel} maxLength={240} placeholder={t.shortLabelPlaceholder} onChange={(value) => services.setDraft('intentLabel', value)} data={{ 'data-pool-run-intent-label': true }} />
      <TextArea label={t.intentText} rows={3} maxLength={8000} value={draft.intentText} placeholder={t.intentTextPlaceholder} onChange={(value) => services.setDraft('intentText', value)} data={{ 'data-pool-run-intent-text': true }} />
      <Disclosure summary={t.bound} quiet>
        <Stack gap="sm">
          {t.bounds.map(([field, label, placeholder]) => (
            <TextArea key={field} label={label} rows={2} maxLength={2000} value={draft[field]} placeholder={placeholder} onChange={(value) => services.setDraft(field, value)} data={{ 'data-pool-run-bound': field }} />
          ))}
        </Stack>
      </Disclosure>
      <SingleChoice label={t.verification} value={draft.policy} onChange={(value) => services.setDraft('policy', value)} options={view.policies} data={{ 'data-pool-run-policy': true }} />
      <Row justify="between">
        <StatusLine data={{ 'data-pool-run-status': true }}>{view.status}</StatusLine>
        <Button variant="primary" size="action" label={t.submit} disabled data={{ 'data-pool-run-submit': true }} />
      </Row>
    </Stack>
  );
}

/** The research room projected from signed records: question, result, next action, then its history and details. */
function ResearchRoom({ room, view, services }: Props & { readonly room: RoomView }) {
  const approve = room.next.approve;
  const approveKey = approve ? (approve.kind === 'candidate' ? `candidate:${approve.targetHash}` : `task:${approve.taskId}`) : '';
  return (
    <Stack gap="lg" data={{ 'data-pool-research-room': true, 'data-room-id': room.roomId, 'data-room-route': 'room-1', 'data-room-panel': view.panel }}>
      <Row justify="between">
        <Stack gap="xs">
          <Text variant="label" muted>
            {t.kicker}
          </Text>
          <Text variant="heading" as="h2">
            {t.room}
          </Text>
        </Stack>
        <Badge data={{ 'data-pool-room-status': room.status }}>{room.statusLabel}</Badge>
      </Row>
      {room.recovery && (
        <Notice tone="pending" data={{ 'data-pool-room-recovery': true }}>
          {[room.recovery.states.join(' · '), ...room.recovery.details].filter(Boolean).join(' ')}
        </Notice>
      )}
      <Stack gap="sm" data={{ 'data-pool-room-question': true }}>
        <Text variant="label" muted>
          {t.question}
        </Text>
        {room.question ? (
          <>
            <Text variant="subheading" as="h2">
              {room.question.title}
            </Text>
            {room.question.text !== '' && <Text>{room.question.text}</Text>}
            <Facts items={room.question.facts} />
            {room.question.gaps.length > 0 && (
              <Disclosure summary={room.question.gapsTitle} quiet>
                {room.question.gaps.map((gap) => (
                  <Text key={gap} variant="small">
                    {gap}
                  </Text>
                ))}
              </Disclosure>
            )}
          </>
        ) : (
          <>
            <Text variant="subheading" as="h2">
              {t.noQuestion}
            </Text>
            <Row gap="sm">
              <Button label={t.askQuestion} href={room.next.href} />
              <Button label={t.loadSample} disabled describedBy="pool-room-sample-blocked" data={{ 'data-pool-load-sample-dispute': true }} />
            </Row>
            <Text variant="small" muted id="pool-room-sample-blocked" data={{ 'data-pool-load-sample-dispute-reason': true }}>
              {view.sampleBlocked}
            </Text>
          </>
        )}
      </Stack>
      <Stack gap="sm" data={{ 'data-pool-room-result': true, 'data-room-result-card': true }}>
        <Text variant="label" muted>
          {t.result}
        </Text>
        {room.result ? (
          <>
            <Row justify="between">
              <Text variant="subheading" as="h2">
                {t.evidence}
              </Text>
              <Badge>{room.result.status}</Badge>
            </Row>
            <Facts items={[[t.agreement, room.result.agreement], [t.review, room.result.review], [t.receipt, room.result.receipt]]} />
            <Button label={t.review} href={room.result.reviewHref} />
            <Disclosure summary={t.technical} quiet>
              <Facts items={room.result.technical} />
              <Text as="strong">{t.uncertaintyLimits}</Text>
              {room.result.uncertainty.length ? (
                room.result.uncertainty.map((entry) => (
                  <Text key={entry} variant="small">
                    {entry}
                  </Text>
                ))
              ) : (
                <Text variant="caption" muted>
                  {t.noUncertainty}
                </Text>
              )}
              <Text variant="caption" muted>
                {t.rawHidden}
              </Text>
            </Disclosure>
          </>
        ) : (
          <>
            <Text variant="subheading" as="h2">
              {t.noResult}
            </Text>
            <Row>
              <Button variant="primary" label={t.run} href={room.requestHref} />
            </Row>
          </>
        )}
      </Stack>
      <AdjudicationCanvas view={view} />
      <Stack gap="sm" data={{ 'data-pool-room-action-card': true }}>
        <Text variant="label" muted>
          {t.next}
        </Text>
        <Text variant="subheading" as="h2">
          {room.next.title}
        </Text>
        <Text>{room.next.body}</Text>
        {room.next.boundary !== '' && (
          <Text variant="small" muted>
            {room.next.boundary}
          </Text>
        )}
        {room.next.basis !== '' && (
          <Disclosure summary={t.whyAction} quiet>
            <Text variant="small">{room.next.reason}</Text>
            <Text variant="small">{room.next.basis}</Text>
          </Disclosure>
        )}
        {room.next.raw.length > 0 && (
          <Disclosure summary={t.rawCandidate} quiet>
            <Facts items={room.next.raw} />
          </Disclosure>
        )}
        <Row gap="sm">
          {approve && (
            <Button
              variant="primary"
              label={approve.label}
              pending={view.pending[approveKey] === true}
              pendingLabel={t.signing}
              onPress={() => void (approve.kind === 'candidate' ? services.approveCandidate(approve.targetHash, approve.contractHash) : services.approveTask(approve.taskId, approve.targetHash))}
              data={approve.kind === 'candidate' ? { 'data-pool-room-approve-candidate': approve.targetHash, 'data-pool-room-candidate-contract': approve.contractHash } : { 'data-pool-room-approve-task': approve.taskId, 'data-pool-room-task-target': approve.targetHash }}
            />
          )}
          <Button label={t.open} href={room.next.href} />
        </Row>
        {approveKey !== '' && view.errors[approveKey] ? <Notice tone="error">{view.errors[approveKey]}</Notice> : null}
      </Stack>
      <Disclosure summary={t.history} quiet data={{ 'data-pool-room-technical-disclosure': true }}>
        <Stack gap="lg">
          <Stack gap="xs" data={{ 'data-pool-room-participants': true }}>
            {room.participants.length ? (
              room.participants.map((entry) => (
                <Text key={`${entry.role}:${entry.label}`} variant="small">
                  {[entry.role, entry.label, entry.status].filter(Boolean).join(' · ')}
                </Text>
              ))
            ) : (
              <Text variant="small" muted>
                {t.noParticipants}
              </Text>
            )}
          </Stack>
          <Stack gap="sm" data={{ 'data-pool-room-unresolved': true }}>
            <Heading kicker={t.openQuestions} title={t.unresolved} count={room.unresolved.length} />
            {room.unresolved.length ? (
              <List>
                {room.unresolved.map((entry, index) => (
                  <ListItem key={index} title={entry.title} status={entry.detail} href={entry.href} data={{ 'data-kind': entry.kind }} />
                ))}
              </List>
            ) : (
              <Text variant="small" muted>
                {t.noUnresolved}
              </Text>
            )}
          </Stack>
          <Stack gap="sm" data={{ 'data-pool-room-memory': true }}>
            <Heading kicker={t.decisionMemory} title={t.remembered} count={room.memory.length} />
            <Text variant="small" muted>
              {t.memoryBoundary(room.memoryPolicy)}
            </Text>
            {room.memory.length ? (
              <List>
                {room.memory.map((entry, index) => (
                  <ListItem key={index} title={entry.title} status={`${entry.detail} ${entry.meta}`} />
                ))}
              </List>
            ) : (
              <Text variant="small" muted>
                {t.noMemory}
              </Text>
            )}
          </Stack>
          <RoomEvidence view={view} services={services} />
          <Stack gap="sm" data={{ 'data-pool-room-archive': true }}>
            <Heading kicker={t.immutable} title={t.archive} count={room.archive.length} />
            <Text variant="small" muted>
              {t.archiveBoundary(room.archiveBoundary)}
            </Text>
            {room.archive.length ? (
              <List>
                {room.archive.map((entry, index) => (
                  <ListItem key={index} title={entry.title} status={[entry.detail, entry.exclusion, entry.meta].filter(Boolean).join(' ')} data={{ 'data-archive-state': entry.state }} />
                ))}
              </List>
            ) : (
              <Text variant="small" muted>
                {t.noArchive}
              </Text>
            )}
          </Stack>
          <RoomTimeline view={view} />
          <RoomProposals view={view} />
          <Stack gap="sm" data={{ 'data-pool-room-roles': true }}>
            <Heading kicker={t.participate} title={t.roles} />
            <List>
              {room.roles.map((role) => (
                <ListItem key={role.title} title={role.title} status={role.body} href={role.href} label={role.link} />
              ))}
            </List>
          </Stack>
          <Facts items={room.facts} />
        </Stack>
      </Disclosure>
    </Stack>
  );
}

/** Research Room-1: the request, the active room, any opened review or discovery panel, and the research workspace. */
export function RoomPage({ services }: { readonly services: RoomServices }) {
  const view = useSyncExternalStore(services.subscribe, services.getSnapshot);
  return (
    <Stack gap="lg" data={{ 'data-route-page-content': 'room-1' }}>
      <Stack gap="xs" data={{ 'data-pool-page-heading': true }}>
        <Text variant="title" as="h1">
          {view.title}
        </Text>
        <Text muted>{view.body}</Text>
      </Stack>
      <RoomRequest view={view} services={services} />
      <ResearchRoom room={view.room} view={view} services={services} />
      {view.contextual && (
        <Stack gap="xs" data={{ 'data-pool-room-contextual-panel': view.panel }}>
          <Text variant="subheading" as="h2">
            {view.contextual.title}
          </Text>
          <Text variant="small">{view.contextual.body}</Text>
        </Stack>
      )}
      <Stack gap="md" data={{ 'data-pool-room-panel': 'research', 'data-pool-room-panel-open': String(view.panel !== 'overview') }}>
        <Text variant="heading" as="h2">
          {t.workspace}
        </Text>
        <ResearchWorkspace view={view} services={services} />
      </Stack>
    </Stack>
  );
}
