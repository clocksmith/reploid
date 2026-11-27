/**
 * The product's routes. The conversation workspace answers /, /network and /work; every other
 * route is a page of its own beneath the app bar. /history is the records page under another name.
 */
export type PageRoute = 'ask' | 'compute' | 'improve' | 'examples' | 'records' | 'room-1' | 'experiments';
export type ProductRoute = 'workspace' | PageRoute;

const PATHS: Readonly<Record<string, ProductRoute>> = {
  '/': 'workspace',
  '/network': 'workspace',
  '/work': 'workspace',
  '/ask': 'ask',
  '/compute': 'compute',
  '/improve': 'improve',
  '/examples': 'examples',
  '/records': 'records',
  '/history': 'records',
  '/room-1': 'room-1',
  '/experiments': 'experiments',
};

/** The route a path shows; an unknown path shows the workspace, as the vanilla shell did. */
export const routeForPath = (pathname: string): ProductRoute => PATHS[pathname.replace(/\/+$/, '') || '/'] ?? 'workspace';
