import {afterEach, describe, expect, it, vi} from 'vitest';
import {bytesToBase64, base64ToBytes, toBase64Url, fromBase64Url} from '../../packages/reploid/src/artifacts/binary.js';
import {toBase64Url as identityEncode, fromBase64Url as identityDecode} from '../../packages/reploid/src/artifacts/identity.js';
import {cosineSimilarity} from '../../self/capabilities/cognition/vector-math.js';
import {parseJsonl, toJsonl} from '../../self/capabilities/cognition/jsonl.js';
import SemanticMemory from '../../self/capabilities/cognition/semantic/semantic-memory-llm.js';

afterEach(()=>vi.unstubAllGlobals());

describe('binary encoding shared by identity and transport',()=>{
 for(const mode of ['Node Buffer','browser builtins']) {
  it(`preserves exact standard and URL-safe bytes using ${mode}`,()=>{
   if(mode==='browser builtins')vi.stubGlobal('Buffer',undefined);
   const bytes=Uint8Array.of(99,251,255,0,98).subarray(1,4);
   expect(bytesToBase64(bytes)).toBe('+/8A');
   expect(toBase64Url(bytes)).toBe('-_8A');
   expect([...base64ToBytes('+/8A')]).toEqual([251,255,0]);
   expect([...fromBase64Url('-_8A')]).toEqual([251,255,0]);
   expect(toBase64Url(Uint8Array.of(255))).toBe('_w');
   expect([...fromBase64Url('_w')]).toEqual([255]);
   expect(identityEncode(bytes)).toBe('-_8A');
   expect([...identityDecode('_w')]).toEqual([255]);
   const many=new Uint8Array(200000).fill(255);
   expect(base64ToBytes(bytesToBase64(many))).toEqual(many);
   expect(bytesToBase64(new Uint8Array())).toBe('');
   expect([...base64ToBytes('')]).toEqual([]);
  });
 }
});

describe('cognitive math and persistence contracts',()=>{
 it('preserves similarity for typed vectors, empty/mismatched inputs, zeros and opposite direction',()=>{
  expect(cosineSimilarity([1,0],[0,1])).toBe(0);
  expect(cosineSimilarity(new Float32Array([3,4]),new Float32Array([-3,-4]))).toBe(-1);
  expect(cosineSimilarity([],[])).toBe(0);
  expect(cosineSimilarity(null,[1])).toBe(0);
  expect(cosineSimilarity([1],[1,2])).toBe(0);
  expect(cosineSimilarity([0],[1])).toBe(0);
 });
 it('retains the SemanticMemory compatibility API and its epsilon for tiny vectors',()=>{
  const memory=SemanticMemory.factory({Utils:{logger:{},generateId:()=>''},EventBus:{},VFS:{}});
  expect(memory.cosineSimilarity([1],[1])).toBe(1/(1+1e-8));
  expect(memory.cosineSimilarity([1e-200],[1])).toBe(1e-200 / 1e-8);
  expect(memory.cosineSimilarity([0],[1])).toBe(0);
  expect(cosineSimilarity([1e-200],[1])).toBe(0);
 });
 it('round-trips JSON values and ignores blank rows without swallowing malformed records',()=>{
  const rows=[{text:'quotes " and Unicode 日本語',url:'https://example.com/a//b'},null,[1,'x'],{nested:{ok:true}}];
  expect(parseJsonl('\n'+toJsonl(rows)+'\n \r\n')).toEqual(rows);
  expect(parseJsonl('')).toEqual([]);
  expect(parseJsonl(null)).toEqual([]);
  expect(toJsonl([])).toBe('');
  expect(()=>parseJsonl('{"ok":true}\n{bad}\n{"ok":false}')).toThrow();
 });
});
