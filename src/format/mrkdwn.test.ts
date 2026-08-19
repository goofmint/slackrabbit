import { describe, expect, it } from 'vitest';
import { githubMarkdownToMrkdwn } from './mrkdwn';

describe('githubMarkdownToMrkdwn', () => {
  it('converts an h1 heading to a bold line', () => {
    expect(githubMarkdownToMrkdwn('# Title')).toBe('*Title*');
  });

  it('converts an h3 heading to a bold line', () => {
    expect(githubMarkdownToMrkdwn('### Sub')).toBe('*Sub*');
  });

  it('converts double-star bold to single-star bold', () => {
    expect(githubMarkdownToMrkdwn('**bold**')).toBe('*bold*');
  });

  it('converts double-underscore bold to single-star bold', () => {
    expect(githubMarkdownToMrkdwn('__bold__')).toBe('*bold*');
  });

  it('converts single-star italic to underscore italic', () => {
    expect(githubMarkdownToMrkdwn('*italic*')).toBe('_italic_');
  });

  it('leaves underscore italic unchanged', () => {
    expect(githubMarkdownToMrkdwn('_italic_')).toBe('_italic_');
  });

  it('does not double-convert bold into `_*bold*_`', () => {
    const result = githubMarkdownToMrkdwn('**bold**');
    expect(result).toBe('*bold*');
    expect(result).not.toBe('_*bold*_');
  });

  it('converts strikethrough', () => {
    expect(githubMarkdownToMrkdwn('~~strike~~')).toBe('~strike~');
  });

  it('converts a link', () => {
    expect(githubMarkdownToMrkdwn('[text](https://x.y)')).toBe('<https://x.y|text>');
  });

  it('converts a fenced code block, dropping the language tag and leaving the contents untouched', () => {
    const input = '```ts\n**foo**\n```';
    const expected = '```\n**foo**\n```';
    expect(githubMarkdownToMrkdwn(input)).toBe(expected);
  });

  it('leaves inline code containing link-like syntax unchanged', () => {
    expect(githubMarkdownToMrkdwn('`[a](b)`')).toBe('`[a](b)`');
  });

  it('converts a mixed document in one pass', () => {
    const input = [
      '# Title',
      '',
      'Some **bold** and *italic* and __also bold__ and _also italic_ text.',
      '',
      'A ~~strikethrough~~ word and a [link](https://example.com).',
      '',
      '```js',
      'const x = **notActuallyBold;',
      '```',
      '',
      'Inline `code **stays** literal` here.',
    ].join('\n');

    const expected = [
      '*Title*',
      '',
      'Some *bold* and _italic_ and *also bold* and _also italic_ text.',
      '',
      'A ~strikethrough~ word and a <https://example.com|link>.',
      '',
      '```',
      'const x = **notActuallyBold;',
      '```',
      '',
      'Inline `code **stays** literal` here.',
    ].join('\n');

    expect(githubMarkdownToMrkdwn(input)).toBe(expected);
  });

  it('restores multiple code blocks and multiple inline codes in the right places', () => {
    const input = [
      'First `inline1` then a block:',
      '```',
      'block one contents',
      '```',
      'Then `inline2` and another block:',
      '```py',
      'block two contents',
      '```',
      'And a final `inline3`.',
    ].join('\n');

    const expected = [
      'First `inline1` then a block:',
      '```',
      'block one contents',
      '```',
      'Then `inline2` and another block:',
      '```',
      'block two contents',
      '```',
      'And a final `inline3`.',
    ].join('\n');

    expect(githubMarkdownToMrkdwn(input)).toBe(expected);
  });

  describe('fenced code block grammar', () => {
    it('keeps a nested triple-backtick span and formatting intact inside a quadruple-backtick fence', () => {
      const input = ['````ts', '```inner```', '**x**', '````'].join('\n');
      const expected = ['```', '```inner```', '**x**', '```'].join('\n');
      expect(githubMarkdownToMrkdwn(input)).toBe(expected);
    });

    it('protects a tilde-fenced code block', () => {
      const input = ['~~~', '**x**', '~~~'].join('\n');
      const expected = ['```', '**x**', '```'].join('\n');
      expect(githubMarkdownToMrkdwn(input)).toBe(expected);
    });

    it('protects an unclosed fence to the end of input', () => {
      const input = ['```', '**x**', 'still code'].join('\n');
      const expected = ['```', '**x**', 'still code', '```'].join('\n');
      expect(githubMarkdownToMrkdwn(input)).toBe(expected);
    });
  });

  describe('inline code spans with multiple backticks', () => {
    it('leaves a double-backtick span containing literal asterisks unchanged', () => {
      expect(githubMarkdownToMrkdwn('``**literal**``')).toBe('``**literal**``');
    });

    it('leaves a double-backtick span containing an inner single backtick unchanged', () => {
      expect(githubMarkdownToMrkdwn('`` a`b ``')).toBe('`` a`b ``');
    });

    it('still converts a plain single-backtick span', () => {
      expect(githubMarkdownToMrkdwn('`x`')).toBe('`x`');
    });
  });

  describe('link destination protection', () => {
    it('does not convert emphasis-like characters inside a link URL', () => {
      expect(githubMarkdownToMrkdwn('[doc](https://example.test/*literal*)')).toBe(
        '<https://example.test/*literal*|doc>',
      );
    });

    it('converts emphasis in the link text while leaving the URL untouched', () => {
      expect(githubMarkdownToMrkdwn('[**bold** text](https://x/_y_)')).toBe('<https://x/_y_|*bold* text>');
    });
  });
});
