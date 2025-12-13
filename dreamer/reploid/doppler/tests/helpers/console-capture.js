/**
 * console-capture.js - Browser Console Capture Utility
 *
 * Captures and analyzes browser console output during e2e tests.
 *
 * @module tests/helpers/console-capture
 */

/**
 * Console log entry
 * @typedef {Object} LogEntry
 * @property {string} type - Log type (log, warn, error, info, debug)
 * @property {string} text - Log message text
 * @property {number} timestamp - Unix timestamp
 */

/**
 * Console capture helper
 */
export class ConsoleCapture {
  constructor() {
    /** @type {LogEntry[]} */
    this.logs = [];

    /** @type {string[]} */
    this.errors = [];

    /** @type {Set<string>} */
    this.importantPatterns = new Set([
      '[Pipeline]',
      '[DOPPLERDemo]',
      '[DopplerLoader]',
      'Prefill logits:',
      'Decode[',
      'OUTPUT',
      'Generated',
      'top-5:',
      'Error',
      'Loading model',
      'Model loaded',
    ]);
  }

  /**
   * Attach to a Playwright page
   * @param {import('@playwright/test').Page} page
   * @param {Object} [options]
   * @param {boolean} [options.printImportant] - Print important logs to stdout
   * @param {boolean} [options.printAll] - Print all logs to stdout
   */
  attach(page, options = {}) {
    const { printImportant = true, printAll = false } = options;

    page.on('console', msg => {
      const entry = {
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      };

      this.logs.push(entry);

      // Check if important
      const isImportant = this._isImportant(entry.text);

      if (printAll || (printImportant && isImportant)) {
        console.log(`[${entry.type}] ${entry.text}`);
      }
    });

    page.on('pageerror', err => {
      this.errors.push(err.message);
      console.error('PAGE ERROR:', err.message);
    });
  }

  /**
   * Check if a log message matches important patterns
   * @private
   */
  _isImportant(text) {
    for (const pattern of this.importantPatterns) {
      if (text.includes(pattern)) return true;
    }
    return false;
  }

  /**
   * Add custom important patterns
   * @param {string[]} patterns
   */
  addImportantPatterns(patterns) {
    patterns.forEach(p => this.importantPatterns.add(p));
  }

  /**
   * Get all log texts
   * @returns {string[]}
   */
  getLogTexts() {
    return this.logs.map(l => l.text);
  }

  /**
   * Get logs matching a pattern
   * @param {string|RegExp} pattern
   * @returns {LogEntry[]}
   */
  filter(pattern) {
    return this.logs.filter(l => {
      if (typeof pattern === 'string') {
        return l.text.includes(pattern);
      }
      return pattern.test(l.text);
    });
  }

  /**
   * Check if any log contains the pattern
   * @param {string|RegExp} pattern
   * @returns {boolean}
   */
  contains(pattern) {
    return this.filter(pattern).length > 0;
  }

  /**
   * Get logs by type
   * @param {string} type - 'log', 'warn', 'error', 'info', 'debug'
   * @returns {LogEntry[]}
   */
  byType(type) {
    return this.logs.filter(l => l.type === type);
  }

  /**
   * Get error logs
   * @returns {LogEntry[]}
   */
  getErrors() {
    return this.logs.filter(l =>
      l.type === 'error' ||
      l.text.toLowerCase().includes('error')
    );
  }

  /**
   * Clear captured logs
   */
  clear() {
    this.logs = [];
    this.errors = [];
  }

  /**
   * Get the last N logs
   * @param {number} n
   * @returns {LogEntry[]}
   */
  last(n) {
    return this.logs.slice(-n);
  }

  // ============================================
  // DOPPLER-specific analysis
  // ============================================

  /**
   * Extract logits information from logs
   * @returns {Object[]}
   */
  getLogitsInfo() {
    const logitsLogs = this.filter(/logits:|top-5:/);
    return logitsLogs.map(l => {
      const match = l.text.match(/top-5: (.+)$/);
      return {
        raw: l.text,
        tokens: match ? match[1] : null,
      };
    });
  }

  /**
   * Check for generation output
   * @returns {{found: boolean, text: string|null}}
   */
  getGenerationOutput() {
    const outputLog = this.logs.find(l =>
      l.text.includes('OUTPUT') ||
      l.text.includes('Output text:') ||
      l.text.includes('Generated:')
    );

    return {
      found: !!outputLog,
      text: outputLog?.text || null,
    };
  }

  /**
   * Analyze token quality for expected vs unexpected output
   * @param {Object} [options]
   * @param {string[]} [options.goodTokens] - Expected tokens for the test language
   * @param {string[]} [options.badTokens] - Unexpected tokens that indicate issues
   * @returns {{hasGood: boolean, hasBad: boolean, details: Object}}
   */
  analyzeTokenQuality(options = {}) {
    // Default test uses English prompts and expects English output.
    // Good tokens we expect for "the sky is" type prompts
    const goodTokens = options.goodTokens || [
      'blue', 'clear', 'beautiful', 'vast', 'bright',
      'dark', 'cloudy', 'night', 'day', 'color',
      'sky', 'The', 'is', 'a', 'the', 'usually', 'often',
    ];

    // Unexpected tokens for English output - indicate model/dequantization issues.
    // Non-English text or placeholder tokens suggest the model isn't working correctly.
    const badTokens = options.badTokens || [
      'thức',      // Vietnamese - unexpected for English prompt
      ')}"',       // Symbol sequence - likely tokenizer issue
      'už',        // Czech/Slovak - unexpected for English prompt
      '<unused',   // Placeholder tokens from vocab
      'unused>',
      'మా',        // Telugu - unexpected for English prompt
      'ನ',         // Kannada - unexpected for English prompt
      'ക',         // Malayalam - unexpected for English prompt
      '്',         // Malayalam virama - unexpected for English prompt
      '(?!',       // Regex pattern - indicates corruption
    ];

    const allText = this.logs.map(l => l.text).join(' ');

    const foundGood = goodTokens.filter(t =>
      allText.toLowerCase().includes(t.toLowerCase())
    );

    const foundBad = badTokens.filter(t => allText.includes(t));

    return {
      hasGood: foundGood.length > 0,
      hasBad: foundBad.length > 0,
      details: {
        goodTokensFound: foundGood,
        badTokensFound: foundBad,
      },
    };
  }

  /**
   * Print a summary of captured logs
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('CONSOLE CAPTURE SUMMARY');
    console.log('='.repeat(60));

    console.log(`Total logs: ${this.logs.length}`);
    console.log(`Errors: ${this.errors.length}`);

    // Logits info
    const logitsInfo = this.getLogitsInfo();
    if (logitsInfo.length > 0) {
      console.log('\nLogits/Top-5 samples:');
      logitsInfo.slice(0, 5).forEach(l => console.log('  ', l.tokens || l.raw));
    }

    // Generation output
    const output = this.getGenerationOutput();
    if (output.found) {
      console.log('\nGeneration output:', output.text);
    }

    // Token quality
    const quality = this.analyzeTokenQuality();
    console.log('\nToken quality:');
    console.log('  Good tokens found:', quality.details.goodTokensFound.join(', ') || 'none');
    console.log('  Bad tokens found:', quality.details.badTokensFound.join(', ') || 'none');

    // Errors
    if (this.errors.length > 0) {
      console.log('\nPage errors:');
      this.errors.forEach(e => console.log('  ', e));
    }

    console.log('='.repeat(60) + '\n');
  }
}

export default ConsoleCapture;
