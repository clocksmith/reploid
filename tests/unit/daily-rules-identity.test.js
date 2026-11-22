// @vitest-environment node
import { describe,expect,it,vi } from 'vitest';
import { judgePrompt, scoreOutput } from '../../server/daily/rules.js';
import { createEmailIdentity } from '../../server/daily/identity.js';
describe('daily judge',() => {
  it('accepts a whole answer after exactly the documented normalization',() => {
    for (const output of [' I RESIGN! ','i resign','I resign.']) expect(scoreOutput(output,'I resign.')).toBe(true);
    for (const output of ['I resign!!','Answer: I resign.','I  resign.','I resign. More.','']) expect(scoreOutput(output,'I resign.')).toBe(false);
  });
  it('counts words, disallows stylized or fragmented target words and only bans standalone I',() => {
    expect(judgePrompt('  Write-this briefly  ','I resign.')).toEqual({prompt:'Write-this briefly',words:3,characters:18});
    for (const prompt of ['i quit','resigned','r-e-s-i-g-n','rÉsign','ｒｅｓｉｇｎ','rеsign','resıgn','reſign','r\u200besign']) {
      expect(() => judgePrompt(prompt,'I resign.')).toThrow();
    }
    expect(() => judgePrompt('identify the speaker','I resign.')).not.toThrow();
    expect(() => judgePrompt('...','Paris')).toThrow();
    expect(() => judgePrompt('ab'.repeat(121),'Paris')).toThrow();
  });
  it('accepts translations, riddles and analogies written in other scripts', () => {
    for (const prompt of ['用第一人称说你不再担任这个职位。', 'Как сказать «я увольняюсь» по-английски?',
      '用英语翻译「我辞职」', 'Démissionner est au salarié ce qu’abdiquer est au roi.', 'नौकरी छोड़ने का वाक्य लिखें।']) {
      expect(judgePrompt(prompt, 'I resign.').prompt).toBe(prompt.normalize('NFC'));
    }
    expect(judgePrompt('東京　ＦＯＯ', 'I resign.')).toEqual({prompt:'東京　ＦＯＯ', words:2, characters:6});
    expect(judgePrompt('㍘', 'I resign.')).toEqual({prompt:'㍘', words:1, characters:1});
    expect(judgePrompt('½', 'Mars')).toEqual({prompt:'½', words:2, characters:1});
  });
  it('checks confusables and split fragments at both boundaries', () => {
    for (const prompt of ['Ｒ－е－ѕ－і－ɡ－Ν', 'r Е Ѕ І G Ν', 'ⓇeＳigΝ', 'r℮sign', 'r℮-s-i-g-n', 'r.e s.i ɡ.Ν', 'і quit', 'Ⅰ quit', 'reſigns',
      'try resig\u202en', 'try r\ufe0fesign']) expect(() => judgePrompt(prompt, 'I resign.')).toThrow();
    expect(judgePrompt('Rephrase «я ухожу»', 'I resign.').words).toBe(3);
    expect(judgePrompt('Identify minima', 'I resign.').words).toBe(2);
  });
});
describe('email identity for a circle',() => {
  it('resolves stable verified identity from the configured issuer',async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ok:true})
      .mockResolvedValueOnce({ok:true,json:async () => ({access_token:'fixture-bearer'})})
      .mockResolvedValueOnce({ok:true,json:async () => ({id:'42',email:'player@example.test',email_confirmed_at:'2026-01-01'})});
    const identity = createEmailIdentity({projectUrl:'https://auth.example.test',publishableKey:'fixture',fetchImpl});
    await identity.start('Player@example.test');
    await expect(identity.verify('Player@example.test','123456')).resolves.toBe('https://auth.example.test/user/42');
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/auth/v1/otp','/auth/v1/verify','/auth/v1/user']);
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer fixture-bearer');
  });
  it('rejects unconfirmed or different accounts and insecure identity origins',async () => {
    expect(() => createEmailIdentity({projectUrl:'http://elsewhere.test',publishableKey:'fixture'})).toThrow();
    for (const user of [{email:'other@example.test',email_confirmed_at:'today'},{email:'me@example.test'}]) {
      const fetchImpl = vi.fn().mockResolvedValueOnce({ok:true,json:async () => ({access_token:'token'})})
        .mockResolvedValueOnce({ok:true,json:async () => ({id:'42',...user})});
      const identity = createEmailIdentity({projectUrl:'https://auth.example.test',publishableKey:'fixture',fetchImpl});
      await expect(identity.verify('me@example.test','123456')).rejects.toThrow('verified email');
    }
  });
});
