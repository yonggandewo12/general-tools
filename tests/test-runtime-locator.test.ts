import { describe, it, expect } from 'vitest';
import {
  findChromiumExecutable,
  findEmbeddedPython,
  findHeadlessShellCache,
} from '../src/python-runner.js';

/**
 * findEmbeddedPython walks up node_modules looking for the runtime sub-package
 * (present via optionalDependencies in the test job). findChromiumExecutable /
 * findHeadlessShellCache look up the local Puppeteer cache and system Chrome.
 * These tests pin the contract: the locators never throw, and return null
 * (not found) or a well-formed path — never garbage.
 *
 * Chromium is intentionally NOT bundled in the npm tarballs (size limit); it
 * is installed once via `npx puppeteer browsers install chrome-headless-shell`
 * and cached in ~/.cache/puppeteer/.
 */
describe('embedded runtime locators', () => {
  it('findEmbeddedPython returns null or a valid python binary path, never throws', () => {
    const py = findEmbeddedPython();
    expect(() => findEmbeddedPython()).not.toThrow();
    if (py !== null) {
      expect(py.pythonBin.endsWith('python3.12') || py.pythonBin.endsWith('python.exe')).toBe(true);
    }
  });

  it('findHeadlessShellCache returns null or a valid headless-shell path, never throws', () => {
    expect(() => findHeadlessShellCache()).not.toThrow();
    const shell = findHeadlessShellCache();
    if (shell !== null) {
      expect(
        shell.endsWith('chrome-headless-shell') ||
          shell.endsWith('chrome-headless-shell.exe'),
      ).toBe(true);
    }
  });

  it('findChromiumExecutable returns null or a valid chromium path, never throws', () => {
    expect(() => findChromiumExecutable()).not.toThrow();
    const exe = findChromiumExecutable();
    if (exe !== null) {
      expect(exe.length > 0).toBe(true);
    }
  });
});
