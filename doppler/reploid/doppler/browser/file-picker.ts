/**
 * file-picker.ts - Feature-detected GGUF File Picker
 *
 * Uses File System Access API on Chrome/Edge, falls back to <input type="file">
 * for Firefox/Safari.
 *
 * @module browser/file-picker
 */

// ============================================================================
// Types
// ============================================================================

/**
 * File picker options for File System Access API
 */
interface FilePickerOptions {
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
  multiple?: boolean;
}

// ============================================================================
// File System Access API declarations
// ============================================================================

declare global {
  interface Window {
    showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if File System Access API is available
 */
export function hasFileSystemAccess(): boolean {
  return 'showOpenFilePicker' in window;
}

/**
 * Pick a GGUF file from the user's filesystem
 * @returns The selected file, or null if cancelled
 */
export async function pickGGUFFile(): Promise<File | null> {
  if (hasFileSystemAccess()) {
    return pickWithFileSystemAccess();
  }
  return pickWithFileInput();
}

/**
 * Pick file using File System Access API (Chrome/Edge)
 */
async function pickWithFileSystemAccess(): Promise<File | null> {
  try {
    const [fileHandle] = await window.showOpenFilePicker!({
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
    if ((err as Error).name === 'AbortError') {
      return null;
    }
    throw err;
  }
}

/**
 * Pick file using traditional file input (Firefox/Safari fallback)
 */
function pickWithFileInput(): Promise<File | null> {
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
    const handleFocusBack = (): void => {
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
 */
export function canStreamFile(file: File): boolean {
  return typeof file.stream === 'function';
}

/**
 * Get a readable stream from a file
 */
export function getFileStream(file: File): ReadableStream<Uint8Array> {
  if (!canStreamFile(file)) {
    throw new Error('File streaming not supported in this browser');
  }
  return file.stream();
}

export default pickGGUFFile;
