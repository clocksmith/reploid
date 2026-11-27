/** X entry: runs Zero's capsule at spark and loads the upgrade runtime only when selected. */
import { ensureReploidWindowInstance, getCurrentReploidStorage } from '../../shared/instance.js';
import {
  getSelectedLabUpgradeLevel,
  LAB_UPGRADE_LEVELS,
  LAB_UPGRADE_STORAGE_KEY
} from '../config/lab-upgrade-levels.js';
import { bootZero, connectZeroWorker } from '../zero/boot.js';

export async function bootX({
  win = window,
  openStore,
  read,
  connect = connectZeroWorker,
  load,
  onLegacy = null,
  onUpgrade = null
} = {}) {
  ensureReploidWindowInstance(win);
  win.getReploidRouteMode = () => 'x';
  win.getReploidMode = () => 'x';
  const storage = getCurrentReploidStorage();
  const selectedLevel = getSelectedLabUpgradeLevel('x', storage);
  if (selectedLevel !== 'spark') {
    if (typeof onLegacy === 'function') await onLegacy(win);
    return { upgraded: true, level: selectedLevel };
  }

  let activeCapsule = null;
  let upgradeControl = null;
  const activateUpgrade = onUpgrade || (async (targetWin) => {
    if (typeof onLegacy === 'function') await onLegacy(targetWin);
    else targetWin.location.reload();
  });

  const host = {
    title: 'X',
    onReady(capsule) {
      activeCapsule = capsule;
    },
    createExtension({ element, fail }) {
      const row = element('div', undefined, { class: 'zero-field' });
      const label = element('label', 'Optional upgrades', { for: 'zero-upgrade-level' });
      const select = element('select', undefined, { id: 'zero-upgrade-level' });
      for (const level of LAB_UPGRADE_LEVELS) {
        const text = level === 'spark' ? 'None: Zero core' : level;
        const option = element('option', text, { value: level });
        if (level === 'spark') option.selected = true;
        select.append(option);
      }
      select.onchange = async () => {
        const next = select.value;
        if (next === 'spark' || !LAB_UPGRADE_LEVELS.includes(next)) return;
        select.disabled = true;
        const previousUpgrade = storage.getItem(LAB_UPGRADE_STORAGE_KEY, { legacyFallback: false });
        const previousGenesis = storage.getItem('REPLOID_GENESIS_LEVEL', { legacyFallback: false });
        const prompt = win.document.getElementById('zero-prompt')?.value?.trim();
        if (prompt) storage.setItem('REPLOID_GOAL', prompt);
        storage.setItem('REPLOID_MODE', 'x');
        storage.setItem(LAB_UPGRADE_STORAGE_KEY, next);
        storage.setItem('REPLOID_GENESIS_LEVEL', next);
        try {
          const capsule = activeCapsule;
          activeCapsule = null;
          await capsule?.dispose();
          await activateUpgrade(win, next);
        } catch (error) {
          if (previousUpgrade === null) storage.removeItem(LAB_UPGRADE_STORAGE_KEY);
          else storage.setItem(LAB_UPGRADE_STORAGE_KEY, previousUpgrade);
          if (previousGenesis === null) storage.removeItem('REPLOID_GENESIS_LEVEL');
          else storage.setItem('REPLOID_GENESIS_LEVEL', previousGenesis);
          select.value = 'spark';
          select.disabled = false;
          fail(error);
        }
      };
      upgradeControl = select;
      row.append(label, select);
      return row;
    },
    dispose() {
      if (upgradeControl) upgradeControl.onchange = null;
      upgradeControl = null;
    }
  };

  return bootZero({
    win,
    ...(openStore ? { openStore } : {}),
    ...(read ? { read } : {}),
    connect,
    ...(load ? { load } : {}),
    onLegacy,
    mode: 'x',
    title: 'X',
    host
  });
}
