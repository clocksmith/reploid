import { useSyncExternalStore } from 'react';
import {
  Badge, Button, Card, CodeBlock, Disclosure, Field, FilePicker, List, ListItem, MultiChoice, Notice, Row, Section, SingleChoice, Stack, Text, Toggle,
} from '@reploid/poolday-ui';
import type { CandidateView, ImproveServices, ResultView, ToolsView, TrainingView } from '../domain/improve';
import { improve as t } from '../../../l10n/improve';

/** LoRA adapter training: samples, the adapter's name and version, consent, then a local or pooled round. */
function TrainingPanel({ training, services }: { readonly training: TrainingView; readonly services: ImproveServices }) {
  return (
    <Disclosure summary={t.training.title} data={{ 'data-lora-panel': true }}>
      <Stack gap="md">
        <Text>{t.training.about}</Text>
        <Text variant="caption">{t.training.limits}</Text>
        <FilePicker label={t.training.samples} accept=".json,application/json" onFiles={(files) => services.chooseSamples(files[0] ?? null)} data={{ 'data-lora-file': true }}>
          {(open) => <Button label={t.training.chooseSamples} icon="upload" onPress={training.disabled ? undefined : open} />}
        </FilePicker>
        <Field label={t.training.adapterId} value={training.adapterId} maxLength={96} onChange={(value) => services.setTrainingField('adapterId', value)} data={{ 'data-lora-id': true }} />
        <Field label={t.training.version} value={training.version} onChange={(value) => services.setTrainingField('version', value)} data={{ 'data-lora-version': true }} />
        <Toggle
          title={t.training.consent}
          status={t.training.consentStatus}
          checked={training.consent}
          onChange={(on) => services.setTrainingField('consent', on)}
          controlData={{ 'data-lora-consent': true }}
        />
        <Row gap="xs">
          <Button label={t.training.trainHere} onPress={training.disabled ? undefined : services.trainHere} data={{ 'data-lora-local': true }} />
          <Button label={t.training.stop} onPress={services.stopTraining} data={{ 'data-lora-stop': true }} />
        </Row>
        <Disclosure summary={t.training.pooled}>
          <Text variant="caption">{t.training.pooledAbout}</Text>
          <Row>
            <Button label={t.training.connect} onPress={services.connectTraining} data={{ 'data-lora-connect': true }} />
          </Row>
          {training.peers.length === 0 ? (
            <Text variant="small" muted>
              {`${t.training.coordinator}: ${t.training.connectFirst}`}
            </Text>
          ) : (
            <>
              <SingleChoice
                label={t.training.coordinator}
                value={training.coordinator || null}
                onChange={(value) => services.setTrainingField('coordinator', value)}
                options={training.peers.map((peer) => ({ value: peer.id, title: peer.name }))}
                data={{ 'data-lora-coordinator': true }}
              />
              <MultiChoice
                label={t.training.participants}
                values={training.selected}
                onChange={(values) => services.setTrainingField('selected', values)}
                options={training.peers.map((peer) => ({ value: peer.id, title: peer.name, inputData: { 'data-lora-peer': peer.id } }))}
                data={{ 'data-lora-peers': true }}
              />
            </>
          )}
          <Row gap="xs">
            <Button label={t.training.contribute} onPress={training.disabled ? undefined : services.contributeRound} data={{ 'data-lora-share': true }} />
            <Button label={t.training.trainPooled} onPress={training.disabled ? undefined : services.trainPooled} data={{ 'data-lora-pool': true }} />
          </Row>
        </Disclosure>
        <Text data={{ 'data-lora-status': true }}>{training.status}</Text>
        <Notice tone="error" data={{ 'data-lora-error': true }}>
          {training.error || null}
        </Notice>
        {training.downloads && (
          <Row gap="xs" data={{ 'data-lora-downloads': true }}>
            <Button label={t.training.manifest} icon="download" onPress={() => services.downloadAdapter('manifest')} data={{ 'data-lora-manifest': true }} />
            <Button label={t.training.weights} icon="download" onPress={() => services.downloadAdapter('weights')} data={{ 'data-lora-weights': true }} />
          </Row>
        )}
      </Stack>
    </Disclosure>
  );
}

/** One tool candidate: its target, state, reason and checks, its code and sharing, and the decision it awaits. */
function Candidate({ candidate, services }: { readonly candidate: CandidateView; readonly services: ImproveServices }) {
  return (
    <Card title={candidate.targetId} status={candidate.state} data={{ 'data-work-candidate': candidate.id, 'data-change-card': true }}>
      {candidate.origin && <Button variant="quiet" label={candidate.origin.label} onPress={() => services.select(candidate.origin?.id ?? '')} data={{ 'data-work-select': candidate.origin.id }} />}
      {candidate.imported && <Text variant="caption">{t.tools.imported}</Text>}
      <Text variant="small">{candidate.reason}</Text>
      {candidate.checks !== '' && <Text variant="small">{candidate.checks}</Text>}
      {candidate.latency && (
        <Disclosure summary={t.tools.measured}>
          <Text variant="small">{candidate.latency.summary}</Text>
          <Text variant="small" muted>
            {candidate.latency.detail}
          </Text>
        </Disclosure>
      )}
      {candidate.error !== '' && (
        <Text variant="subheading" data={{ 'data-candidate-error': true }}>
          {candidate.error}
        </Text>
      )}
      <Disclosure summary={t.tools.codeAndSharing}>
        <CodeBlock label={t.tools.code}>{candidate.code}</CodeBlock>
        {candidate.canExportOffer && (
          <>
            <Text variant="small" muted>
              {t.tools.fileNote}
            </Text>
            <Row>
              <Button variant="quiet" label={t.tools.downloadCandidate} onPress={candidate.exportDisabled ? undefined : () => services.exportOffer(candidate.id)} data={{ 'data-tool-offer-export': candidate.id }} />
            </Row>
          </>
        )}
        {candidate.send && (
          <Stack gap="sm">
            {candidate.send.peers.length ? (
              <SingleChoice
                label={t.tools.recipient}
                value={candidate.send.value}
                onChange={(peer) => services.choosePeer(candidate.id, peer)}
                options={candidate.send.peers}
                disabled={candidate.send.disabled}
                data={{ 'data-tool-peer': candidate.id }}
              />
            ) : (
              <Text variant="small" muted>
                {`${t.tools.recipient}: ${candidate.send.empty}`}
              </Text>
            )}
            <Row>
              <Button
                variant="quiet"
                label={t.tools.sendCandidate}
                onPress={candidate.send.disabled || !candidate.send.value ? undefined : () => services.sendOffer(candidate.id)}
                data={{ 'data-tool-offer-send': candidate.id }}
              />
            </Row>
          </Stack>
        )}
        <Row>
          <Button variant="quiet" label={t.tools.downloadEvaluation} onPress={() => services.exportEvaluation(candidate.id)} data={{ 'data-candidate-export': candidate.id }} />
        </Row>
      </Disclosure>
      {candidate.decide && (
        <Row gap="sm">
          <Button variant="primary" label={t.tools.adopt} onPress={candidate.decide.disabled ? undefined : () => services.decide(candidate.id, true)} data={{ 'data-candidate-adopt': candidate.id }} />
          <Button variant="quiet" label={t.tools.keep} onPress={candidate.decide.disabled ? undefined : () => services.decide(candidate.id, false)} data={{ 'data-candidate-reject': candidate.id }} />
        </Row>
      )}
      {candidate.rollback && (
        <Row>
          <Button variant="quiet" label={t.tools.restore} onPress={candidate.rollback.disabled ? undefined : () => services.rollback(candidate.id)} data={{ 'data-candidate-rollback': candidate.id }} />
        </Row>
      )}
    </Card>
  );
}

/** Tool updates: tested candidates awaiting a decision, and the explicit import and peer handoff of a candidate file. */
function ToolUpdates({ tools, services }: { readonly tools: ToolsView; readonly services: ImproveServices }) {
  const offers = tools.offers;
  return (
    <Section title={t.tools.title} data={{ 'data-work-experiments': true }}>
      <Stack gap="md">
        {tools.empty && (
          <Text variant="small" muted data={{ 'data-improvement-empty': true }}>
            {t.tools.empty}
          </Text>
        )}
        {offers && (
          <Disclosure summary={t.tools.importTitle} data={{ 'data-tool-offer-panel': true }}>
            <Toggle
              title={t.tools.receive}
              status={t.tools.receiveStatus}
              checked={offers.receive.checked}
              disabled={offers.receive.disabled}
              onChange={services.allowOffers}
              controlData={{ 'data-tool-offer-receive': true }}
            />
            <FilePicker label={t.tools.candidateFile} accept=".json,application/json" onFiles={(files) => services.importOfferFile(files[0] ?? null)} data={{ 'data-tool-offer-file': true }}>
              {(open) => <Button label={t.tools.chooseFile} icon="upload" onPress={offers.fileDisabled ? undefined : open} />}
            </FilePicker>
            {offers.preview && (
              <Stack gap="sm" data={{ 'data-tool-offer-preview': true }}>
                <Text variant="subheading" data={{ 'data-tool-offer-target': true }}>
                  {offers.preview.target}
                </Text>
                <Text variant="small" data={{ 'data-tool-offer-reason': true }}>
                  {offers.preview.reason}
                </Text>
                <Text variant="small" muted data={{ 'data-tool-offer-source': true }}>
                  {offers.preview.source}
                </Text>
                <Disclosure summary={t.tools.inspectCode}>
                  <CodeBlock label={t.tools.code} data={{ 'data-tool-offer-code': true }}>
                    {offers.preview.code}
                  </CodeBlock>
                </Disclosure>
                <Text variant="small" muted>
                  {t.tools.evaluateNote}
                </Text>
                <Row>
                  <Button variant="primary" label={t.tools.evaluate} onPress={offers.preview.evaluateDisabled ? undefined : services.evaluateOffer} data={{ 'data-tool-offer-evaluate': true }} />
                </Row>
              </Stack>
            )}
          </Disclosure>
        )}
        {offers && (offers.inbox.length > 0 || offers.outbox.length > 0) && (
          <Stack gap="sm" data={{ 'data-tool-peer-inbox': true }}>
            {offers.inbox.map((record) => (
              <Row key={record.id} gap="sm">
                <Text variant="small" muted>
                  {record.text}
                </Text>
                <Button variant="quiet" label={t.tools.previewPeer} onPress={() => services.previewPeerOffer(record.id)} data={{ 'data-tool-offer-preview-peer': record.id }} />
                <Button variant="quiet" label={t.tools.dismiss} onPress={() => services.dismissPeerOffer(record.id)} data={{ 'data-tool-offer-dismiss': record.id }} />
              </Row>
            ))}
            {offers.outbox.map((record) => (
              <Row key={record.id} gap="sm">
                <Text variant="small" muted>
                  {record.text}
                </Text>
                {record.retry && <Button variant="quiet" label={t.tools.retryDelivery} onPress={() => services.retryOffer(record.id)} data={{ 'data-tool-offer-retry': record.id }} />}
              </Row>
            ))}
          </Stack>
        )}
        <Stack gap="md" data={{ 'data-work-candidates': true }}>
          {tools.candidates.map((candidate) => (
            <Candidate key={candidate.id} candidate={candidate} services={services} />
          ))}
        </Stack>
        <Notice data={{ 'data-experiment-status': true }}>{tools.status || null}</Notice>
      </Stack>
    </Section>
  );
}

/** The selected attempt's result: deliverables, outcome tags, review, activity and the audit details. */
function AttemptResult({ result, status, services }: { readonly result: ResultView | null; readonly status: string; readonly services: ImproveServices }) {
  return (
    <Stack gap="md" data={{ 'data-work-output': true }}>
      <Row justify="between">
        <Stack gap="xs">
          {result?.title && (
            <Text variant="heading" as="h2" data={{ 'data-work-result-title': true }}>
              {t.results}
            </Text>
          )}
          <Row gap="xs" data={{ 'data-work-outcome-tags': true }}>
            {(result?.tags ?? []).map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </Row>
        </Stack>
        <Text as="span" variant="caption" data={{ 'data-work-review-status': true }}>
          {result?.reviewStatus || status}
        </Text>
      </Row>
      {result?.answer && <Text data={{ 'data-work-answer': true }}>{result.answer}</Text>}
      {result?.error && (
        <Text variant="subheading" data={{ 'data-work-result-error': true }}>
          {result.error}
        </Text>
      )}
      {result && result.artifacts.length > 0 && (
        <List data={{ 'data-work-artifacts': true }}>
          {result.artifacts.map((artifact) => (
            <ListItem key={artifact.id} icon="download" title={artifact.label} status={artifact.meta} label={artifact.title || undefined} onPress={() => services.downloadArtifact(artifact.id)} data={{ 'data-work-artifact': artifact.id }} />
          ))}
        </List>
      )}
      {result?.progress.visible && (
        <Disclosure summary={t.activity} defaultOpen={result.progress.open} data={{ 'data-work-progress': true }}>
          <Stack gap="xs" data={{ 'data-work-team': true }}>
            {result.progress.team.map((line, index) => (
              <Text key={index} variant="small">
                {line.text}
              </Text>
            ))}
          </Stack>
          <Stack gap="xs" data={{ 'data-work-events': true }}>
            {result.progress.events.map((line, index) => (
              <Text key={index} variant="small">
                {line}
              </Text>
            ))}
          </Stack>
          {result.progress.draft !== '' && <CodeBlock data={{ 'data-work-draft': true }}>{result.progress.draft}</CodeBlock>}
        </Disclosure>
      )}
      {result?.reviewActions && (
        <Row gap="sm" data={{ 'data-work-review-actions': true }}>
          <Button variant="quiet" label={t.accept} onPress={result.reviewActions.disabled ? undefined : () => services.review(true)} data={{ 'data-work-accept': true }} />
          <Button variant="quiet" label={t.reject} onPress={result.reviewActions.disabled ? undefined : () => services.review(false)} data={{ 'data-work-reject': true }} />
          <Button variant="quiet" label={t.reviseSelected} onPress={result.reviewActions.disabled ? undefined : () => services.revise(result.id)} data={{ 'data-work-revise-selected': true }} />
        </Row>
      )}
      {result && (
        <Disclosure summary={t.resultDetails} data={{ 'data-work-details': true }}>
          <Row>
            <Button variant="quiet" label={t.exportAll} onPress={services.exportRecords} data={{ 'data-work-export': true }} />
          </Row>
          {result.criteria !== '' && (
            <Text variant="caption" data={{ 'data-work-result-criteria': true }}>
              {result.criteria}
            </Text>
          )}
          <Stack gap="xs" data={{ 'data-work-audit-metadata': true }}>
            {result.audit.map((line) => (
              <Text key={line} variant="caption" mono={line.includes('SHA-256')}>
                {line}
              </Text>
            ))}
          </Stack>
        </Disclosure>
      )}
    </Stack>
  );
}

/**
 * The Changes page (/improve): LoRA adapter training, tool updates and their handoff, and past attempts, each of
 * which opens its result on selection. The host runs, evaluates and records; this page shows its decisions and
 * asks for the person's.
 */
export function ImprovePage({ services }: { readonly services: ImproveServices }) {
  const view = useSyncExternalStore(services.subscribe, services.getSnapshot);
  const { history, inspection } = view;
  return (
    <Stack gap="lg" data={{ 'data-work-surface': true, 'data-route-page-content': 'improve' }}>
      <Notice tone="error" data={{ 'data-work-error': true }}>
        {view.error || null}
      </Notice>
      <Text variant="title" as="h1">
        {t.title}
      </Text>
      {view.training && <TrainingPanel training={view.training} services={services} />}
      {view.tools && <ToolUpdates tools={view.tools} services={services} />}
      {history?.visible && (
        <Section title={t.pastAttempts} data={{ 'data-work-history-section': true }}>
          <Row justify="end">
            <Button variant="quiet" label={t.export} onPress={services.exportRecords} data={{ 'data-work-export': true }} />
          </Row>
          <Stack gap="md" data={{ 'data-work-history': true }}>
            {history.records.map((attempt) => (
              <Card key={attempt.id} status={attempt.meta} data={{ 'data-change-card': true, 'data-work-attempt': attempt.id }}>
                <Row justify="between">
                  <Button
                    variant="quiet"
                    label={attempt.goal}
                    pressed={attempt.selected}
                    onPress={() => {
                      services.select(attempt.id);
                    }}
                    data={{ 'data-work-select': attempt.id }}
                  />
                  <Badge>{attempt.badge}</Badge>
                </Row>
                <Row>
                  <Button variant="quiet" label={t.revise} onPress={attempt.reviseDisabled ? undefined : () => services.revise(attempt.id)} data={{ 'data-work-revise': attempt.id }} />
                </Row>
                {attempt.error !== '' && <Text variant="subheading">{attempt.error}</Text>}
              </Card>
            ))}
          </Stack>
        </Section>
      )}
      {inspection.open && (
        <Disclosure summary={t.selectedAttempt} open onToggle={services.setInspectionOpen} data={{ 'data-change-inspection': true }}>
          {inspection.result?.comparison && (
            <Stack gap="sm" data={{ 'data-work-comparison': true }}>
              <Text variant="heading" as="h2">
                {t.earlierAttempt}
              </Text>
              <Text data={{ 'data-work-parent-feedback': true }}>{inspection.result.comparison.feedback}</Text>
              <CodeBlock data={{ 'data-work-parent-output': true }}>{inspection.result.comparison.output}</CodeBlock>
            </Stack>
          )}
          <AttemptResult result={inspection.result} status={inspection.status} services={services} />
        </Disclosure>
      )}
    </Stack>
  );
}
