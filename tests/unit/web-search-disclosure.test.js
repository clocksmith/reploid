import { describe, expect, it } from 'vitest';
import { webSearchDisclosure, webSearchRecipient } from '../../apps/poolday/ui/pool-home/web-search-settings.js';

describe('Poolday web search recipient labels', () => {
  const builtIn = (provider, available = true) => ({ available: () => available, state: () => ({ provider }) });

  it('names the actual contributor engine in settings and the composer', () => {
    const google = 'contributor-google-browser', bing = 'contributor-bing';
    expect(webSearchDisclosure({}, builtIn(google))).toContain('Google in a dedicated browser');
    expect(webSearchDisclosure({}, builtIn(bing))).toContain('Bing');
    expect(webSearchRecipient({ route: 'contributor-search', provider: google })).toBe('the search contributor and Google');
    expect(webSearchRecipient({ route: 'contributor-search', provider: bing })).toBe('the search contributor and Bing');
  });

  it('names Brave only on a selected Brave route', () => {
    expect(webSearchDisclosure({}, builtIn('brave'))).toContain('query to Brave');
    expect(webSearchRecipient({ route: 'search', provider: 'brave' })).toBe('Brave Search');
    expect(webSearchRecipient({ route: 'contributor-search', provider: 'brave' })).toBeNull();
    expect(webSearchRecipient({ route: 'search', provider: 'searxng' })).toBeNull();
    expect(webSearchDisclosure({}, builtIn('brave', false))).toBe('Built-in search is unavailable.');
    expect(webSearchDisclosure({}, builtIn('searxng'))).not.toContain('Brave');
  });

  it('labels personal MCP with the configured recipient, independently of the built-in offer', () => {
    const url = 'https://mcp.example.test/search', recipient = 'mcp.example.test';
    expect(webSearchDisclosure({ url, recipient, enabled: true }, builtIn('contributor-google-browser'))).toContain(`goes to ${recipient}`);
    expect(webSearchRecipient({ route: 'contributor-search', provider: 'contributor-google-browser', personalRecipient: recipient })).toBe(recipient);
    expect(webSearchRecipient({ route: 'device-search', provider: 'contributor-bing' })).toBe('your configured search server');
  });
});
