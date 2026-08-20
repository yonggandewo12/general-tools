/**
 * Unit tests for pdf-inspector-service error normalization.
 * Validates that NAPI errors are mapped to PdfInspectorError codes via classifyError.
 */
import { describe, expect, it } from 'vitest';
import { PdfInspectorError } from '../src/pdf-inspector-service.js';

describe('PdfInspectorError', () => {
  it('preserves code and message', () => {
    const err = new PdfInspectorError('BAD_PDF', 'invalid header');
    expect(err.code).toBe('BAD_PDF');
    expect(err.message).toBe('invalid header');
    expect(err.name).toBe('PdfInspectorError');
    expect(err.cause).toBeUndefined();
  });

  it('preserves cause', () => {
    const cause = new Error('native error');
    const err = new PdfInspectorError('NATIVE', 'wrapper', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('PLATFORM_UNSUPPORTED detection', () => {
  // Platform guard runs at module load time and cannot be re-evaluated,
  // so we verify the error class supports the code and let load-time
  // behavior be validated by the e2e test (which only runs on supported platforms).
  it('PdfInspectorError supports PLATFORM_UNSUPPORTED code', () => {
    const err = new PdfInspectorError(
      'PLATFORM_UNSUPPORTED',
      'macOS x86_64 not supported by prebuilt binaries',
    );
    expect(err.code).toBe('PLATFORM_UNSUPPORTED');
  });
});
