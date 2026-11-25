/**
 * Markup for the Poolday choice, row and dialog-shell primitives (`styles/poolday/primitives/choices.css`).
 * Every choice is a native radio or checkbox, so keyboard, focus and roles come from the platform:
 * a single-select list is role="radiogroup", a multi-select list role="group" of checkboxes,
 * a toggle row a role="switch" button. Callers pass trusted markup for `title`, `status` and `body`;
 * plain values are escaped.
 */
import { interfaceIcon } from './interface-icons.js';
import { escapeHtml } from './attachments.js';

/** Attribute string from a record: `true` renders a bare attribute, false and nullish are omitted. */
export const attributes = (record = {}) => Object.entries(record)
  .filter(([, value]) => value !== false && value !== null && value !== undefined)
  .map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`).join('');

const iconBox = (icon, small = false) => icon
  ? `<span class="pool-icon-box${small ? ' pool-icon-box-sm' : ''}" aria-hidden="true">${interfaceIcon(icon)}</span>` : '';

/** The fix action for a disabled option: a link for a destination, a button for an action. */
const fixAction = fix => {
  if (!fix) return '';
  const label = escapeHtml(fix.label);
  return fix.href
    ? `<a class="pool-button btn-ghost pool-option-fix" href="${escapeHtml(fix.href)}"${attributes(fix.attrs)}>${label}</a>`
    : `<button class="pool-button btn-ghost pool-option-fix" type="button"${attributes(fix.attrs)}${fix.hidden ? ' hidden' : ''}>${label}</button>`;
};

/**
 * One choice row: [icon] [title over one status line] [check, or the fix when disabled].
 * A disabled option keeps its reason in the status line, always visible.
 */
export function renderOption({ id, name, value, type = 'radio', title, status = '', icon = null, checked = false,
  disabled = false, fix = null, inputAttrs = {}, rowAttrs = {}, statusAttrs = {} }) {
  const statusId = `${id}-status`;
  return `<div class="pool-option"${attributes(rowAttrs)}>${iconBox(icon)}`
    + `<input type="${type}" id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" aria-describedby="${escapeHtml(statusId)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}${attributes(inputAttrs)}>`
    + `<label class="pool-row-text" for="${escapeHtml(id)}"><span class="pool-row-title">${title}</span>`
    + `<span class="pool-row-status" id="${escapeHtml(statusId)}"${attributes(statusAttrs)}>${status}</span></label>`
    + `<span class="pool-option-mark" aria-hidden="true">${interfaceIcon('check')}</span>${fixAction(fix)}</div>`;
}

/**
 * A list of choices. `type: 'radio'` is exactly one (role="radiogroup"); `type: 'checkbox'` is several.
 * The visible label names the group.
 */
export function renderOptions({ id, label, name = id, type = 'radio', options, labelHidden = false, attrs = {} }) {
  const role = type === 'radio' ? 'radiogroup' : 'group';
  const labelId = `${id}-label`;
  return `<div class="pool-options${type === 'checkbox' ? ' pool-options-multi' : ''}" role="${role}" aria-labelledby="${escapeHtml(labelId)}"${attributes(attrs)}>`
    + `<p class="pool-options-label${labelHidden ? ' pool-visually-hidden' : ''}" id="${escapeHtml(labelId)}">${escapeHtml(label)}</p>`
    + options.map((option, index) => renderOption({ id: `${id}-${option.key ?? index}`, name, type, ...option })).join('')
    + '</div>';
}

/** A segmented control for two to four mutually exclusive modes. */
export function renderSegmented({ name, label, options, attrs = {} }) {
  return `<div class="pool-segmented" role="radiogroup" aria-label="${escapeHtml(label)}"${attributes(attrs)}>`
    + options.map(option => `<label class="pool-segment"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"`
      + `${option.checked ? ' checked' : ''}${option.disabled ? ' disabled' : ''}${attributes(option.inputAttrs)}>${escapeHtml(option.label)}</label>`).join('')
    + '</div>';
}

/** An on/off setting with immediate effect: title, one status line and a switch on the same centre line. */
export function renderToggleRow({ id, title, status = '', icon = null, switchAttrs = {}, statusAttrs = {}, rowAttrs = {} }) {
  return `<div class="pool-toggle-row"${attributes(rowAttrs)}>${iconBox(icon)}<span class="pool-row-text">`
    + `<span class="pool-row-title" id="${escapeHtml(id)}-title">${title}</span>`
    + `<span class="pool-row-status" id="${escapeHtml(id)}-status"${attributes(statusAttrs)}>${status}</span></span>`
    + `<button class="pool-switch" type="button" role="switch" aria-checked="false"${switchAttrs['aria-label'] ? '' : ` aria-labelledby="${escapeHtml(id)}-title"`} aria-describedby="${escapeHtml(id)}-status"${attributes(switchAttrs)}><span aria-hidden="true"></span></button></div>`;
}

/** An action (button) or destination (link, with a trailing chevron). */
export function renderActionRow({ href = null, title, status = null, icon = null, attrs = {} }) {
  const text = `<span class="pool-row-text"><span class="pool-row-title">${title}</span>${status === null ? '' : `<span class="pool-row-status">${status}</span>`}</span>`;
  return href
    ? `<a class="pool-action-row pool-plain" href="${escapeHtml(href)}"${attributes(attrs)}>${iconBox(icon)}${text}${iconBox('next', true)}</a>`
    : `<button class="pool-action-row" type="button"${attributes(attrs)}>${iconBox(icon)}${text}<span></span></button>`;
}

/**
 * The dialog shell: a fixed header (title and Close), a scrolling body and a pinned footer.
 * `fixed` dialogs show live data, so their height is set at first paint and never changes.
 */
export function renderDialog({ titleId, title, body, footer = '', fixed = false, wide = false, close = true,
  closeAttrs = {}, attrs = {}, headingAttrs = {} }) {
  const classes = ['pool-dialog', 'pool-surface', 'pool-small', fixed && 'pool-dialog-fixed', wide && 'pool-dialog-wide'].filter(Boolean).join(' ');
  return `<dialog class="${classes}" aria-labelledby="${escapeHtml(titleId)}"${attributes(attrs)}>`
    + `<header class="pool-dialog-header"><h2 id="${escapeHtml(titleId)}"${attributes(headingAttrs)}>${title}</h2>`
    + (close ? `<button class="pool-button btn-ghost pool-icon" type="button" aria-label="Close"${attributes(closeAttrs)}>${interfaceIcon('close')}</button>` : '')
    + `</header><div class="pool-dialog-body">${body}</div>`
    + (footer ? `<footer class="pool-dialog-footer">${footer}</footer>` : '') + '</dialog>';
}

/**
 * Update one rendered option in place: status (or reason), availability and the fix action.
 * The row keeps its node, height and focus.
 */
export function updateOption(input, { status, disabled, checked, fixHidden } = {}) {
  if (!input) return;
  const row = input.closest('.pool-option');
  if (disabled !== undefined) input.disabled = !!disabled;
  if (checked !== undefined) input.checked = !!checked;
  const line = row?.querySelector('.pool-row-status');
  if (line && status !== undefined && line.textContent !== status) line.textContent = status;
  const fix = row?.querySelector('.pool-option-fix');
  if (fix && fixHidden !== undefined) fix.hidden = !!fixHidden;
}

/** The checked value of a native radio group inside `root`, or null. */
export const checkedValue = (root, name) => root.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

/** Check the radio with `value` in a group; returns whether one matched. */
export function checkValue(root, name, value) {
  let matched = false;
  for (const input of root.querySelectorAll(`input[name="${name}"]`)) {
    input.checked = input.value === String(value);
    matched ||= input.checked;
  }
  return matched;
}
