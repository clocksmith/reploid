import { useEffect, useState } from 'react';
import type { Theme } from '@reploid/poolday-ui';
import { DesignPage, type TokenValueState } from '../features/design/presentation/DesignPage';
import { loadTokenValues } from '../features/design/infrastructure/tokenSource';
import { designIndex } from './designIndex.generated';
import { compositionSpecimens } from './designSpecimens';

const THEME_KEY = 'poolday-design:theme';

function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage is optional.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Composition root of /design: theme on the page root, token values from the served stylesheet. */
export function DesignApp() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [tokenValues, setTokenValues] = useState<TokenValueState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    loadTokenValues().then(
      (values) => live && setTokenValues({ status: 'ready', values }),
      () => live && setTokenValues({ status: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.reploidTheme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage is optional.
    }
  }, [theme]);

  return <DesignPage index={designIndex} tokenValues={tokenValues} compositions={compositionSpecimens} theme={theme} onTheme={setTheme} />;
}
