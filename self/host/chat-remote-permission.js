/** Host-owned preference. Default authorization is recorded only when a person sends. */
import policy from '../config/chat-remote-permission.json' with { type: 'json' };

const KEY = 'reploid.remote-access:v1';

export function createRemoteAccessPreference({ storage, currentNetwork, getPermissions }) {
  let preferences = {}, readable = true;
  try {
    const saved = storage?.getItem?.(KEY);
    if (saved !== null && saved !== undefined) {
      preferences = JSON.parse(saved);
      if (!preferences || Array.isArray(preferences) || typeof preferences !== 'object'
        || Object.values(preferences).some(value => typeof value !== 'boolean')) throw new Error('Invalid network preference');
    }
  } catch { preferences = {}; readable = false; }
  return Object.freeze({
    enabled() {
      const network = currentNetwork();
      if (Object.hasOwn(preferences, network)) return preferences[network];
      // An earlier Turn off is an explicit choice, not an unset default.
      if (getPermissions().some(row => row.networkId === network && row.revokedAt !== null)) return false;
      return readable && policy.enabledByDefault;
    },
    set(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Network answers setting must be on or off');
      const next = { ...preferences, [currentNetwork()]: enabled };
      // Opt-out takes effect in memory even if persistence fails; opt-in requires a successful save.
      if (!enabled) preferences = next;
      storage?.setItem?.(KEY, JSON.stringify(next));
      preferences = next;
    },
    wording: policy.wording
  });
}
