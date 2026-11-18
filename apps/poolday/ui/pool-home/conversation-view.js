/** Conversation markup; no session state or execution authority. */
import { renderPrivacyControls } from './privacy-controls.js';
import chatPrompts from '../../config/chat-prompts.json' with { type: 'json' };
import contextPolicy from '../../config/chat-context-policy.json' with { type: 'json' };
import workProfile from '../../config/work-profile.json' with { type: 'json' };
import { renderControlHelp, renderHelpButton } from '../components/control-help.js';
import { workspaceHref } from './workspace-navigation.js';
import { renderContextIndicator } from './context-indicator.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { renderInspectorNavigation, renderInspectorRail, renderModelSetupDialog } from './network-inspector.js';
import { renderBrandLink } from './shell-view.js';
import { escapeHtml as escape } from '../components/attachments.js';
import { renderHistoryHandover } from './history-handover-view.js';
import { renderProductionContribution } from './contribution-models.js';
import { renderModelProviders } from './model-providers.js';
import { renderAdapterDetails } from './model-adapters.js';

const promptChoices = () => {
  const choices = [...chatPrompts];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
};

const renderModelControl = () => '<span data-model-control><select class="pool-input pool-glass chat-model-value" id="chat-model" data-active-model-select aria-label="Model"></select></span>';

const renderModelSelectionDetails = () => `<details class="pool-disclosure" data-model-details><summary>Model details</summary><div class="pool-stack pool-gap-xs" data-model-selection-details><p class="pool-small pool-muted" data-model-facts></p><div class="chat-model-variant pool-stack pool-gap-xs" data-model-variant-details>${renderAdapterDetails()}${renderModelProviders()}</div><p class="pool-small pool-muted" data-answer-limit hidden></p><div class="chat-execution-location" data-execution-location role="group" aria-label="Execution location"><button class="pool-button btn-ghost" type="button" data-execution-choice="auto" aria-pressed="true">Automatic</button><button class="pool-button btn-ghost" type="button" data-execution-choice="local" aria-pressed="false">This device</button><button class="pool-button btn-ghost" type="button" data-execution-choice="network" aria-pressed="false">Public network</button></div>${renderPrivacyControls()}</div></details>`;

export function renderConversationWorkspace({ inspector = true, compact = false } = {}) {
  return `<section class="reploid-chat-workspace" data-chat-workspace ${compact ? 'data-compact' : ''} aria-label="Conversation workspace">
    <aside id="chat-threads" class="chat-thread-sidebar pool-mobile-app-bar" data-thread-sidebar aria-label="Conversation controls" ${compact ? 'hidden' : ''}>
      <div class="chat-rail-toolbar pool-surface" data-chat-rail-toolbar>
      <div class="chat-rail-heading">
      <span class="chat-thread-brand" data-thread-rail-brand data-drawer-mark>${renderBrandLink({ toolbar: true, drawer: true, href: workspaceHref('threads') })}</span>
      </div>
      <footer class="chat-rail-footer"><div data-network-trigger-slot>${inspector ? renderInspectorNavigation({ workspace: true }) : ''}</div></footer>
      </div>
    </aside>
    <section class="chat-threads-dialog pool-surface" hidden data-drawer-side="left" data-threads-dialog aria-label="Threads">
      <header class="chat-network-heading"><button class="pool-button btn-ghost pool-row pool-gap-sm" type="button" data-new-thread>${interfaceIcon('newThread')}New thread</button><button class="pool-button btn-ghost pool-icon" type="button" data-close-threads aria-label="Back to chat" title="Back to chat">${interfaceIcon('close')}</button></header>
      <div class="pool-segmented" role="group" aria-label="Threads"><button class="pool-segment" type="button" data-show-active aria-pressed="true">Active</button><button class="pool-segment" type="button" data-show-archived aria-pressed="false">Archived</button></div>
      <section class="chat-thread-panel" data-thread-panel aria-label="Threads">
      <div class="chat-thread-list" data-thread-list></div>
      </section>
      <div class="chat-rail-controls" data-network-header>
        <details class="chat-conversation-actions" data-conversation-actions><summary class="pool-button" aria-label="Conversation actions" title="Conversation actions">${interfaceIcon('more')}<span class="chat-rail-label">Conversation</span></summary><div class="pool-surface">
          <button class="pool-button btn-ghost" type="button" data-conversation-download hidden>Download conversation</button>
          <fieldset data-context-controls><legend>Context prompt</legend>
            <label><input type="checkbox" data-context-enabled> Include app context</label>
            <label>Word cap <select class="pool-input" data-context-cap aria-label="Context prompt word cap">${contextPolicy.wordLimits.map(limit => `<option value="${limit}">${limit}</option>`).join('')}</select></label>
            <p class="chat-setup-hint pool-small pool-muted" data-context-count></p><p class="chat-setup-hint pool-small pool-muted" data-context-preview></p>
          </fieldset>
        </div></details>
      </div>
    </section>
    <aside class="chat-inspector-slot pool-surface" hidden data-drawer-side="right" data-chat-inspector-slot aria-label="Selected controls">${inspector ? renderInspectorRail({ mounted: true, contribution: renderProductionContribution() }) : ''}</aside>
    <section class="chat-conversation-area" data-conversation-area aria-label="Current conversation">
      <div class="chat-conversation-content">
      <div class="chat-transcript chat-message-stream" data-chat-transcript data-message-stream role="log" aria-label="Messages" aria-live="polite"></div>
      <div class="chat-starting-prompts" data-starting-prompts role="group" aria-label="Movie and show suggestions" hidden>
        ${promptChoices().map(prompt => `<button class="pool-chip chat-starting-prompt" type="button" data-starting-prompt>${escape(prompt)}</button>`).join('')}
      </div>
      <p class="chat-error pool-well" role="alert" data-chat-error hidden></p>
      ${renderHistoryHandover()}
      </div>
      <footer class="chat-composer-area" data-composer-area><form data-composer-form>
        <label class="chat-visually-hidden" for="chat-message">Message</label>
        <div class="chat-composer-feedback"><div class="chat-composer-status-line">
        <p class="pool-small pool-muted" id="chat-model-status" data-model-status role="status" hidden></p>
        <div class="chat-composer-notices">
          <button class="pool-button btn-ghost pool-caption" type="button" data-queue-send hidden>Send when ready</button>
          <button class="pool-button btn-ghost pool-caption" type="button" data-cancel-queued-send hidden>Keep as draft</button>
          <button class="pool-button btn-ghost pool-caption" type="button" data-review-shared-model hidden></button><button class="pool-button btn-ghost pool-caption" type="button" data-retry-connection aria-label="Retry connection" hidden>Retry</button></div>${renderControlHelp()}
        </div>
        <p class="pool-small pool-muted" data-acquisition-status role="status" hidden></p><progress class="pool-progress" data-acquisition-progress aria-label="Model download" hidden></progress><button class="pool-button btn-ghost pool-caption" type="button" data-download-local hidden>Download model</button><button class="pool-button btn-ghost pool-caption" type="button" data-cancel-download hidden>Cancel download</button>
        <p class="chat-attachment-help pool-small pool-muted" data-attachment-help hidden>Text files: up to ${workProfile.files.maxInputs}, ${workProfile.files.maxFileBytes / 1024} KB each, ${workProfile.files.maxInputBytes / 1024} KB total.</p>
        </div>
        <div class="chat-composer-field pool-input pool-glass pool-glass-focus pool-activity-edge pool-focus-within" data-composer-field>
          <div class="chat-attachments" data-attachments-preview hidden></div>
          <textarea class="pool-bare pool-body" id="chat-message" data-composer-input rows="1" required placeholder="Ask a question…"></textarea>
          <div class="chat-composer-toolbar">
          <label class="pool-button btn-ghost pool-icon pool-file chat-file-label pool-focus-within" title="Attach files">${interfaceIcon('attach')}<span class="chat-visually-hidden">Attach files</span><input type="file" multiple data-composer-files accept=".txt,.md,.json,.js,.ts,.html,.css" /></label>
          <button class="pool-button btn-ghost chat-search-toggle" type="button" data-search-toggle aria-pressed="false" aria-label="Search for this answer" title="Search for this answer" hidden>${interfaceIcon('search')}<span class="pool-caption" data-web-search-on hidden>Search</span></button>
          <button class="pool-button chat-composer-model btn-ghost" type="button" data-open-model aria-label="Choose model" title="Choose model" aria-haspopup="dialog"><span class="pool-small" data-model-caption>Choose model</span><span class="pool-small" data-model-digest><span data-composer-model-name></span><span class="pool-caption pool-muted" data-composer-model-source></span></span><span data-model-chevron>${interfaceIcon('chevron')}</span></button>
          ${renderContextIndicator()}
          <div class="chat-composer-submit">
            <button class="pool-button btn-primary pool-icon" type="submit" data-composer-send aria-label="Send" title="Send">${interfaceIcon('send')}</button>
            <button class="pool-button btn-primary pool-icon" type="button" data-composer-stop aria-label="Stop" title="Stop" hidden>${interfaceIcon('stop')}</button>
          </div>
        </div>
        </div>
      </form></footer>
      <dialog class="chat-model-setup pool-surface pool-small" data-rename-dialog aria-labelledby="chat-rename-title">
        <form data-rename-form><h2 class="pool-heading" id="chat-rename-title">Rename thread</h2><label>Name<input class="pool-input" data-thread-name required maxlength="256"></label>
          <div class="chat-network-actions"><button class="pool-button btn-ghost" type="button" data-rename-cancel>Cancel</button><button class="pool-button btn-primary" type="submit">Save</button></div>
        </form>
      </dialog>
      <dialog class="chat-model-setup pool-surface pool-small" data-model-picker aria-labelledby="chat-model-picker-title">
        <header class="chat-network-heading"><h2 class="pool-heading" id="chat-model-picker-title">Choose a model</h2>${renderHelpButton()}</header><div class="chat-model-picker-body"><p data-current-model-description></p>
        <p data-picker-thread-note hidden>A new model starts a new thread.</p>
        ${renderModelControl()}<div><select class="pool-input" data-next-model aria-label="Model"></select></div>
        <p data-next-model-status role="status" hidden></p>
        </div>${renderModelSelectionDetails()}
        <div class="chat-network-actions"><button class="pool-button btn-ghost" type="button" data-model-picker-close>Cancel</button><button class="pool-button btn-primary" type="button" data-change-model>Use model</button></div>
      </dialog>
    </section>
    ${inspector ? renderModelSetupDialog() : ''}
  </section>`;
}
