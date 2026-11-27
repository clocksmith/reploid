import { Badge, Button, CodeBlock, Disclosure, Facts, Field, List, ListItem, MultiChoice, Notice, Row, SingleChoice, Stack, Stats, StatusLine, Surface, Text, TextArea, Toggle } from '@reploid/poolday-ui';
import type { ReactNode } from 'react';
import type { FormItem, LifecycleForm, RecordEntry, RoomServices, RoomSnapshot } from '../domain/rooms';
import { rooms as t } from '../../../l10n/rooms';

type Props = { readonly view: RoomSnapshot; readonly services: RoomServices };

/** A workspace panel: its kicker and heading over its body, as the vanilla research panels were laid out. */
function Panel({ kicker, title, anchor, count, children, data }: { readonly kicker: string; readonly title: string; readonly anchor?: string; readonly count?: number; readonly children: ReactNode; readonly data?: Record<`data-${string}`, string | boolean> }) {
  return (
    <Surface as="section" data={data}>
      <Stack gap="sm">
        <Row justify="between">
          <Stack gap="xs">
            <Text variant="label" muted>
              {kicker}
            </Text>
            <Text variant="subheading" as="h3" {...(anchor ? { id: anchor } : {})}>
              {title}
            </Text>
          </Stack>
          {count !== undefined && <Badge>{t.count(count)}</Badge>}
        </Row>
        {children}
      </Stack>
    </Surface>
  );
}

const Caption = ({ children }: { readonly children: ReactNode }) => (
  <Text variant="caption" muted>
    {children}
  </Text>
);

/** One signed record: its label, author and review state, what it states, and its consent-aware technical evidence. */
function RecordCard({ record }: { readonly record: RecordEntry }) {
  return (
    <Stack gap="xs" data={{ 'data-research-record': record.hash, 'data-research-kind': record.kind, 'data-research-invalidated': record.invalidated }}>
      <Text variant="label" muted>
        {record.kind}
      </Text>
      <Text as="strong">{record.label}</Text>
      <Text variant="small" muted>
        {record.meta}
      </Text>
      {record.sequence && ('value' in record.sequence ? <CodeBlock data={{ 'data-research-sequence': true }}>{record.sequence.value}</CodeBlock> : (
        <Text variant="caption" muted data={{ 'data-research-sequence-withheld': true }}>
          {record.sequence.withheld}
        </Text>
      ))}
      {record.lines.map((line) => (
        <Text key={line} variant="small">
          {line}
        </Text>
      ))}
      {record.links.length > 0 && (
        <Row gap="sm">
          {record.links.map((link) => (
            <Button key={link.url} variant="quiet" label={link.label} href={link.url} external />
          ))}
        </Row>
      )}
      {record.summary && (
        <>
          <Text variant="small">{record.summary.text}</Text>
          <Caption>{record.summary.detail}</Caption>
        </>
      )}
      <Disclosure summary={t.technical} quiet>
        <Facts items={record.technical} />
        {record.technicalNote !== '' && <Caption>{record.technicalNote}</Caption>}
      </Disclosure>
    </Stack>
  );
}

const fieldData = (name: string, hook?: string) => ({ 'data-research-field': name, ...(hook ? { [`${hook}`]: true } : {}) }) as Record<`data-${string}`, string | boolean>;

/** One lifecycle form control, chosen by the decision it asks for: one of a set, several, on/off, or text. */
function FormControl({ action, item, services }: { readonly action: string; readonly item: FormItem; readonly services: RoomServices }) {
  if (item.k === 'note') return <Caption>{item.text}</Caption>;
  if (item.k === 'group') {
    return (
      <Stack gap="sm" data={item.hook ? { [`${item.hook}`]: true } as Record<`data-${string}`, boolean> : { 'data-research-group': item.legend }}>
        {item.legend !== '' && (
          <Text variant="label" muted>
            {item.legend}
          </Text>
        )}
        {item.items.map((child, index) => (
          <FormControl key={'name' in child ? child.name : `${child.k}:${index}`} action={action} item={child} services={services} />
        ))}
      </Stack>
    );
  }
  const set = (value: string | boolean | ReadonlyArray<string>) => services.setLifecycleValue(action, item.name, value);
  const data = fieldData(item.name, item.hook);
  if (item.k === 'select') {
    return <SingleChoice label={item.label} value={item.value === '' ? null : item.value} options={item.options} disabled={item.disabled} onChange={(value) => set(value)} data={data} />;
  }
  if (item.k === 'multi') return <MultiChoice label={item.label} values={item.value} options={item.options} onChange={(values) => set(values)} data={data} />;
  if (item.k === 'check') return <Toggle title={item.label} checked={item.value} disabled={item.disabled} onChange={(checked) => set(checked)} controlData={data} />;
  if (item.k === 'textarea') {
    return <TextArea label={item.label} rows={item.rows} value={item.value} required={item.required} disabled={item.disabled} placeholder={item.placeholder ?? ''} onChange={set} data={data} />;
  }
  return (
    <Field
      type={item.k}
      label={item.label}
      value={item.value}
      required={item.required}
      disabled={item.disabled}
      readOnly={item.readOnly === true}
      placeholder={item.placeholder ?? ''}
      {...(item.min !== undefined ? { min: item.min } : {})}
      {...(item.max !== undefined ? { max: item.max } : {})}
      onChange={set}
      data={data}
    />
  );
}

/** A lifecycle form: its fields, the signing button (unavailable until its records exist) and what went wrong. */
function LifecycleFormView({ form, services }: { readonly form: LifecycleForm; readonly services: RoomServices }) {
  const body = (
    <Stack gap="sm" data={{ 'data-research-lifecycle-form': true, 'data-research-action': form.action }}>
      {form.items.map((item, index) => (
        <FormControl key={'name' in item ? item.name : `${item.k}:${index}`} action={form.action} item={item} services={services} />
      ))}
      <Row>
        <Button
          variant={form.quiet ? 'quiet' : 'primary'}
          label={form.submit}
          disabled={!form.ready}
          pending={form.pending}
          pendingLabel={t.signingLifecycle}
          onPress={() => void services.submitLifecycle(form.action)}
          data={{ 'data-research-lifecycle-submit': form.action }}
        />
      </Row>
      {form.error !== '' && (
        <Notice tone="error" data={{ 'data-research-lifecycle-status': form.action }}>
          {form.error}
        </Notice>
      )}
    </Stack>
  );
  return form.summary ? (
    <Disclosure summary={form.summary} quiet data={{ 'data-research-lifecycle-disclosure': form.action }}>
      {body}
    </Disclosure>
  ) : (
    body
  );
}

/** The review form: the evidence to review with its question context, the signed decision and its reason. */
function ReviewPanel({ view, services }: Props) {
  const review = view.workspace.review;
  return (
    <Panel kicker={t.reviewKicker} title={t.reviewTitle} anchor="pool-room-review" data={{ 'data-pool-room-panel-target': 'review', 'data-pool-room-review': true }}>
      <Stack gap="sm" data={{ 'data-research-review-form': true }}>
        {review.targets.length ? (
          <SingleChoice label={t.reviewTarget} value={review.target || null} options={review.targets} onChange={(value) => services.setReview('target', value)} data={{ 'data-research-field': 'targetHash' }} />
        ) : (
          <Caption>{t.noReviewTarget}</Caption>
        )}
        {review.context && (
          <Stack gap="xs" data={{ 'data-research-review-context': review.context.hash }}>
            <Text as="strong">{review.context.title}</Text>
            <Text variant="small" muted>
              {review.context.meta}
            </Text>
            <Facts items={review.context.facts} />
            <Caption>{review.context.note}</Caption>
          </Stack>
        )}
        {review.requiresContext && (
          <SingleChoice
            label={t.contextRelevance}
            value={review.contextDetermination || null}
            options={review.determinations}
            onChange={(value) => services.setReview('contextDetermination', value)}
            data={{ 'data-research-field': 'contextDetermination', 'data-research-context-assessment-fields': true }}
          />
        )}
        <TextArea label={t.reason} rows={4} required value={review.text} placeholder={t.reasonPlaceholder} onChange={(value) => services.setReview('text', value)} data={{ 'data-research-field': 'text' }} />
        <Field type="number" label={t.confidence} required min={0} max={1} value={review.confidence} onChange={(value) => services.setReview('confidence', value)} data={{ 'data-research-field': 'confidence' }} />
        <Field type="url" label={t.evidenceUrl} value={review.evidenceUrl} placeholder="https://" onChange={(value) => services.setReview('evidenceUrl', value)} data={{ 'data-research-field': 'evidenceUrl' }} />
        <Row gap="sm">
          {review.actions.map((action, index) => (
            <Button
              key={action.value}
              variant={index === 0 ? 'primary' : 'quiet'}
              label={action.title}
              disabled={!review.target}
              pending={action.pending}
              pendingLabel={action.pendingLabel}
              onPress={() => void services.submitReview(action.value)}
              data={{ 'data-research-review-action': action.value }}
            />
          ))}
        </Row>
        <Caption>{t.reviewNote}</Caption>
        <StatusLine data={{ 'data-research-review-status': true }}>{review.status}</StatusLine>
      </Stack>
    </Panel>
  );
}

/** The governed next work: admitted candidate actions with their exact contracts, and the projected follow-up tasks. */
function NextWorkPanel({ view, services }: Props) {
  const next = view.workspace.nextWork;
  return (
    <Panel kicker={t.nextKicker} title={t.nextTitle} data={{ 'data-research-next-work': true }}>
      <Stack gap="md" data={{ 'data-research-candidate-actions': true }}>
        {next.candidates.length ? (
          next.candidates.map((candidate) => (
            <Stack key={candidate.hash} gap="xs" data={{ 'data-research-candidate-action': candidate.hash }}>
              <Text as="strong">{candidate.title}</Text>
              <Text variant="small">{candidate.rationale}</Text>
              <Caption>{candidate.meta}</Caption>
              {candidate.approved ? (
                <Badge data={{ 'data-research-candidate-approved': true }}>{t.independentlyApproved}</Badge>
              ) : (
                <Row>
                  <Button
                    label={t.approveContract}
                    pending={candidate.pending}
                    pendingLabel={t.signing}
                    onPress={() => void services.approveCandidate(candidate.hash, candidate.contractHash)}
                    data={{ 'data-research-approve-candidate': candidate.hash, 'data-research-candidate-contract': candidate.contractHash }}
                  />
                </Row>
              )}
              {candidate.error !== '' && <Notice tone="error">{candidate.error}</Notice>}
              <Disclosure summary={t.rawEvidence} quiet>
                <Facts items={candidate.facts} />
                <Text variant="small">{t.predicted(candidate.predicted)}</Text>
                <Text variant="small">{t.falsified(candidate.falsifiers)}</Text>
                <Caption>{t.assumptions(candidate.assumptions)}</Caption>
              </Disclosure>
            </Stack>
          ))
        ) : (
          <Caption>{t.noCandidates}</Caption>
        )}
      </Stack>
      {next.rejected.length > 0 && (
        <Disclosure summary={t.rejectedActions(next.rejected.length)} quiet data={{ 'data-research-rejected-candidate-actions': true }}>
          <List>
            {next.rejected.map((entry) => (
              <ListItem key={entry.meta} title={entry.title} status={`${entry.detail} ${entry.meta}`} trailing={<Badge>{t.rejected}</Badge>} />
            ))}
          </List>
        </Disclosure>
      )}
      <Disclosure summary={t.projection} quiet>
        <Facts items={next.policy} />
        <Caption>{t.projectionNote}</Caption>
      </Disclosure>
      <Text variant="label" as="h3" muted>
        {t.suggestions}
      </Text>
      <Stack gap="sm" data={{ 'data-research-tasks': true }}>
        {next.tasks.length ? (
          next.tasks.map((task) => (
            <Stack key={`${task.id}:${task.targetHash}`} gap="xs" data={{ 'data-research-task': task.id }}>
              <Text as="strong">{task.title}</Text>
              <Text variant="small">{task.reason}</Text>
              <Caption>{task.meta}</Caption>
              {task.approved ? (
                <Badge data={{ 'data-research-task-approved': true }}>{t.approved}</Badge>
              ) : (
                <Row>
                  <Button
                    label={t.approve}
                    pending={task.pending}
                    pendingLabel={t.signing}
                    onPress={() => void services.approveTask(task.id, task.targetHash)}
                    data={{ 'data-research-approve-task': task.id, 'data-research-task-target': task.targetHash }}
                  />
                </Row>
              )}
              {task.error !== '' && <Notice tone="error">{task.error}</Notice>}
            </Stack>
          ))
        ) : (
          <Caption>{t.noTasks}</Caption>
        )}
      </Stack>
      <Caption>{t.taskPolicy(next.taskPolicy)}</Caption>
    </Panel>
  );
}

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
