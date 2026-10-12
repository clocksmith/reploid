"""Aggregate admission, counting each repeated input and every generated output."""
def allowance(limits, row, prompt_tokens, source_count=None):
    if row['rawOutputUtf16'] >= limits['rawOutputUtf16']:
        return 0
    maximum = min(limits['generatedTokens'] - row['generatedTokens'],
        limits['promptPlusGeneratedTokens'] - row['promptTokens'] - row['generatedTokens'] - prompt_tokens)
    if source_count is not None:
        if not isinstance(source_count, int) or source_count <= 0:
            raise ValueError('Positive source count required')
        maximum = min(maximum, limits['extractionMaxTokens'] // source_count)
    return max(0, maximum)
