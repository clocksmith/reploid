const NON_RETRYABLE_ERROR_PATTERNS = [
    /^File not found:/i,
    /^File not found in VFS:/i,
    /^Missing .+ argument/i,
    /^Invalid (backend|mode|offset|length)/i,
    /^Path traversal is not allowed/i,
    /^OPFS path not allowed:/i,
    /^VFS supports text mode only/i,
    /^offset\/length are only supported/i,
    /^Read range exceeds file size/i,
    /^Read length exceeds maxBytes/i,
    /^maxBytes /i,
    /^File too large/i,
    /^Unsupported VFS entry type/i,
    /^Tool not found:/i,
    /^Tool '.+' not permitted/i,
    /^LoadModule only supports promoted \/self paths/i,
    /^Tool module has a leading pipe literal marker/i,
    /^Policy violation:/i,
    /^Operation rejected by user/i
  ];


/** @param {unknown} error */
export const isRetryableToolError = error => {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return false;
  return !NON_RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(message));
};
