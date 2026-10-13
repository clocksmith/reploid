import { expect, it, vi } from 'vitest';
const source = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../self/vendor/reploid/mesh/index.js', () => ({ createPartitionNetwork: source.create }));
import { createWorkPartitionNetworks } from '../../self/host/work-partition-networks.js';
it('retains failed endpoint owners for explicit host-close retry while settling independent networks', async () => {
  const failed = { close: vi.fn().mockRejectedValueOnce(Error('unknown retirement')).mockResolvedValue() };
  const healthy = { close: vi.fn().mockResolvedValue() };
  source.create.mockReturnValueOnce(failed).mockReturnValueOnce(healthy);
  const host = createWorkPartitionNetworks({ transport: {}, verifyPeer() {} });
  const first = host.open({ label: 'first' }); host.open({ label: 'second' });
  await expect(first.close()).rejects.toThrow('unknown retirement');
  failed.close.mockRejectedValueOnce(Error('still unknown'));
  const pending = host.close(); expect(host.close()).toBe(pending);
  await expect(pending).rejects.toThrow('settlement failed');
  expect(healthy.close).toHaveBeenCalledOnce();
  expect(() => host.open({})).toThrow('closing');
  await host.close();
  expect(failed.close).toHaveBeenCalledTimes(3); expect(healthy.close).toHaveBeenCalledOnce();
});
it('a synchronous failure does not skip an independent network and retry preserves debt', async () => {
  const bad = { close: vi.fn().mockImplementationOnce(() => { throw Error('sync failure'); }).mockResolvedValue() };
  const good = { close: vi.fn().mockResolvedValue() };
  source.create.mockReturnValueOnce(bad).mockReturnValueOnce(good);
  const host = createWorkPartitionNetworks({ transport: {}, verifyPeer() {} });
  host.open({}); host.open({});
  await expect(host.close()).rejects.toThrow('settlement failed');
  expect(good.close).toHaveBeenCalledOnce();
  await host.close(); expect(bad.close).toHaveBeenCalledTimes(2);
});
