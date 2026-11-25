import { afterEach, expect, it } from 'vitest';
import {
  checkedValue, checkValue, renderActionRow, renderDialog, renderOptions, renderSegmented, renderToggleRow, updateOption
} from '../../apps/poolday/ui/components/choices.js';
import { bindDialog } from '../../apps/poolday/ui/components/dialog.js';

const mount = markup => { const root = document.createElement('div'); root.className = 'pool-home'; root.innerHTML = markup; document.body.append(root); return root; };
afterEach(() => { document.body.innerHTML = ''; });

it('renders a single-select list as a named radio group with one row shape and a visible reason', () => {
  const root = mount(renderOptions({ id: 'where', label: 'Computer', options: [
    { value: 'local', title: 'This device', status: 'Ready', icon: 'device', checked: true },
    { value: 'network', title: 'Contributors', status: 'Only your devices can read this chat.', disabled: true,
      fix: { label: 'Change', attrs: { 'data-fix': true } } }
  ] }));
  const group = root.querySelector('[role=radiogroup]');
  expect(document.getElementById(group.getAttribute('aria-labelledby')).textContent).toBe('Computer');
  const inputs = [...group.querySelectorAll('input[type=radio]')];
  expect(inputs.map(input => input.name)).toEqual(['where', 'where']);
  // Each input is named by its title and described by its one status line.
  expect(inputs.map(input => root.querySelector(`label[for="${input.id}"] .pool-row-title`).textContent)).toEqual(['This device', 'Contributors']);
  expect(document.getElementById(inputs[1].getAttribute('aria-describedby')).textContent).toBe('Only your devices can read this chat.');
  expect(inputs[1].disabled).toBe(true);
  // The disabled option's fix sits in the trailing slot of its own row; the enabled option keeps its mark.
  const rows = [...group.querySelectorAll('.pool-option')];
  expect(rows[1].querySelector('.pool-option-fix[data-fix]').textContent).toBe('Change');
  expect(rows[0].querySelector('.pool-option-fix')).toBeNull();
  expect(rows.every(row => row.querySelector('.pool-option-mark svg'))).toBe(true);
  expect(checkedValue(root, 'where')).toBe('local');
  expect(checkValue(root, 'where', 'network')).toBe(true);
  expect(checkedValue(root, 'where')).toBe('network');
  expect(checkValue(root, 'where', 'missing')).toBe(false);
});

it('renders a multi-select list as checkboxes in a group, and updates a row in place', () => {
  const root = mount(renderOptions({ id: 'share', label: 'Sharing', type: 'checkbox', options: [
    { key: 'compute', value: 'compute', title: 'Answer requests', status: '' },
    { key: 'files', value: 'files', title: 'Share files', status: '' }
  ] }));
  const group = root.querySelector('.pool-options-multi');
  expect(group.getAttribute('role')).toBe('group');
  const [compute] = group.querySelectorAll('input[type=checkbox]');
  expect(compute.id).toBe('share-compute');
  const row = compute.closest('.pool-option');
  updateOption(compute, { status: 'This page cannot share compute.', disabled: true, checked: false });
  expect(compute.closest('.pool-option')).toBe(row);
  expect(compute.disabled).toBe(true);
  expect(row.querySelector('.pool-row-status').textContent).toBe('This page cannot share compute.');
});

it('renders a segmented control, a toggle row, an action row and the dialog shell with their roles', () => {
  const root = mount(renderSegmented({ name: 'mode', label: 'Appearance', options: [{ value: 'light', label: 'Light', checked: true }, { value: 'dark', label: 'Dark' }] })
    + renderToggleRow({ id: 'files', title: 'Share model files', status: 'Not sharing', switchAttrs: { 'data-files': true } })
    + renderToggleRow({ id: 'named', title: 'Answer requests', switchAttrs: { 'aria-label': 'Help answer requests' } })
    + renderActionRow({ href: '/examples', title: 'Examples', icon: 'copy' })
    + renderDialog({ titleId: 'confirm-title', title: 'Remove download?', body: '<p>Body</p>', footer: '<button class="pool-button btn-primary">Remove</button>', fixed: true, attrs: { 'data-confirm': true } }));
  const segmented = root.querySelector('.pool-segmented');
  expect(segmented.getAttribute('role')).toBe('radiogroup');
  expect(segmented.getAttribute('aria-label')).toBe('Appearance');
  expect(checkedValue(segmented, 'mode')).toBe('light');
  const toggle = root.querySelector('[data-files]');
  expect(toggle.getAttribute('role')).toBe('switch');
  expect(document.getElementById(toggle.getAttribute('aria-labelledby')).textContent).toBe('Share model files');
  expect(document.getElementById(toggle.getAttribute('aria-describedby')).textContent).toBe('Not sharing');
  // An explicit accessible name replaces the title reference instead of competing with it.
  const named = root.querySelector('[aria-label="Help answer requests"]');
  expect(named.hasAttribute('aria-labelledby')).toBe(false);
  const action = root.querySelector('a.pool-action-row');
  expect(action.getAttribute('href')).toBe('/examples');
  expect(action.querySelectorAll('.pool-icon-box')).toHaveLength(2);
  const dialog = root.querySelector('dialog[data-confirm]');
  expect(dialog.classList.contains('pool-dialog-fixed')).toBe(true);
  expect([...dialog.children].map(node => node.className)).toEqual(['pool-dialog-header', 'pool-dialog-body', 'pool-dialog-footer']);
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Remove download?');
});

it('closes a dialog from its header Close and from an in-app destination link', () => {
  const root = mount(renderDialog({ titleId: 't', title: 'Who can read it', closeAttrs: { 'data-dialog-close': true },
    body: '<a href="/?view=computers" data-workspace-view="computers">Pair a desktop</a>' }));
  const node = root.querySelector('dialog');
  node.showModal ??= function showModal() { this.open = true; };
  node.close ??= function close() { this.open = false; this.dispatchEvent(new Event('close')); };
  const dialog = bindDialog(node);
  dialog.open();
  root.querySelector('[data-dialog-close]').click();
  expect(node.open).toBe(false);
  dialog.open();
  root.querySelector('a').addEventListener('click', event => event.preventDefault());
  root.querySelector('a').click();
  expect(node.open).toBe(false);
  dialog.dispose();
});
