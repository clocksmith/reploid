/** Conversation markup; no session state or execution authority. */
import { renderPrivacyControls } from './privacy-controls.js';
import chatPrompts from '../../config/chat-prompts.json' with { type: 'json' };
import workProfile from '../../config/work-profile.json' with { type: 'json' };
import { workspaceHref } from './workspace-navigation.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { renderInspectorNavigation, renderInspectorRail, renderModelSetupDialog } from './network-inspector.js';
import { renderBrandLink } from './shell-view.js';
import { escapeHtml as escape } from '../components/attachments.js';
import { renderHistoryHandover } from './history-handover-view.js';
import { renderProductionContribution } from './contribution-models.js';
import { renderModelProviders } from './model-providers.js';
import { renderAdapterDetails } from './model-adapters.js';

const renderModelControl = () => '<span data-model-control hidden><select class="pool-input pool-glass chat-model-value" id="chat-model" data-active-model-select aria-label="Model"></select></span>';

const computerRow = (choice, name) => `<button class="pool-button btn-ghost pool-choice chat-model-choice" type="button" data-execution-choice="${choice}" aria-pressed="false"><span class="pool-stack"><span${name}</span><small class="pool-muted" data-computer-state></small></span><span class="pool-choice-mark" aria-hidden="true">${interfaceIcon('check')}</span></button>`;
// Computer and model are one consistent choice: a model tap moves the computer to where that model runs, and a computer tap keeps a model that runs there.
const renderLocationControl = () => `<div class="pool-stack pool-gap-xs" data-execution-location role="group" aria-labelledby="chat-computer-label"><span class="pool-caption pool-muted" id="chat-computer-label">Computer</span>${computerRow('local', '>This device')}${computerRow('desktop', ' data-computer-desktop-name>Your desktop')}${computerRow('network', '>Contributors')}<p class="pool-caption pool-muted" id="chat-prompt-disclosure" data-prompt-disclosure></p></div>`;

const renderModelSelectionDetails = () => `<details class="pool-disclosure" data-model-details><summary>Model details</summary><div class="pool-stack pool-gap-xs" data-model-selection-details><p class="pool-small pool-muted" data-model-facts></p><p class="pool-small pool-muted" data-local-fit hidden></p><div class="chat-model-variant pool-stack pool-gap-xs" data-model-variant-details>${renderAdapterDetails()}${renderModelProviders()}</div><p class="pool-small pool-muted" data-answer-limit hidden></p></div></details>`;

export function renderConversationWorkspace({ inspector = true, compact = false } = {}) {
  return `<section class="reploid-chat-workspace" data-chat-workspace ${compact ? 'data-compact' : ''} aria-label="Conversation workspace">
    <aside id="chat-threads" class="chat-thread-sidebar pool-mobile-app-bar" data-thread-sidebar aria-label="Workspace destinations" ${compact ? 'hidden' : ''}>
      <div class="chat-rail-toolbar pool-surface" data-chat-rail-toolbar>
      <div class="chat-rail-heading">
      <span class="chat-thread-brand" data-thread-rail-brand data-drawer-mark>${renderBrandLink({ toolbar: true, drawer: true, href: workspaceHref('threads') })}</span>
      </div>
      <footer class="chat-rail-footer"><div data-network-trigger-slot>${inspector ? renderInspectorNavigation({ workspace: true }) : ''}</div></footer>
      </div>
    </aside>
    <section id="chat-threads-panel" class="chat-threads-dialog pool-surface" hidden data-drawer-side="left" data-threads-dialog aria-labelledby="chat-threads-title">
      <header class="chat-network-heading"><h2 class="pool-subheading" id="chat-threads-title" tabindex="-1">Chats</h2><button class="pool-button btn-ghost pool-icon" type="button" data-close-threads aria-label="Close">${interfaceIcon('close')}</button></header>
      <div class="pool-row"><button class="pool-button btn-ghost" type="button" data-new-thread>${interfaceIcon('plus')}<span>New chat</span></button></div>
      <div class="pool-segmented" role="group" aria-label="Chat history"><button class="pool-segment" type="button" data-show-active aria-pressed="true">Active</button><button class="pool-segment" type="button" data-show-archived aria-pressed="false">Archived</button></div>
      <section class="chat-thread-panel" data-thread-panel aria-label="Chat history">
      <p class="pool-small pool-muted" data-thread-empty>No chats yet.</p><div class="chat-thread-list" data-thread-list></div>
      </section>
    </section>
    <aside class="chat-inspector-slot pool-surface" hidden data-drawer-side="right" data-chat-inspector-slot aria-label="Inspector">${inspector ? renderInspectorRail({ mounted: true, contribution: renderProductionContribution() }) : ''}</aside>
    <section class="chat-conversation-area" data-conversation-area aria-label="Current conversation">
      <div class="chat-conversation-content">
      <div class="chat-transcript chat-message-stream" data-chat-transcript data-message-stream role="log" aria-label="Messages" aria-live="polite"></div>
      <p class="chat-error pool-well" role="alert" data-chat-error hidden></p>
      ${renderHistoryHandover()}
      </div>
      <footer class="chat-composer-area" data-composer-area><form data-composer-form>
        <label class="chat-visually-hidden" for="chat-message">Message</label>
        <div class="chat-composer-feedback">
          <div class="chat-starting-prompts" data-starting-prompts role="group" aria-label="Example question" hidden>
            <button class="pool-chip chat-starting-prompt" type="button" data-starting-prompt>${escape(chatPrompts[Math.floor(Math.random() * chatPrompts.length)])}</button>
          </div>
          <div class="pool-stack pool-gap-xs" data-route-alternatives hidden></div>
          <div class="chat-composer-status-line" data-composer-status-row hidden>
            <p class="pool-small pool-muted" id="chat-model-status" data-model-status role="status" hidden></p>
            <p class="pool-small pool-muted" data-acquisition-status role="status" hidden></p>
            <progress class="pool-progress" data-acquisition-progress aria-label="Model download" hidden></progress>
            <div class="chat-composer-notices" data-composer-notices>
              <button class="pool-button btn-primary pool-caption" type="button" data-join-host hidden>Join</button>
              <button class="pool-button btn-ghost pool-caption" type="button" data-cancel-download hidden>Cancel download</button>
              <button class="pool-button btn-ghost pool-caption" type="button" data-queue-send hidden>Send when ready</button>
              <button class="pool-button btn-ghost pool-caption" type="button" data-cancel-queued-send hidden>Cancel</button>
              <button class="pool-button btn-ghost pool-caption" type="button" data-review-shared-model hidden></button>
              <button class="pool-button btn-ghost pool-caption" type="button" data-review-network-execution hidden>Choose where this runs</button>
              <button class="pool-button btn-ghost pool-caption" type="button" data-retry-connection hidden>Retry</button>
              <button class="pool-button btn-ghost pool-caption" type="button" data-download-local hidden>Review local download</button>
            </div>
          </div>
          <p class="pool-small pool-muted" data-execution-settings-reset role="status" hidden>Reset to this device. Send a new message to use updated settings.</p>
          <p class="chat-attachment-help pool-small pool-muted" data-attachment-help hidden>TXT, Markdown, JSON, JS, TS, HTML and CSS. Up to ${workProfile.files.maxInputs}, ${workProfile.files.maxFileBytes / 1024} KB each, ${workProfile.files.maxInputBytes / 1024} KB total.</p>
        </div>
        <div class="chat-composer-field pool-input pool-glass pool-glass-focus pool-activity-edge pool-focus-within" data-composer-field>
          <div class="chat-attachments" data-attachments-preview hidden></div>
          <div class="chat-input-row">
            <textarea class="pool-bare pool-body" id="chat-message" data-composer-input rows="1" required placeholder="Message…"></textarea>
          </div>
          <div class="chat-composer-toolbar">
            <label class="pool-button btn-ghost pool-icon pool-file chat-file-label pool-focus-within">${interfaceIcon('attach')}<span class="chat-visually-hidden">Attach text files</span><input type="file" multiple data-composer-files aria-label="Attach text files" accept=".txt,.md,.json,.js,.ts,.html,.css" /></label>
            <button class="pool-button btn-ghost chat-search-toggle" type="button" data-search-toggle aria-pressed="false" aria-label="Search for this answer" hidden>${interfaceIcon('search')}<span class="pool-caption" data-web-search-on hidden>Search</span></button>
            <button class="pool-button chat-composer-model btn-ghost" type="button" data-open-model aria-describedby="chat-model-status" aria-label="Answer on" aria-haspopup="dialog"><span class="pool-small" data-model-caption>Answer on</span><span class="pool-small" data-model-digest><span class="pool-dot" data-composer-availability aria-hidden="true"></span><span data-composer-model-source></span><span data-model-separator aria-hidden="true"> · </span><span data-composer-model-name></span></span><span data-model-chevron>${interfaceIcon('chevron')}</span></button>
            <div class="chat-composer-submit">
              <button class="pool-button btn-primary pool-icon" type="submit" data-composer-send aria-describedby="chat-prompt-disclosure" aria-label="Send">${interfaceIcon('send')}</button>
              <button class="pool-button btn-primary pool-icon" type="button" data-composer-stop aria-label="Stop" hidden>${interfaceIcon('stop')}</button>
            </div>
          </div>
        </div>
      </form></footer>
      ${renderPrivacyControls()}
      <dialog class="chat-model-setup pool-surface pool-small" data-rename-dialog aria-labelledby="chat-rename-title">
        <form data-rename-form><h2 class="pool-subheading" id="chat-rename-title">Rename thread</h2><label>Name<input class="pool-input" data-thread-name required maxlength="256"></label>
          <div class="chat-network-actions"><button class="pool-button btn-primary" type="submit">Save</button><button class="pool-button btn-ghost" type="button" data-rename-cancel>Cancel</button></div>
        </form>
      </dialog>
      <dialog class="chat-model-setup pool-surface pool-small" data-model-picker aria-labelledby="chat-model-picker-title">
        <header class="chat-network-heading"><h2 class="pool-subheading" id="chat-model-picker-title" data-picker-title>Answer on</h2><button class="pool-button btn-ghost pool-icon" type="button" data-model-picker-close aria-label="Close">${interfaceIcon('close')}</button></header>
        <div class="chat-model-picker-body">
        ${renderLocationControl()}
        <p data-picker-thread-note hidden>A new model starts a new thread.</p>
        <span class="pool-caption pool-muted">Model</span>${renderModelControl()}<div><select class="pool-input" data-next-model aria-label="Model"></select></div>
        <div class="chat-answer-issue pool-stack pool-gap-xs" data-answer-issue hidden><p class="pool-small" data-next-model-status role="status"></p><button class="pool-button btn-ghost pool-caption" type="button" data-answer-action hidden></button></div>
        ${renderModelSelectionDetails()}</div>
        <div class="chat-network-actions"><button class="pool-button btn-primary" type="button" data-change-model>Answer on this device</button><button class="pool-button btn-ghost" type="button" data-open-privacy aria-haspopup="dialog" aria-controls="chat-privacy-dialog">Who can read it</button></div>
      </dialog>
    </section>
    ${inspector ? renderModelSetupDialog() : ''}
  </section>`;
}
