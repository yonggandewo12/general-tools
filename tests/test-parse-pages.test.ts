import { describe, expect, it } from 'vitest';
import { parsePages } from '../src/pdf-extract-adapter.js';

describe('parsePages', () => {
  it('returns undefined for empty input', () => {
    expect(parsePages(undefined)).toBeUndefined();
    expect(parsePages('')).toBeUndefined();
  });

  it('parses single page', () => {
    expect(parsePages('1')).toEqual([1]);
    expect(parsePages('42')).toEqual([42]);
  });

  it('parses comma-separated list', () => {
    expect(parsePages('1,3,5')).toEqual([1, 3, 5]);
  });

  it('parses range', () => {
    expect(parsePages('1-5')).toEqual([1, 2, 3, 4, 5]);
    expect(parsePages('10-12')).toEqual([10, 11, 12]);
  });

  it('parses combined ranges and singletons', () => {
    expect(parsePages('1-5,10,15-20')).toEqual([1, 2, 3, 4, 5, 10, 15, 16, 17, 18, 19, 20]);
  });

  it('dedupes overlapping ranges', () => {
    expect(parsePages('1-5,3-7')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('trims whitespace', () => {
    expect(parsePages(' 1 , 3 - 5 ')).toEqual([1, 3, 4, 5]);
  });

  it('rejects invalid range', () => {
    expect(() => parsePages('abc')).toThrow(/Invalid page range/);
    expect(() => parsePages('1-')).toThrow(/Invalid page range/);
    expect(() => parsePages('-5')).toThrow(/Invalid page range/);
    expect(() => parsePages('5-1')).toThrow(/Invalid page range/);
    expect(() => parsePages('0')).toThrow(/Invalid page range/);
    expect(() => parsePages('-1')).toThrow(/Invalid page range/);
    expect(() => parsePages('1,')).toThrow(/Invalid page range/);
  });

  it('rejects non-decimal-integer tokens', () => {
    expect(() => parsePages('1e3')).toThrow(/Invalid page range/);
    expect(() => parsePages('5.0')).toThrow(/Invalid page range/);
    expect(() => parsePages('0x10')).toThrow(/Invalid page range/);
    expect(() => parsePages('Infinity')).toThrow(/Invalid page range/);
    expect(() => parsePages('  ')).toThrow(/Invalid page range/);
    expect(() => parsePages('1.5')).toThrow(/Invalid page range/);
    expect(() => parsePages('+5')).toThrow(/Invalid page range/);
  });

  it('rejects overflow tokens that exceed Number.MAX_SAFE_INTEGER', () => {
    expect(() => parsePages('999999999999999999999')).toThrow(/Invalid page range/);
    expect(() => parsePages('1-999999999999999999999')).toThrow(/Invalid page range/);
  });

  it('accepts large but finite page numbers', () => {
    expect(parsePages('1000000')).toEqual([1000000]);
  });

  it('rejects ranges that expand beyond the selection limit', () => {
    expect(() => parsePages('1-1000000000')).toThrow(/more than \d+ pages/);
    expect(() => parsePages('1-50000,60000-200000')).toThrow(/more than \d+ pages/);
  });
});
