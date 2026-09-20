/** Shared presentation only. Never supplies execution state or authority. */
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

export function renderWorkHeading(section, title, description) {
  return `<header class="pool-connected-heading">
    <p class="pool-work-eyebrow">${escape(section)}</p>
    <h1>${escape(title)}</h1>
    <p>${escape(description)}</p>
  </header>`;
}
