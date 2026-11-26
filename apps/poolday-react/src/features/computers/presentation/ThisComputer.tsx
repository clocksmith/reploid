import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Button,
  Disclosure,
  Facts,
  FilePicker,
  Icon,
  List,
  ListItem,
  Notice,
  Progress,
  Row,
  Section,
  Sheet,
  SingleChoice,
  Stack,
  StatusLine,
  Text,
  Toggle,
} from '@reploid/poolday-ui';
import type { ComputersServices, ComputersView, DiagnosticView, ProductionView, ShareableModel } from '../domain/services';
import { computers as t } from '../../../l10n/computers';

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function ModelRows({ models, onChoose }: { readonly models: ReadonlyArray<ShareableModel>; readonly onChoose: (id: string) => void }) {
  return (
    <List data={{ 'data-production-model-buttons': true }}>
      {models.map((model) => (
        <ListItem
          key={model.id}
          icon="model"
          title={model.name}
          status={model.status}
          label={`${model.name}: ${model.label}`}
          disabled={model.disabled}
          onPress={() => onChoose(model.id)}
          trailing={<Icon name="next" size="sm" />}
          data={{ 'data-production-model': model.id }}
        />
      ))}
    </List>
  );
}

/** What this device produces for others: the models it can share, what it served, and its preparation. */
function Production({ view, services, onStartSharing }: { readonly view: ProductionView; readonly services: ComputersServices; readonly onStartSharing: (modelId: string | null) => void }) {
  const [modelsOpen, setModelsOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const choose = (id: string) => {
    setModelsOpen(false);
    onStartSharing(id);
  };
  return (
    <Stack gap="md" data={{ 'data-production-surface': true }}>
      <Notice tone="error" data={{ 'data-production-error': true }}>
        {error || view.error || null}
      </Notice>
      {view.local.length > 0 && (
        <Row data={{ 'data-production-local': true }}>
          {view.local.map((line) => (
            <Text key={line} as="span" variant="small">
              {line}
            </Text>
          ))}
        </Row>
      )}
      {view.work && (
        <Text variant="small" muted data={{ 'data-production-work': true }}>
          {view.work}
        </Text>
      )}
      {view.metrics.length > 0 && <Facts items={view.metrics} />}
      {view.progress && (
        <Stack gap="xs" data={{ 'data-production-preparing': true }}>
          <StatusLine muted={false}>{view.progress.message}</StatusLine>
          <Progress label={t.production.preparation} {...(view.progress.value !== null && view.progress.max !== null ? { value: view.progress.value, max: view.progress.max } : {})} />
          <Row>
            <Button
              variant="quiet"
              label={t.production.cancel}
              onPress={pending ? undefined : () => {
                setPending(true);
                setError('');
                services.device.cancelPreparation().catch((cause: unknown) => setError(messageOf(cause))).finally(() => setPending(false));
              }}
              data={{ 'data-production-cancel': true }}
            />
          </Row>
        </Stack>
      )}
      {view.settlement && (
        <Text variant="caption" muted data={{ 'data-production-settlement': true }}>
          {t.production.settlement}
        </Text>
      )}
      {view.setup && (
        <Stack gap="xs" data={{ 'data-production-setup-actions': true }}>
          <Text variant="label">{t.production.choose}</Text>
          {view.models.length > 0 ? (
            <ModelRows models={view.models} onChoose={choose} />
          ) : (
            <Text variant="small" muted data={{ 'data-production-model-empty': true }}>
              {view.emptyTitle ? `${view.empty}: ${view.emptyTitle}` : view.empty}
            </Text>
          )}
        </Stack>
      )}
      {view.changeModel && (
        <Row>
          <Button variant="quiet" label={t.production.changeModel} hasPopup="dialog" onPress={() => setModelsOpen(true)} data={{ 'data-production-model-options': true }} />
        </Row>
      )}
      <Disclosure quiet summary={t.production.contributions} status={view.history.count || undefined} statusData={{ 'data-production-history-count': true }} data={{ 'data-production-history': true }}>
        <Text variant="caption" muted>
          {t.production.contributionsHelp}
        </Text>
        <StatusLine>{view.history.status}</StatusLine>
        <Stack gap="xs" data={{ 'data-production-history-records': true }}>
          {view.history.records.map((row) => (
            <Text key={row.id} variant="small">
              {`${row.model} · ${row.at} · ${row.tokens}`}
            </Text>
          ))}
        </Stack>
      </Disclosure>
      <Sheet title={t.production.changeModel} open={modelsOpen} onClose={() => setModelsOpen(false)} closeLabel={t.close} data={{ 'data-production-model-dialog': true }}>
        <ModelRows models={view.models} onChoose={choose} />
      </Sheet>
    </Stack>
  );
}

/** The optional GPU check: a small local measurement and a baseline kept in this browser. */
function Diagnostic({ view, services }: { readonly view: Extract<DiagnosticView, { available: true }>; readonly services: ComputersServices }) {
  const [error, setError] = useState('');
  const run = (work: () => Promise<unknown>) => {
    setError('');
    work().catch((cause: unknown) => setError(messageOf(cause)));
  };
  return (
    <Disclosure quiet summary={t.diagnostic.title} data={{ 'data-computer-diagnostic': true }}>
      <Text variant="caption" muted>
        {t.diagnostic.explain}
      </Text>
      <Row>
        <Button label={t.diagnostic.run} onPress={view.busy ? undefined : () => run(() => services.preferences.measure())} data={{ 'data-gpu-check': true }} />
        {view.measuring && <Button label={t.diagnostic.stop} onPress={() => services.preferences.cancel()} data={{ 'data-gpu-stop': true }} />}
      </Row>
      <StatusLine muted={false} data={{ 'data-gpu-result': true }}>
        {error || view.error || view.result}
      </StatusLine>
      {view.hardware && (
        <Text variant="caption" muted>
          {view.hardware}
        </Text>
      )}
      <Text variant="caption" muted data={{ 'data-gpu-baseline': true }}>
        {view.baseline}
      </Text>
      <Row>
        <Button variant="quiet" label={t.diagnostic.save} onPress={view.canSave ? () => run(() => services.preferences.saveBaseline()) : undefined} data={{ 'data-gpu-save': true }} />
        {view.baselineStored && (
          <Button variant="quiet" label={t.diagnostic.clear} onPress={view.busy ? undefined : () => run(() => services.preferences.clearBaseline())} data={{ 'data-gpu-clear': true }} />
        )}
      </Row>
    </Disclosure>
  );
}

const IMPORT = '__import__';

/** Specialized model jobs: offer an approved model, or an exact imported descriptor, for peer jobs on public inputs. */
function SpecializedJobs({ services }: { readonly services: ComputersServices }) {
  const operations = services.operations;
  const state = useSyncExternalStore(operations.subscribe, operations.getState);
  const models = useRef(operations.models()).current;
  const [model, setModel] = useState<string>(models[0]?.id ?? IMPORT);
  const [file, setFile] = useState<File | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const revision = useRef(0);
  const active = state.phase !== 'idle';
  // Changing what is offered withdraws the approval given for the previous choice.
  const change = (next: () => void) => {
    revision.current += 1;
    next();
    setApproved(false);
  };
  const toggle = async () => {
    setError('');
    if (active) {
      await operations.stop().catch((cause: unknown) => setError(messageOf(cause)));
      return;
    }
    if (pending.current) return;
    pending.current = true;
    const attempt = revision.current;
    try {
      if (!approved) throw new Error(t.specialized.approvalFirst);
      if (attempt !== revision.current) return;
      await operations.start(model === IMPORT ? { file: file as File } : { modelId: model });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      pending.current = false;
    }
  };
  return (
    <Stack gap="md" data={{ 'data-operation-sharing': true }}>
      <SingleChoice
        label={t.specialized.model}
        value={model}
        disabled={active}
        onChange={(value) => change(() => setModel(value))}
        options={[
          ...models.map((item) => ({ value: item.id, title: item.label })),
          { value: IMPORT, title: t.specialized.importChoice, status: file?.name ?? '' },
        ]}
        data={{ 'data-operation-model': true }}
      />
      <Text variant="small" muted>
        {model === IMPORT ? t.specialized.importHelp : t.specialized.modelHelp}
      </Text>
      {model === IMPORT && (
        <FilePicker label={t.specialized.descriptor} accept=".json" onFiles={(files) => change(() => setFile(files[0] ?? null))} data={{ 'data-operation-settings': true }}>
          {(open) => <Button variant="quiet" icon="upload" label={t.specialized.chooseDescriptor} onPress={active ? undefined : open} />}
        </FilePicker>
      )}
      <Text variant="small" muted>
        {operations.limits()}
      </Text>
      <Toggle title={t.specialized.approve} status={t.specialized.approveStatus} checked={approved} disabled={active} onChange={setApproved} data={{ 'data-operation-approve': true }} />
      <Row>
        <Button
          variant="primary"
          label={active ? t.specialized.stop : t.specialized.share}
          pressed={active}
          onPress={state.phase === 'stopping' || (!active && !approved) ? undefined : () => void toggle()}
          describedBy="operation-reason"
          data={{ 'data-operation-toggle': true }}
        />
        <StatusLine data={{ 'data-operation-status': true }}>{error || state.status}</StatusLine>
      </Row>
      <StatusLine id="operation-reason" data={{ 'data-operation-reason': true }}>
        {!active && !approved ? t.specialized.reason : ''}
      </StatusLine>
      <Text variant="small" muted>
        {t.specialized.weights}
      </Text>
    </Stack>
  );
}

/** This computer: whether it contributes, what it recorded, its limits, the GPU check and specialized jobs. */
export function ThisComputer({ view, services, onStartSharing }: { readonly view: ComputersView; readonly services: ComputersServices; readonly onStartSharing: (modelId: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [specializedOpen, setSpecializedOpen] = useState(false);
  // Loaded on first opening and kept, so its choices survive closing it.
  const [specializedLoaded, setSpecializedLoaded] = useState(false);
  const attention = useRef(false);
  const device = view.device;
  // Preparing, an error or unconfirmed cleanup opens the section once, so the person sees it.
  useEffect(() => {
    if (view.production.attention && !attention.current) setOpen(true);
    attention.current = view.production.attention;
  }, [view.production.attention]);
  return (
    <Section title={t.device.title}>
      <List>
        <Disclosure quiet summary={t.device.contribute} open={open} onToggle={setOpen} data={{ 'data-production-device': true }}>
          <Stack gap="md" data={{ 'data-this-computer': true }}>
            <Stack gap="xs">
              <Text variant="small">{`${t.device.thisComputer} ${device.summary}`}</Text>
              <Text variant="caption" muted data={{ 'data-local-computer': true }}>
                {device.localComputer}
              </Text>
            </Stack>
            <Facts items={[[t.device.offers, device.offers], [t.device.supplied, device.supplied], [t.device.consumed, device.consumed]]} />
            <Text variant="caption" muted data={{ 'data-device-usage-scope': true }}>
              {device.usageScope}
            </Text>
            {device.usageError && (
              <Text variant="small" muted data={{ 'data-device-usage-error': true }}>
                {device.usageError}
              </Text>
            )}
            <Stack gap="sm">
              {device.sharingSummary && (
                <Text variant="small" data={{ 'data-tab-sharing-summary': true }}>
                  {device.sharingSummary}
                </Text>
              )}
              <Toggle
                title={t.device.answer}
                status={device.computeLabel}
                checked={device.computeOn}
                disabled={device.computeDisabled}
                onChange={(on) => void services.device.setCompute(on)}
                controlData={{ 'data-toggle-contribution': true }}
                data={{ 'data-compute-sharing-row': true }}
              />
              <Text variant="caption" muted>
                {t.device.answerHelp}
              </Text>
              {device.progress && (
                <Text variant="small" data={{ 'data-contribution-progress': true }}>
                  {device.progress}
                </Text>
              )}
              {device.retryStop && (
                <Row>
                  <Button label={t.device.retryStop} onPress={device.retryStopDisabled ? undefined : () => void services.device.retryStop()} data={{ 'data-retry-contribution-stop': true }} />
                </Row>
              )}
              <Toggle
                title={t.device.files}
                status={device.filesLabel}
                checked={device.filesOn}
                disabled={device.filesDisabled}
                onChange={(on) => void services.device.setFiles(on)}
                controlData={{ 'data-toggle-device-files': true }}
                data={{ 'data-device-files-row': true }}
              />
              <Text variant="caption" muted>
                {t.device.filesHelp}
              </Text>
              {device.pauseAll && (
                <Row>
                  <Button variant="quiet" label={t.device.pauseAll} onPress={() => void services.device.pauseAll()} data={{ 'data-device-pause-all': true }} />
                </Row>
              )}
              <Toggle
                title={t.device.introductions}
                status={t.device.introductionsStatus}
                checked={device.introductions}
                onChange={(on) => void services.network.setIntroductions(on)}
                data={{ 'data-toggle-introductions': true }}
              />
            </Stack>
            <Production view={view.production} services={services} onStartSharing={onStartSharing} />
            {device.limits && (
              <Text variant="caption" muted data={{ 'data-contribution-limits': true }}>
                {device.limits}
              </Text>
            )}
            <Stack gap="xs">
              {view.diagnostic.available && <Diagnostic view={view.diagnostic} services={services} />}
              {view.specialized && (
                <Disclosure quiet summary={t.specialized.title} open={specializedOpen} onToggle={(next) => {
                  setSpecializedOpen(next);
                  if (next) setSpecializedLoaded(true);
                }} data={{ 'data-specialized-jobs': true }}>
                  {specializedLoaded && <SpecializedJobs services={services} />}
                </Disclosure>
              )}
            </Stack>
          </Stack>
        </Disclosure>
      </List>
    </Section>
  );
}
