import { describe, expect, it } from 'vitest';

// Guards the test runner itself. `vitest run` exits non-zero when the include
// glob matches nothing, so this file is what makes a green `npm test` mean
// "tests ran and passed" rather than "no tests were found".
describe('test harness', () => {
  it('collects and executes TypeScript test files', () => {
    const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

    expect(sum([1, 2, 3])).toBe(6);
  });
});
