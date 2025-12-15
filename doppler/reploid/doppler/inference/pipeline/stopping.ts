/**
 * Stop condition evaluation for text generation.
 */

export interface StopCondition {
  /**
   * Check if generation should stop.
   * @param tokens - Generated token IDs
   * @param text - Generated text
   * @returns true if generation should stop
   */
  check(tokens: number[], text: string): boolean;
}

/**
 * Stop on EOS token or specific stop token IDs.
 */
export class TokenStopCondition implements StopCondition {
  constructor(
    private readonly stopTokenIds: number[],
    private readonly eosTokenId?: number
  ) {}

  check(tokens: number[]): boolean {
    if (tokens.length === 0) return false;

    const lastToken = tokens[tokens.length - 1];

    // Check configured stop tokens
    if (this.stopTokenIds.includes(lastToken)) {
      return true;
    }

    // Check EOS token
    if (this.eosTokenId !== undefined && lastToken === this.eosTokenId) {
      return true;
    }

    return false;
  }
}

/**
 * Stop when maximum number of tokens is reached.
 */
export class MaxLengthStopCondition implements StopCondition {
  constructor(private readonly maxTokens: number) {}

  check(tokens: number[]): boolean {
    return tokens.length >= this.maxTokens;
  }
}

/**
 * Stop on specific text sequences.
 */
export class SequenceStopCondition implements StopCondition {
  private textTail = '';

  constructor(
    private readonly stopSequences: string[],
    private readonly maxStopLen: number = 0
  ) {
    // Calculate max stop sequence length if not provided
    if (this.maxStopLen === 0 && stopSequences.length > 0) {
      this.maxStopLen = stopSequences.reduce((max, seq) => Math.max(max, seq.length), 0);
    }
  }

  check(_tokens: number[], text: string): boolean {
    if (this.stopSequences.length === 0 || this.maxStopLen === 0) {
      return false;
    }

    // Maintain a sliding window of recent text
    this.textTail += text;
    if (this.textTail.length > this.maxStopLen * 2) {
      this.textTail = this.textTail.slice(-this.maxStopLen * 2);
    }

    // Check if any stop sequence appears at the end
    for (const stopSeq of this.stopSequences) {
      if (this.textTail.endsWith(stopSeq)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Reset internal state (for new generation).
   */
  reset(): void {
    this.textTail = '';
  }
}

/**
 * Stop on regex pattern match.
 */
export class PatternStopCondition implements StopCondition {
  constructor(private readonly pattern: RegExp) {}

  check(_tokens: number[], text: string): boolean {
    return this.pattern.test(text);
  }
}

/**
 * Combine multiple stop conditions (OR logic).
 */
export class CompositeStopCondition implements StopCondition {
  constructor(private readonly conditions: StopCondition[]) {}

  check(tokens: number[], text: string): boolean {
    return this.conditions.some((condition) => condition.check(tokens, text));
  }
}

/**
 * Check if a token is a stop token.
 */
export function isStopToken(
  token: number,
  stopTokenIds: number[],
  eosTokenId?: number
): boolean {
  if (stopTokenIds.includes(token)) {
    return true;
  }

  if (eosTokenId !== undefined && token === eosTokenId) {
    return true;
  }

  return false;
}

/**
 * Create a composite stop condition from configuration.
 */
export function createStopCondition(config: {
  maxTokens?: number;
  stopTokenIds?: number[];
  eosTokenId?: number;
  stopSequences?: string[];
  pattern?: RegExp;
}): StopCondition {
  const conditions: StopCondition[] = [];

  if (config.maxTokens) {
    conditions.push(new MaxLengthStopCondition(config.maxTokens));
  }

  if (config.stopTokenIds || config.eosTokenId) {
    conditions.push(new TokenStopCondition(config.stopTokenIds || [], config.eosTokenId));
  }

  if (config.stopSequences && config.stopSequences.length > 0) {
    conditions.push(new SequenceStopCondition(config.stopSequences));
  }

  if (config.pattern) {
    conditions.push(new PatternStopCondition(config.pattern));
  }

  if (conditions.length === 0) {
    // Default: stop at max length
    return new MaxLengthStopCondition(512);
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return new CompositeStopCondition(conditions);
}
