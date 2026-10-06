/** Test-only extraction and execution; protected expected values stay in Node. */
export function extractQuoteCode(answer) {
  return answer.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i)?.[1] || answer;
}

export async function evaluateQuoteCode(page, code, input) {
  try {
    const result = await page.evaluate(async ({ code, input }) => {
      const { runIsolatedCode } = await import('/infrastructure/code-sandbox.js');
      return runIsolatedCode(`input => { ${code}\ntry { const value = chooseQuote(input.quotes, input.budget, input.deadline); return { value, resultType: typeof value, valueIsNull: value === null, quotes: input.quotes, exception: null }; } catch(error) { return { quotes: input.quotes, exception: { name: error?.name || 'ThrownValue', message: error?.message || String(error) } }; } }`,
        input, { timeoutMs: 1000, maxResultBytes: 65536 });
    }, { code, input });
    return { ...result, resultType: result.resultType ?? typeof result.value,
      mutationPreserved: JSON.stringify(result.quotes) === JSON.stringify(input.quotes) };
  } catch (error) {
    return { exception: { name: error.name, message: error.message }, resultType: 'unavailable', mutationPreserved: null };
  }
}

export const QUOTE_CASES = [
  { quotes: [
    { id: 'Harbor', subtotalCents: 1160000, taxPercent: 8, taxIncluded: true, completionDate: '2026-05-28' },
    { id: 'Maple', subtotalCents: 1080000, taxPercent: 8, taxIncluded: false, completionDate: '2026-05-25' },
    { id: 'Cedar', subtotalCents: 1055000, taxPercent: 0, taxIncluded: false, completionDate: '2026-06-10' },
  ], budget: 1200000, deadline: '2026-06-01', expected: { id: 'Harbor', totalCents: 1160000 } },
  { quotes: [{ id: 'rounding', subtotalCents: 101, taxPercent: 7.5, taxIncluded: false, completionDate: '2026-06-01' }],
    budget: 109, deadline: '2026-06-01', expected: { id: 'rounding', totalCents: 109 } },
  { quotes: [{ id: 'over', subtotalCents: 100, taxPercent: 10, taxIncluded: false, completionDate: '2026-06-01' }],
    budget: 109, deadline: '2026-06-01', expected: null },
  { quotes: ['z', 'a'].map(id => ({ id, subtotalCents: 100, taxPercent: 0, taxIncluded: true, completionDate: '2026-06-01' })),
    budget: 100, deadline: '2026-06-01', expected: { id: 'a', totalCents: 100 } },
  { quotes: [], budget: 0, deadline: '2026-06-01', expected: null },
];
