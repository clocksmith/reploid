/** Detached, immutable JSON descriptions for application views. */
export function readonlyView(value) {
  const freeze = item => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(JSON.parse(JSON.stringify(value)));
}
