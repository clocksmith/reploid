/** Shared presentation only. Never supplies execution state or authority. */
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

export function renderWorkHeading(title) {
  return `<header class="pool-connected-heading">
    <h1>${escape(title)}</h1>
  </header>`;
}
