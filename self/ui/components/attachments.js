export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderAttachments(root, files) {
  root.hidden = !files.length;
  root.innerHTML = files.map((file, index) => `<span class="attachment-chip">${escapeHtml(file.name)} <button type="button" class="pool-button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button></span>`).join('');
}

export async function readTextAttachments(chosen, existing, { maxFiles, maxFileBytes, maxTotalBytes, extensions }) {
  if (chosen.length + existing.length > maxFiles || chosen.some(file => file.size > maxFileBytes)
    || [...chosen, ...existing].reduce((sum, file) => sum + (file.size ?? file.bytes), 0) > maxTotalBytes) {
    throw new Error(`Attach up to ${maxFiles} text files, ${maxFileBytes / 1024} KB each and ${maxTotalBytes / 1024} KB total.`);
  }
  if (chosen.some(file => !extensions.includes(file.name.split('.').at(-1).toLowerCase()))) throw new Error('Choose a supported text file.');
  return Promise.all(chosen.map(async file => ({ name: file.name, bytes: file.size,
    text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) })));
}
