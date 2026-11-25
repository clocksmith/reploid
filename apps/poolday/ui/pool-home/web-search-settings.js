
const contributors = Object.freeze({
  'contributor-bing': 'Bing',
  'contributor-google-browser': 'Google'
});

export function webSearchRecipient({ personalRecipient, route, provider }) {
  if (personalRecipient) return personalRecipient;
  if (route === 'device-search') return 'your configured search server';
  if (route === 'contributor-search' && Object.hasOwn(contributors, provider)) return `the search contributor and ${contributors[provider]}`;
  if (route === 'search' && provider === 'brave') return 'Brave Search';
  return null;
}

export const webSearchDisclosure = (state, search) => {
  if (!state.url) {
    if (!search?.available()) return 'Built-in search is unavailable.';
    const provider = search.state().provider;
    if (Object.hasOwn(contributors, provider)) {
      const browser = provider === 'contributor-google-browser' ? ' in a dedicated browser' : '';
      return `A contributor searches ${contributors[provider]}${browser} and fetches public pages. Each answer names the contributor before sending your query.`;
    }
    return provider === 'brave' ? 'Use built-in web search. Each answer asks before sending your query to Brave.'
      : 'Built-in search recipient is not identified.';
  }
  return state.enabled
    ? `On. The text of each question you send goes to ${state.recipient} first. Its search results are added to the question as numbered sources. Turn off to stop.`
    : `Off. When on, the text of each question you send goes to ${state.recipient} first. Its search results are added to the question as numbered sources.`;
};
