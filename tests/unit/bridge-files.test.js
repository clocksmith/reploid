import { afterEach, expect, it, vi } from 'vitest';
import { createBridgeFileTools } from '../../self/host/bridge-files.js';
import { normalizeFilePath } from '../../self/host/file-access.js';
import { FILE_TEXT_LIMIT_BYTES } from '../../self/config/vfs-policy.js';

afterEach(() => vi.unstubAllGlobals());
const setup = writer => {
  const createWritable = vi.fn(async () => writer);
  const getFileHandle = vi.fn(async () => ({ createWritable }));
  const getDirectory = vi.fn(async () => ({ getFileHandle }));
  vi.stubGlobal('navigator', { storage: { getDirectory } });
  return { createWritable, getDirectory, tools: createBridgeFileTools({ vfs: {}, normalizePath: normalizeFilePath,
    isModelWritableVfsPath: () => false, isWritableOpfsPath: () => true }) };
};

it('validates missing and oversized OPFS payloads before acquiring storage', async () => {
  const { tools, getDirectory } = setup({});
  await expect(tools.writeFile({ path: 'opfs:/result.txt' })).rejects.toThrow('Missing content');
  await expect(tools.writeFile({ path: 'opfs:/result.txt', content: 'x'.repeat(FILE_TEXT_LIMIT_BYTES + 1) }))
    .rejects.toThrow('Content exceeds limit');
  await expect(tools.writeFile({ path: 'opfs:/result.bin', mode: 'binary' })).rejects.toThrow('Missing data');
  expect(getDirectory).not.toHaveBeenCalled();
});

it('aborts its owned writer on a failed write and exposes failed cleanup', async () => {
  const error = new Error('write failed');
  const writer = { write: vi.fn(async () => { throw error; }), close: vi.fn(), abort: vi.fn(async () => {}) };
  const { tools } = setup(writer);
  await expect(tools.writeFile({ path: 'opfs:/result.txt', content: 'text' })).rejects.toBe(error);
  expect(writer.abort).toHaveBeenCalledOnce(); expect(writer.close).not.toHaveBeenCalled();
  writer.abort.mockRejectedValue(new Error('abort failed'));
  await expect(tools.writeFile({ path: 'opfs:/result.txt', content: 'text' }))
    .rejects.toMatchObject({ name: 'AggregateError', errors: [error, expect.objectContaining({ message: 'abort failed' })] });
});

it('closes successful writes and reports the UTF-8 byte count', async () => {
  const writer = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn() };
  const { tools } = setup(writer);
  expect(await tools.writeFile({ path: 'opfs:/result.txt', content: 'é' })).toMatchObject({ bytesWritten: 2 });
  expect(writer.write).toHaveBeenCalledWith('é'); expect(writer.close).toHaveBeenCalledOnce();
  expect(writer.abort).not.toHaveBeenCalled();
});
