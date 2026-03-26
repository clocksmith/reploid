import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateGoalPrompt } from '../../src/ui/boot-wizard/detection.js';
import { resetWizard, setNestedState, setState } from '../../src/ui/boot-wizard/state.js';

const VALID_GOAL = 'Measure, rewrite, validate, and redeploy your own core iteratively, preserving reversibility while increasing capability, efficiency, and autonomy.';

describe('Boot Goal Generator - Integration Tests', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    global.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    resetWizard();
    setState({ connectionType: 'direct' });
    setNestedState('directConfig', {
      provider: 'gemini',
      apiKey: 'gemini-key',
      model: 'gemini-3.1-flash-lite-preview'
    });
  });

  afterEach(() => {
    resetWizard();
    delete global.fetch;
    delete global.localStorage;
  });

  it('uses a hidden system prompt with the selected Gemini model', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: VALID_GOAL }] } }]
      })
    });

    const goal = await generateGoalPrompt();

    expect(goal).toBe(VALID_GOAL);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, request] = global.fetch.mock.calls[0];
    expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=gemini-key');

    const body = JSON.parse(request.body);
    expect(body.systemInstruction.parts[0].text).toContain('browser-based autonomous coding agent');
    expect(body.systemInstruction.parts[0].text).toContain('16 to 24 words');
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('Generate one recursive self-improvement goal now.');
    expect(body.generationConfig.maxOutputTokens).toBe(48);
  });

  it('retries Gemini goal generation without generationConfig after a 400', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: { message: 'Bad Request' } }))
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: VALID_GOAL }] } }]
        })
      });

    const goal = await generateGoalPrompt();

    expect(goal).toBe(VALID_GOAL);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);

    expect(firstBody.generationConfig).toEqual({
      maxOutputTokens: 48,
      temperature: 0.8
    });
    expect(secondBody.generationConfig).toBeUndefined();
    expect(secondBody.contents[0].role).toBe('user');
  });
});
