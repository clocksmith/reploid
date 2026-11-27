import { Button, Card, CodeBlock, Disclosure, FilePicker, Notice, Row, Section, SingleChoice, Stack, Text, Toggle } from '@reploid/poolday-ui';
import type { CandidateView, ImproveServices, ToolsView } from '../../domain/improve';
import { improve as t } from '../../../../l10n/improve';

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
export function ToolUpdates({ tools, services }: { readonly tools: ToolsView; readonly services: ImproveServices }) {
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
