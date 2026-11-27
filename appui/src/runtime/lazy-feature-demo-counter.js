// Loaded only when the LazyFeature gallery card is used.
export function createCounter() {
  let count = 0;
  return { next() { return ++count; } };
}
