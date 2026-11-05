/** Reusable diamond artwork. Progress is supplied by the caller, never inferred from time. */
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let nextId = 0;
const normalize = ({ state = 'idle', progress = null, label = 'Loading' } = {}) => {
  if (!['idle', 'loading', 'progress', 'complete', 'error'].includes(state)) throw new Error('Unknown diamond state');
  if (state === 'progress' && (!Number.isFinite(progress) || progress < 0 || progress > 1)) throw new Error('Diamond progress must be between zero and one');
  return { state, progress: state === 'complete' ? 1 : state === 'progress' ? progress : null, label: String(label) };
};
export function renderDiamond({ id, ...options } = {}) {
  const prefix = id || `diamond-${++nextId}`;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(prefix)) throw new Error('Invalid diamond id');
  const value = normalize(options), percent = value.progress === null ? null : Math.round(value.progress * 100);
  return `<span class="pool-diamond" data-diamond data-diamond-state="${value.state}" ${value.state === 'idle' ? 'aria-hidden="true"' : `role="${value.state === 'error' ? 'status' : 'progressbar'}" aria-label="${escape(value.label)}"${value.state === 'error' ? '' : ' aria-valuemin="0" aria-valuemax="100"'}${percent === null ? '' : ` aria-valuenow="${percent}"`}`}>
    <span class="pool-diamond-visual">
            <svg class="pool-prism-still" viewBox="0 0 480 420" focusable="false">
              <defs>
                <linearGradient id="${prefix}-glass" x1="0" y1="0" x2="1" y2="1">
                  <stop stop-color="#ffffff"/><stop offset=".45" stop-color="#e3e9ee"/>
                  <stop offset=".7" stop-color="#dedaf1"/><stop offset="1" stop-color="#f6e4d7"/>
                </linearGradient>
                <linearGradient id="${prefix}-edge" x1="0" y1="0" x2="1" y2="1">
                  <stop stop-color="#bfdecd"/><stop offset=".4" stop-color="#ffffff"/>
                  <stop offset=".65" stop-color="#a6cce4"/><stop offset="1" stop-color="#d5b8ec"/>
                </linearGradient>
                <radialGradient id="${prefix}-light">
                  <stop stop-color="#c5c2df" stop-opacity=".35"/><stop offset="1" stop-color="#e9e8e4" stop-opacity="0"/>
                </radialGradient>
              </defs>
              <ellipse cx="240" cy="344" rx="154" ry="39" fill="url(#${prefix}-light)"/>
              <g stroke="url(#${prefix}-edge)" stroke-width="1.5" stroke-linejoin="round">
                <path d="M239 55 373 167 270 304 116 200Z" fill="url(#${prefix}-glass)"/>
                <path d="M239 55 244 186 116 200Z" fill="#fbfcfc" fill-opacity=".7"/>
                <path d="M239 55 373 167 244 186Z" fill="#dce7e7" fill-opacity=".45"/>
                <path d="M244 186 373 167 270 304Z" fill="#c7c9e3" fill-opacity=".45"/>
                <path d="M116 200 244 186 270 304Z" fill="#f4e6dd" fill-opacity=".5"/>
              </g>
            </svg>
            <canvas class="pool-prism-canvas" data-pool-prism-canvas></canvas>
      <svg class="pool-diamond-progress" viewBox="0 0 480 420" aria-hidden="true"><path data-diamond-progress pathLength="100" d="M116 400H373" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-dasharray="100" stroke-dashoffset="${100 - (percent || 0)}"/></svg>
    </span><span class="pool-caption pool-muted" data-diamond-caption ${value.state === 'idle' ? 'hidden' : ''}>${percent === null ? escape(value.label) : `${percent}%`}</span>
  </span>`;
}

export function bindDiamond(element, initial = {}, { enhance = false } = {}) {
  const shell = element.matches?.('[data-diamond]') ? element : element.querySelector('[data-diamond]');
  if (!shell) throw new Error('Diamond element is missing');
  let value = normalize(initial), disposed = false, disposeRenderer;
  if (enhance) void import('./diamond-renderer.js').then(({ bindDiamondRenderer }) => {
    if (!disposed) disposeRenderer = bindDiamondRenderer(shell, { animate: false });
  }).catch(() => {});
  const update = next => {
    if (disposed) return;
    value = normalize({ ...value, ...next });
    shell.dataset.diamondState = value.state;
    const decorative = value.state === 'idle';
    shell.toggleAttribute('aria-hidden', decorative);
    if (decorative) shell.setAttribute('aria-hidden', 'true');
    shell.removeAttribute('aria-valuenow');
    if (decorative) {
      for (const name of ['role', 'aria-label', 'aria-valuemin', 'aria-valuemax']) shell.removeAttribute(name);
    } else {
      shell.setAttribute('role', value.state === 'error' ? 'status' : 'progressbar');
      shell.setAttribute('aria-label', value.label);
      if (value.state === 'error') { shell.removeAttribute('aria-valuemin'); shell.removeAttribute('aria-valuemax'); }
      else { shell.setAttribute('aria-valuemin', '0'); shell.setAttribute('aria-valuemax', '100'); }
      if (value.progress !== null) shell.setAttribute('aria-valuenow', String(Math.round(value.progress * 100)));
    }
    const caption = shell.querySelector('[data-diamond-caption]');
    caption.hidden = decorative;
    caption.textContent = value.progress === null ? value.label : `${Math.round(value.progress * 100)}%`;
    shell.querySelector('[data-diamond-progress]').setAttribute('stroke-dashoffset', String(100 - (value.progress ?? 0) * 100));
  };
  update(value);
  return { update, dispose() { update({ state: 'idle' }); disposed = true; disposeRenderer?.(); } };
}
