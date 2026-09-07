import { describe, expect, it } from 'vitest';
import {
  countTokens,
  detectModelFamily,
  getModelTokenRatio,
  tokenize,
  toHighlightedHTML,
} from './tokenizer';

describe('multi-tokenizer engine', () => {
  it('detects model families from model strings', () => {
    expect(detectModelFamily('GPT-4o')).toBe('o200k');
    expect(detectModelFamily('gpt-4o-mini')).toBe('o200k');
    expect(detectModelFamily('gemini-2.5-flash')).toBe('gemini');
    expect(detectModelFamily('llama-3.3-70b-versatile')).toBe('llama');
    expect(detectModelFamily('claude-3-5-sonnet')).toBe('claude');
    expect(detectModelFamily('gpt-4')).toBe('cl100k');
    expect(detectModelFamily('')).toBe('cl100k');
    expect(detectModelFamily(undefined)).toBe('cl100k');
  });

  it('provides calibrated token ratios', () => {
    expect(getModelTokenRatio('gpt-4o')).toBe(0.88);
    expect(getModelTokenRatio('gemini-2.5-flash')).toBe(0.95);
    expect(getModelTokenRatio('llama-3.3')).toBe(0.96);
    expect(getModelTokenRatio('claude-3')).toBe(1.02);
    expect(getModelTokenRatio('gpt-4')).toBe(1.0);
  });

  it('counts tokens for empty and populated strings', () => {
    expect(countTokens('')).toBe(0);
    const count = countTokens('The quick brown fox jumps over the lazy dog.');
    expect(count).toBeGreaterThan(5);
  });

  it('applies model-aware scaling to token count', () => {
    const text = 'The quick brown fox jumps over the lazy dog repeatedly until the token count exceeds twenty.';
    const baseCount = countTokens(text);
    const gpt4oCount = countTokens(text, 'gpt-4o');

    expect(gpt4oCount).toBeLessThanOrEqual(baseCount);
  });

  it('tokenizes text and formats spans with highlight classes', () => {
    const tokens = tokenize('Hello world');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].text).toBeDefined();
    expect(tokens[0].colorClass).toContain('token-');

    const html = toHighlightedHTML('Hello world', true);
    expect(html).toContain('<span class="token-');
  });
});
