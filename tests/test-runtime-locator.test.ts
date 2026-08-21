import { describe, it, expect } from 'vitest';
import { findEmbeddedChromium, findEmbeddedPython } from '../src/python-runner.js';

/**
 * findEmbeddedPython / findEmbeddedChromium walk up node_modules looking for
 * the platform runtime sub-package. In the unit-test job the runtime sub-package
 * is present (it ships via optionalDependencies) but the *new* chromium/ dir
 * only exists after the fixed build is published. These tests pin the contract:
 * the locators must never throw, and return null (not found) or a well-formed
 * path — never garbage.
 *
 * The chromium HIT branch (runtime present + chromium/ staged) is exercised
 * end-to-end by the publish workflow's "Verify executable bits in tarball"
 * step and the embedded-runtime smoke job.
 */
describe('embedded runtime locators', () => {
  it('findEmbeddedPython returns null or a valid python binary path, never throws', () => {
    const py = findEmbeddedPython();
    expect(() => findEmbeddedPython()).not.toThrow();
    if (py !== null) {
      expect(py.pythonBin.endsWith('python3.12') || py.pythonBin.endsWith('python.exe')).toBe(true);
    }
  });

  it('findEmbeddedChromium returns null or a valid headless-shell path, never throws', () => {
    expect(() => findEmbeddedChromium()).not.toThrow();
    const chrome = findEmbeddedChromium();
    if (chrome !== null) {
      expect(
        chrome.endsWith('chrome-headless-shell') ||
          chrome.endsWith('chrome-headless-shell.exe'),
      ).toBe(true);
    }
  });
});
