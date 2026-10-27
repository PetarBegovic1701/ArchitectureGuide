type StructuredClone = <T>(value: T) => T;

/**
 * Deep copy with `structuredClone`, available in browsers and Node.js 17+.
 * Accessed through `globalThis` because core uses neither the DOM nor the Node.js type libraries.
 */
export const clone: StructuredClone = (value) =>
  (globalThis as unknown as { structuredClone: StructuredClone }).structuredClone(value);
