export function escapeHtml(value, apostrophe = '&#039;') {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": apostrophe
  })[character]);
}
