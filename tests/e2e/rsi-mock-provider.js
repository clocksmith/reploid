/**
 * Mock LLM Provider for RSI E2E Testing
 * Simulates LLM responses for testing the RSI loop without real inference.
 */

export const MockLLMProvider = {
  name: 'mock-llm',

  // Track calls for verification
  calls: [],
  responses: [],

  // Configurable response generator
  responseGenerator: null,

  reset() {
    this.calls = [];
    this.responses = [];
  },

  setResponseGenerator(fn) {
    this.responseGenerator = fn;
  },

  // Default responses for different task types
  defaultResponses: {
    'tool-improvement': `I'll improve the ReadFile tool to handle binary files more efficiently.

\`\`\`javascript
// tools/ReadFile.js - Enhanced version
export default async function ReadFile(args, deps) {
  const { path, encoding = 'utf-8' } = args;
  const { VFS } = deps;

  // Check if binary file
  const isBinary = /\\.(png|jpg|gif|pdf|bin|exe)$/i.test(path);

  if (isBinary) {
    const buffer = await VFS.readBinary(path);
    return {
      success: true,
      path,
      encoding: 'binary',
      size: buffer.byteLength,
      preview: \`[Binary file: \${buffer.byteLength} bytes]\`
    };
  }

  const content = await VFS.read(path);
  return {
    success: true,
    path,
    content,
    encoding,
    size: content.length
  };
}
\`\`\`

This improvement adds:
1. Binary file detection via extension
2. Separate handling for binary vs text files
3. Better metadata in response`,

    'code-fix': `Here's the fix:

\`\`\`javascript
// Fixed version
const result = data.map(item => item.value || 0);
\`\`\`

The issue was null handling.`,

    'default': `I understand. Here's my response based on the task.

\`\`\`javascript
// Implementation
export default function handler(args) {
  return { success: true, args };
}
\`\`\`
`
  },

  async chat(messages, modelConfig) {
    const call = {
      timestamp: Date.now(),
      messages,
      modelConfig
    };
    this.calls.push(call);

    // Simulate processing time
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

    // Get response content
    let content;
    if (this.responseGenerator) {
      content = await this.responseGenerator(messages, modelConfig);
    } else {
      // Use default based on message content
      const userMessage = messages.find(m => m.role === 'user')?.content || '';
      if (userMessage.includes('binary') || userMessage.includes('ReadFile')) {
        content = this.defaultResponses['tool-improvement'];
      } else if (userMessage.includes('fix') || userMessage.includes('bug')) {
        content = this.defaultResponses['code-fix'];
      } else {
        content = this.defaultResponses['default'];
      }
    }

    const response = {
      content,
      raw: content,
      model: modelConfig?.id || 'mock-model',
      provider: 'mock',
      usage: {
        inputTokens: messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0),
        outputTokens: content.length / 4
      }
    };

    this.responses.push(response);
    return response;
  },

  async *stream(messages, modelConfig) {
    const response = await this.chat(messages, modelConfig);
    const words = response.content.split(' ');
    for (const word of words) {
      await new Promise(r => setTimeout(r, 10));
      yield word + ' ';
    }
  },

  getCapabilities() {
    return {
      initialized: true,
      available: true,
      currentModelId: 'mock-model',
      TIER_NAME: 'Mock',
      TIER_LEVEL: 1
    };
  }
};

/**
 * Inject mock provider into page context
 */
export async function injectMockProvider(page) {
  await page.evaluate(() => {
    // Create mock provider directly in window context
    window.MockLLMProvider = {
      name: 'mock-llm',
      calls: [],
      responses: [],

      defaultResponses: {
        'tool-improvement': `I'll improve the ReadFile tool to handle binary files more efficiently.

\`\`\`javascript
// tools/ReadFile.js - Enhanced version
export default async function ReadFile(args, deps) {
  const { path, encoding = 'utf-8' } = args;
  const { VFS } = deps;

  // Check if binary file
  const isBinary = /\\.(png|jpg|gif|pdf|bin|exe)$/i.test(path);

  if (isBinary) {
    const buffer = await VFS.readBinary(path);
    return {
      success: true,
      path,
      encoding: 'binary',
      size: buffer.byteLength,
      preview: \`[Binary file: \${buffer.byteLength} bytes]\`
    };
  }

  const content = await VFS.read(path);
  return {
    success: true,
    path,
    content,
    encoding,
    size: content.length
  };
}
\`\`\`

This improvement adds:
1. Binary file detection via extension
2. Separate handling for binary vs text files
3. Better metadata in response`,

        'code-fix': `Here's the fix:

\`\`\`javascript
// Fixed version
const result = data.map(item => item.value || 0);
\`\`\`

The issue was null handling.`,

        'default': `I understand. Here's my response based on the task.

\`\`\`javascript
// Implementation
export default function handler(args) {
  return { success: true, args };
}
\`\`\`
`
      },

      async chat(messages, modelConfig) {
        const call = {
          timestamp: Date.now(),
          messages,
          modelConfig
        };
        this.calls.push(call);

        // Simulate processing time
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

        // Get response content based on message
        let content;
        const userMessage = messages.find(m => m.role === 'user')?.content || '';
        if (userMessage.includes('binary') || userMessage.includes('ReadFile')) {
          content = this.defaultResponses['tool-improvement'];
        } else if (userMessage.includes('fix') || userMessage.includes('bug')) {
          content = this.defaultResponses['code-fix'];
        } else {
          content = this.defaultResponses['default'];
        }

        const response = {
          content,
          raw: content,
          model: modelConfig?.id || 'mock-model',
          provider: 'mock',
          usage: {
            inputTokens: messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0),
            outputTokens: content.length / 4
          }
        };

        this.responses.push(response);
        return response;
      },

      getCapabilities() {
        return {
          initialized: true,
          available: true,
          currentModelId: 'mock-model',
          TIER_NAME: 'Mock',
          TIER_LEVEL: 1
        };
      }
    };

    window.MOCK_LLM_INJECTED = true;
  });
}
