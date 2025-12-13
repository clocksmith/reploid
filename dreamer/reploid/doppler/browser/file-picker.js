/**
 * file-picker.js - Feature-detected GGUF File Picker
 *
 * Uses File System Access API on Chrome/Edge, falls back to <input type="file">
 * for Firefox/Safari.
 *
 * @module browser/file-picker
 */

/**
 * Check if File System Access API is available
 * @returns {boolean}
 */
export function hasFileSystemAccess() {
  return 'showOpenFilePicker' in window;
}

/**
 * Pick a GGUF file from the user's filesystem
 *
 * @returns {Promise<File|null>} The selected file, or null if cancelled
 */
export async function pickGGUFFile() {
  if (hasFileSystemAccess()) {
    return pickWithFileSystemAccess();
  }
  return pickWithFileInput();
}

/**
 * Pick file using File System Access API (Chrome/Edge)
 * @returns {Promise<File|null>}
 */
async function pickWithFileSystemAccess() {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'GGUF Model Files',
          accept: {
            'application/octet-stream': ['.gguf'],
          },
        },
      ],
      multiple: false,
    });

    return await fileHandle.getFile();
  } catch (err) {
    // User cancelled or error
    if (err.name === 'AbortError') {
      return null;
    }
    throw err;
  }
}

/**
 * Pick file using traditional file input (Firefox/Safari fallback)
 * @returns {Promise<File|null>}
 */
function pickWithFileInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gguf';
    input.style.display = 'none';

    input.onchange = () => {
      const file = input.files?.[0] || null;
      document.body.removeChild(input);
      resolve(file);
    };

    // Handle cancel (input loses focus without selection)
    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };

    // Fallback for browsers without oncancel
    const handleFocusBack = () => {
      // Give time for onchange to fire first
      setTimeout(() => {
        if (document.body.contains(input) && !input.files?.length) {
          document.body.removeChild(input);
          resolve(null);
        }
      }, 300);
    };

    window.addEventListener('focus', handleFocusBack, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Check if streaming read is available (for large files)
 * @param {File} file
 * @returns {boolean}
 */
export function canStreamFile(file) {
  return typeof file.stream === 'function';
}

/**
 * Get a readable stream from a file
 * @param {File} file
 * @returns {ReadableStream<Uint8Array>}
 */
export function getFileStream(file) {
  if (!canStreamFile(file)) {
    throw new Error('File streaming not supported in this browser');
  }
  return file.stream();
}

export default pickGGUFFile;
