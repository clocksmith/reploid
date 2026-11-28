import { Button, Disclosure, Field, FilePicker, MultiChoice, Notice, Row, SingleChoice, Stack, Text, Toggle } from '@reploid/poolday-ui';
import type { ImproveServices, TrainingView } from '../../domain/improve';
import { improve as t } from '../../../../l10n/improve';

/** LoRA adapter training: samples, the adapter's name and version, consent, then a local or pooled round. */
export function TrainingPanel({ training, services }: { readonly training: TrainingView; readonly services: ImproveServices }) {
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
        {training.checkpoint && (
          <Toggle
            title={t.training.resume}
            status={t.training.checkpoint(training.checkpoint.id, training.checkpoint.step)}
            checked={training.resume}
            disabled={training.disabled}
            onChange={(on) => services.setTrainingField('resume', on)}
            controlData={{ 'data-lora-resume': true }}
          />
        )}
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
