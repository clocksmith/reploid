#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

import { createChangeControlEffectRegistry } from '../server/change-control/effects.js';
import { createChangeControlService } from '../server/change-control/service.js';
import { createMemoryChangeControlStore } from '../server/change-control/store.js';
import {
  buildVisualChangePassportPolicy,
  createVisualChangePassportWorkflow
} from '../server/change-control/visual-workflow.js';
import { verifyChangePassportExport } from '../self/shared/change-passport/contract.js';
import {
  buildVisualChangeAcceptanceReceipt,
  buildVisualChangeCandidate,
  buildVisualChangeEvaluationReceipt,
  buildVisualChangeRenderReceipt,
  buildVisualChangeReverseReceipt,
  hashVisualSourceState
} from '../self/shared/change-passport/visual-change.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

const argumentValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const actor = (authorityId, roles) => ({
  subject: authorityId,
  authorityId,
  organizationId: 'org:reploid-dogfood',
  roles,
  authenticationKind: 'local_dogfood_identity'
});

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const close = (server) => new Promise((resolve) => server.close(resolve));

const renderOracle = async (page, url, screenshotPath) => {
  await page.goto(url, { waitUntil: 'networkidle' });
  const measurements = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    stateCardCount: document.querySelectorAll('[data-axis]').length,
    labels: [...document.querySelectorAll('[data-axis]')].map((element) => element.textContent.trim())
  }));
  const screenshot = await page.screenshot({ path: screenshotPath, fullPage: true });
  const markup = await page.content();
  return {
    measurements,
    screenshotHash: sha256(screenshot),
    markupHash: sha256(markup),
    passed: measurements.documentWidth <= measurements.viewportWidth
      && measurements.stateCardCount === 3
      && ['Evidence', 'Decision', 'Effect'].every((label) => measurements.labels.some((value) => value.includes(label)))
  };
};

export async function runVisualChangePassportDogfood({
  bridgeRoot,
  outputPath,
  policyOptions = {}
} = {}) {
  const selectedBridgeRoot = path.resolve(
    bridgeRoot || path.join(repositoryRoot, '..', 'ouroboros', 'deco', 'packages', 'visual-feedback-bridge')
  );
  const workspacePatchModule = path.join(selectedBridgeRoot, 'dist', 'node', 'workspace-patch.js');
  const protocolModule = path.join(selectedBridgeRoot, 'dist', 'shared', 'protocol.js');
  await Promise.all([workspacePatchModule, protocolModule].map(async (modulePath) => {
    try {
      await fs.access(modulePath);
    } catch {
      throw new Error(`Visual Feedback Bridge build is missing ${modulePath}; run npm run build in ${selectedBridgeRoot}`);
    }
  }));
  const {
    applyReverseWorkspacePatch,
    captureWorkspaceSnapshot,
    createWorkspacePatchManifest,
    writeWorkspacePatch
  } = await import(pathToFileURL(workspacePatchModule));
  const { createEnvelope } = await import(pathToFileURL(protocolModule));

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-visual-change-passport-'));
  const applicationRoot = path.join(temporaryRoot, 'application');
  const patchRoot = path.join(temporaryRoot, 'bridge-patches');
  const sourcePath = path.join(applicationRoot, 'surface.html');
  let browser = null;
  let server = null;
  try {
    await fs.mkdir(applicationRoot, { recursive: true });
    const baselineSource = `<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reploid Change Passport dogfood surface</title>
  <style>
    body { margin: 0; font: 16px system-ui; background: #f5f2eb; color: #1e2423; }
    main { padding: 20px; }
    .passport-state-grid { display: grid; grid-template-columns: repeat(3, minmax(18rem, 1fr)); gap: 12px; }
    [data-axis] { padding: 18px; border: 1px solid #52615d; border-radius: 10px; background: white; }
  </style>
  <main>
    <h1>Change Passport</h1>
    <section class="passport-state-grid" data-testid="passport-state-grid" data-deco-source-file="surface.html" data-deco-source-line="9" data-deco-source-name="ChangePassportStateGrid" data-deco-source-framework="vanilla">
      <article data-axis="Evidence">Evidence <strong>frozen</strong></article>
      <article data-axis="Decision">Decision <strong>approved</strong></article>
      <article data-axis="Effect">Effect <strong>not applied</strong></article>
    </section>
  </main>
</html>
`;
    await fs.writeFile(sourcePath, baselineSource);
    const before = captureWorkspaceSnapshot(applicationRoot);
    const identity = {
      projectId: 'reploid-dogfood',
      worktreeId: 'visual-change-passport-v0',
      sessionId: 'codex-local-dogfood',
      browserClientId: 'browser-local-operator'
    };
    const changeId = 'change_visual_passport_dogfood';
    const capturedAt = new Date().toISOString();
    const annotation = {
      id: 'annotation_narrow_lifecycle_grid',
      browserClientId: identity.browserClientId,
      routeKey: '/passports',
      selectionType: 'element',
      elementAnchors: [{
        routeKey: '/passports',
        component: {
          framework: 'vanilla',
          displayName: 'ChangePassportStateGrid',
          sourceFile: 'surface.html',
          sourceLine: 9
        },
        locators: {
          testId: 'passport-state-grid',
          ancestryFingerprint: ['html', 'body', 'main', 'section']
        },
        geometry: {
          documentRect: { x: 20, y: 74, width: 900, height: 94 },
          viewportRect: { x: 20, y: 74, width: 900, height: 94 },
          normalizedCenter: { x: 0.5, y: 0.15 }
        }
      }],
      elementContext: [{
        tagName: 'section',
        text: 'Evidence frozen Decision approved Effect not applied',
        role: 'region',
        classes: ['passport-state-grid'],
        attributes: { 'data-testid': 'passport-state-grid' },
        computedStyle: { display: 'grid', gap: '12px' }
      }],
      comment: 'The lifecycle cards overflow a narrow viewport. Keep all three states readable without horizontal scrolling.',
      priority: 'high',
      draftState: 'submitted',
      restorationState: 'restored_exact',
      version: 1,
      createdAt: capturedAt,
      updatedAt: capturedAt
    };
    const packet = {
      changeId,
      ...identity,
      routeKey: '/passports',
      page: {
        url: 'http://127.0.0.1/passports',
        viewport: { width: 390, height: 844 },
        scroll: { x: 0, y: 0 },
        capturedAt
      },
      annotations: [annotation],
      comments: [{
        commentId: 'comment_narrow_lifecycle_grid',
        annotationId: annotation.id,
        text: annotation.comment,
        priority: annotation.priority
      }],
      threadId: 'thread_visual_passport_dogfood'
    };
    const requested = createEnvelope('change.requested', packet, identity, 1, {
      eventId: 'evt_visual_passport_requested',
      correlationId: 'correlation_visual_passport_dogfood'
    });

    const candidateSource = baselineSource.replace(
      'grid-template-columns: repeat(3, minmax(18rem, 1fr));',
      'grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));'
    );
    await fs.writeFile(sourcePath, candidateSource);
    const after = captureWorkspaceSnapshot(applicationRoot);
    const manifest = createWorkspacePatchManifest(changeId, before, after);
    const writtenPatch = writeWorkspacePatch(patchRoot, manifest);
    const completed = createEnvelope('agent.completed', {
      changeId,
      summary: 'Made the lifecycle grid responsive at narrow viewport widths.',
      changedFiles: manifest.entries.map((entry) => entry.path),
      commentResults: [{ commentId: 'comment_narrow_lifecycle_grid', disposition: 'addressed' }],
      validation: [{ name: 'source ownership and reversible patch capture', status: 'passed' }],
      patchPath: writtenPatch.path,
      patchHash: writtenPatch.hash
    }, identity, 2, {
      causationId: requested.eventId,
      correlationId: requested.correlationId
    });
    const candidate = await buildVisualChangeCandidate({
      requestEnvelope: requested,
      completionEnvelope: completed,
      patchManifest: manifest,
      patchArtifactHash: writtenPatch.hash
    });

    server = http.createServer(async (request, response) => {
      if (request.url !== '/' && request.url !== '/passports') {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(await fs.readFile(sourcePath));
    });
    await listen(server);
    const applicationUrl = `http://127.0.0.1:${server.address().port}/passports`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const evaluationRender = await renderOracle(
      page,
      applicationUrl,
      path.join(temporaryRoot, 'independent-evaluation.png')
    );
    if (!evaluationRender.passed) throw new Error('independent render oracle rejected the source patch');

    const frozenEvaluator = {
      evaluatorId: 'evaluator:chromium-narrow-viewport',
      authorityId: 'authority:independent-render-oracle',
      version: '1.0.0',
      evaluatorHash: sha256('reploid-visual-change-evaluator/v1'),
      suiteHash: sha256('narrow-viewport-no-overflow + lifecycle-card-closure'),
      contractHash: sha256('visual-change-passport-dogfood-contract/v1'),
      frozenBeforeCandidate: true
    };
    const evaluationReceipt = await buildVisualChangeEvaluationReceipt({
      candidate,
      evaluator: frozenEvaluator,
      checks: [{
        name: 'bridge-owned-file-closure',
        status: manifest.entries.length === 1 && manifest.unpatchableChanges.length === 0 ? 'passed' : 'failed',
        artifactHash: candidate.patch.manifestHash,
        runner: '@deco/visual-feedback-bridge workspace-patch/v1'
      }],
      renderOracle: {
        engine: 'chromium-playwright',
        routeKey: '/passports',
        artifactHash: evaluationRender.screenshotHash,
        assertions: [{
          name: 'narrow-viewport-lifecycle-grid',
          status: evaluationRender.passed ? 'passed' : 'failed',
          artifactHash: sha256(JSON.stringify(evaluationRender.measurements)),
          runner: 'playwright physical Chromium'
        }]
      },
      observedAt: new Date().toISOString()
    });

    const activationPath = path.join(temporaryRoot, 'ci-activation.json');
    const activationAdapter = async ({ projection, request }) => {
      const activation = {
        schema: 'reploid.visual-ci-activation/v1',
        passportId: projection.passportId,
        candidateHash: request.candidateHash,
        decisionEventHash: request.decisionEventHash,
        effectId: request.effectId,
        activatedAt: new Date().toISOString()
      };
      await fs.writeFile(activationPath, `${JSON.stringify(activation, null, 2)}\n`);
      return {
        externalReference: `file://${activationPath}`,
        providerResult: { activationHash: sha256(JSON.stringify(activation)) }
      };
    };
    const service = createChangeControlService({
      store: createMemoryChangeControlStore(),
      effectRegistry: createChangeControlEffectRegistry({ effects: { ci_activation: activationAdapter } })
    });
    const workflow = createVisualChangePassportWorkflow({ service });
    const policy = await buildVisualChangePassportPolicy({
      policyId: 'policy:reploid-visual-dogfood',
      targetId: 'reploid:dogfood-passports-ui',
      reviewerRole: 'visual_reviewer',
      rollbackAuthorityId: 'authority:visual-rollback',
      sourceSensorAuthorityId: 'authority:bridge-source-observer',
      ...policyOptions
    });
    const proposer = actor('authority:codex-patch-agent', ['proposer', 'evidence_producer']);
    const changeAuthority = actor('authority:reploid-change-control', ['change_authority']);
    const evaluatorActor = actor(frozenEvaluator.authorityId, ['evaluator']);
    const humanReviewer = actor('authority:local-human-reviewer', ['visual_reviewer']);
    const activator = actor('authority:local-ci', ['activator']);
    const sourceObserver = actor('authority:bridge-source-observer', ['observer']);
    const createdAt = new Date().toISOString();
    await workflow.open({
      candidate,
      passportId: 'passport:visual-dogfood:1',
      organizationId: 'org:reploid-dogfood',
      title: 'Repair the narrow Change Passport lifecycle grid',
      summary: 'Govern the exact Bridge-owned patch from complaint through reversal and reopening.',
      repository: {
        provider: 'github',
        owner: 'clocksmith',
        name: 'reploid',
        repositoryId: 'github:clocksmith/reploid',
        installationId: null,
        defaultBranch: 'main',
        visibility: 'private'
      },
      baseRevision: 'dogfood-baseline',
      candidateRevision: `bridge-${candidate.candidateHash.slice(-16)}`,
      target: { kind: 'source_patch', targetId: 'reploid:dogfood-passports-ui', environment: 'local-ci' },
      policy,
      evaluator: frozenEvaluator,
      createdAt,
      evidenceCutoff: createdAt
    }, { proposer, evidenceProducer: proposer, changeAuthority });
    await workflow.recordIndependentEvaluation({
      passportId: 'passport:visual-dogfood:1',
      candidate,
      receipt: evaluationReceipt
    }, evaluatorActor);

    const acceptedEnvelope = createEnvelope('review.accepted', { changeId }, identity, 3, {
      correlationId: requested.correlationId
    });
    const acceptanceReceipt = await buildVisualChangeAcceptanceReceipt({
      candidate,
      acceptedEnvelope
    });
    await workflow.accept({
      passportId: 'passport:visual-dogfood:1',
      candidate,
      receipt: acceptanceReceipt,
      rationale: 'The exact responsive patch passed the frozen independent browser oracle.'
    }, { reviewer: humanReviewer, reviewerRole: 'visual_reviewer', changeAuthority });

    const activated = await workflow.activate({
      passportId: 'passport:visual-dogfood:1',
      candidate
    }, activator);
    const effect = activated.projection.effect.current;
    const activatedRecord = JSON.parse(await fs.readFile(activationPath, 'utf8'));
    if (activatedRecord.candidateHash !== candidate.candidateHash) {
      throw new Error('local CI activation did not bind the visual candidate');
    }

    const rendered = await renderOracle(
      page,
      applicationUrl,
      path.join(temporaryRoot, 'activated-render.png')
    );
    const renderedEnvelope = createEnvelope('page.rendered', {
      changeId,
      routeKey: '/passports',
      mode: 'reload'
    }, identity, 4, { correlationId: requested.correlationId });
    const renderReceipt = await buildVisualChangeRenderReceipt({
      candidate,
      renderEnvelope: renderedEnvelope,
      effectId: effect.effectId,
      activationReference: effect.externalReference,
      oracle: {
        engine: 'chromium-playwright',
        artifactHash: rendered.screenshotHash,
        assertions: [{
          name: 'activated-render-preserves-fix',
          status: rendered.passed ? 'passed' : 'failed',
          artifactHash: sha256(JSON.stringify(rendered.measurements)),
          runner: 'playwright physical Chromium'
        }]
      },
      observedAt: new Date().toISOString()
    });
    await workflow.recordRenderedVerification({
      passportId: 'passport:visual-dogfood:1',
      candidate,
      receipt: renderReceipt
    }, sourceObserver);

    const reverse = applyReverseWorkspacePatch(applicationRoot, writtenPatch.path);
    if (!reverse.ok) throw new Error(`Bridge reverse patch conflicted: ${JSON.stringify(reverse.conflicts)}`);
    const reversedSnapshot = captureWorkspaceSnapshot(applicationRoot);
    const currentSourceHash = await hashVisualSourceState(candidate.patch.entries.map((entry) => ({
      path: entry.path,
      hash: reversedSnapshot.files.get(entry.path)?.hash || null
    })));
    const revertedEnvelope = createEnvelope('change.reverted', {
      changeId,
      revertedFiles: reverse.revertedFiles
    }, identity, 5, { correlationId: requested.correlationId });
    const reverseReceipt = await buildVisualChangeReverseReceipt({
      candidate,
      revertedEnvelope,
      currentSourceHash,
      observedAt: new Date().toISOString()
    });
    const finished = await workflow.recordReverseAndReopen({
      passportId: 'passport:visual-dogfood:1',
      candidate,
      receipt: reverseReceipt
    }, sourceObserver);
    const exported = await service.exportPassport('passport:visual-dogfood:1', changeAuthority);
    const verification = await verifyChangePassportExport(exported);
    if (!verification.valid) throw new Error(`Change Passport export failed verification: ${verification.reasons.join('; ')}`);
    if (await fs.readFile(sourcePath, 'utf8') !== baselineSource) throw new Error('Bridge reverse patch did not restore exact source bytes');
    if (finished.reopening.projection.decision.state !== 'reopened') throw new Error('source reversal did not reopen the active decision');
    if (finished.reopening.projection.effect.state !== 'applied') {
      throw new Error('automatic reopening incorrectly asserted an external effect rollback');
    }

    if (outputPath) {
      const resolvedOutput = path.resolve(outputPath);
      await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
      await fs.writeFile(resolvedOutput, `${JSON.stringify(exported, null, 2)}\n`);
    }
    return {
      ok: true,
      passportId: exported.passportId,
      candidateHash: candidate.candidateHash,
      patchArtifactHash: candidate.patch.artifactHash,
      policyVersion: policy.version,
      policyHash: policy.policyHash,
      eventCount: verification.integrity.eventCount,
      headHash: verification.integrity.headHash,
      exportHash: verification.exportHash,
      decisionState: finished.reopening.projection.decision.state,
      effectState: finished.reopening.projection.effect.state,
      sourceRestoredExactly: true,
      independentBrowser: 'physical Chromium via Playwright',
      bridgeRoot: selectedBridgeRoot,
      outputPath: outputPath ? path.resolve(outputPath) : null,
      stages: [
        'visual_complaint',
        'source_owned_patch',
        'independent_evaluation',
        'human_acceptance_recorded',
        'ci_activation',
        'rendered_verification',
        'reverse_patch',
        'automatic_reopening'
      ]
    };
  } finally {
    if (browser) await browser.close();
    if (server) await close(server);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await runVisualChangePassportDogfood({
      bridgeRoot: argumentValue('--bridge-root'),
      outputPath: argumentValue('--output')
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
