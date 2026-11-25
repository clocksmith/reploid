// @vitest-environment node
/** HPKE (RFC 9180) base mode against the RFC's appendix A.1 vectors, and the response direction of a session. */
import { describe, it, expect } from 'vitest';
import {
  setupBaseSender, setupBaseRecipient, importX25519KeyPair, responseCipher, generateX25519KeyPair, exportX25519PublicKey
} from '../../packages/reploid/src/inference/attested/hpke.js';
import { fromHex, toHex, utf8, decodeUtf8 } from '../../packages/reploid/src/inference/attested/bytes.js';

// RFC 9180 A.1: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM, base mode.
const A1 = {
  suite: { kem: 0x20, kdf: 1, aead: 1 },
  info: '4f6465206f6e2061204772656369616e2055726e',
  skEm: '52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736', pkEm: '37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431',
  skRm: '4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8', pkRm: '3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d',
  pt: '4265617574792069732074727574682c20747275746820626561757479',
  encryptions: [
    ['436f756e742d30', 'f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a96d8770ac83d07bea87e13c512a'],
    ['436f756e742d31', 'af2d7e9ac9ae7e270f46ba1f975be53c09f8d875bdc8535458c2494e8a6eab251c03d0c22a56b8ca42c2063b84'],
    ['436f756e742d32', '498dfcabd92e8acedc281e85af1cb4e3e31c7dc394a1ca20e173cb72516491588d96a19ad4a683518973dcc180']
  ],
  exports: [['', '3853fe2b4035195a573ffc53856e77058e15d9ea064de3e59f4961d0095250ee'],
    ['00', '2e8f0b54673c7029649d4eb9d5e33bf1872cf76d623ff164ac185da9e88c21a5'],
    ['54657374436f6e74657874', 'e9e43065102c3836401bed8c3c3c75ae46be1639869391d62c61f1ec7af54931']]
};

describe('HPKE base mode', () => {
  it('reproduces RFC 9180 A.1 encapsulation, encryptions and exports', async () => {
    const ephemeral = await importX25519KeyPair({ privateKey: fromHex(A1.skEm), publicKey: fromHex(A1.pkEm) });
    const { enc, context } = await setupBaseSender(fromHex(A1.pkRm), fromHex(A1.info), { suite: A1.suite, ephemeral });
    expect(toHex(enc)).toBe(A1.pkEm);
    for (const [aad, ct] of A1.encryptions) expect(toHex(await context.seal(fromHex(A1.pt), fromHex(aad)))).toBe(ct);
    for (const [ctx, value] of A1.exports) expect(toHex(await context.export(fromHex(ctx), 32))).toBe(value);
    const recipient = await importX25519KeyPair({ privateKey: fromHex(A1.skRm), publicKey: fromHex(A1.pkRm) });
    const opened = await setupBaseRecipient(enc, recipient, fromHex(A1.info), { suite: A1.suite });
    for (const [aad, ct] of A1.encryptions) expect(toHex(await opened.open(fromHex(ct), fromHex(aad)))).toBe(A1.pt);
  });

  it('round-trips the route suite (AES-256-GCM) and rejects tampering, wrong context and replay order', async () => {
    const pair = await generateX25519KeyPair();
    const pk = await exportX25519PublicKey(pair.publicKey);
    const info = utf8('reploid.attested-gpu/v1 request|test');
    const { enc, context } = await setupBaseSender(pk, info);
    const first = await context.seal(utf8('first'), utf8('aad'));
    const second = await context.seal(utf8('second'), utf8('aad'));
    const recipient = await setupBaseRecipient(enc, pair, info);
    await expect(recipient.open(second, utf8('aad'))).rejects.toMatchObject({ code: 'HPKE_OPEN_FAILED' });
    const fresh = await setupBaseRecipient(enc, pair, info);
    expect(decodeUtf8(await fresh.open(first, utf8('aad')))).toBe('first');
    const tampered = second.slice(); tampered[0] ^= 1;
    await expect(fresh.open(tampered, utf8('aad'))).rejects.toMatchObject({ code: 'HPKE_OPEN_FAILED' });
    const otherInfo = await setupBaseRecipient(enc, pair, utf8('another session'));
    await expect(otherInfo.open(first, utf8('aad'))).rejects.toMatchObject({ code: 'HPKE_OPEN_FAILED' });
  });

  it('derives the same response key on both ends and nowhere else', async () => {
    const pair = await generateX25519KeyPair();
    const { enc, context } = await setupBaseSender(await exportX25519PublicKey(pair.publicKey), utf8('i'));
    const recipient = await setupBaseRecipient(enc, pair, utf8('i'));
    const out = await responseCipher(recipient, 'label');
    const back = await responseCipher(context, 'label');
    expect(decodeUtf8(await back.open(await out.seal(utf8('answer'), utf8('a')), utf8('a')))).toBe('answer');
    const otherPair = await generateX25519KeyPair();
    const stranger = await setupBaseSender(await exportX25519PublicKey(otherPair.publicKey), utf8('i'));
    const wrong = await responseCipher(stranger.context, 'label');
    await expect(wrong.open(await out.seal(utf8('answer'), utf8('a')), utf8('a'))).rejects.toMatchObject({ code: 'HPKE_OPEN_FAILED' });
  });
});
