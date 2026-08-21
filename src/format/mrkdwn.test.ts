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

    it('protects a fence indented by up to 3 spaces on both the opening and closing lines', () => {
      const input = ['  ```', '**x**', '  ```'].join('\n');
      const expected = ['```', '**x**', '```'].join('\n');
      expect(githubMarkdownToMrkdwn(input)).toBe(expected);
    });

    it('protects a fence opened at column 0 and closed with a 2-space-indented fence', () => {
      const input = ['```', '**x**', '  ```'].join('\n');
      const expected = ['```', '**x**', '```'].join('\n');
      expect(githubMarkdownToMrkdwn(input)).toBe(expected);
    });

    it('does not treat a 4-space-indented fence as a fence (CommonMark indented code block, deliberately unsupported)', () => {
      // With 4+ spaces of indentation this is an indented code block per
      // CommonMark, a construct this converter does not implement. The
      // line is left alone as plain text rather than being recognized as
      // a fence opener, so content after it still converts normally.
      const input = ['    ```', '**bold**'].join('\n');
      const expected = ['    ```', '*bold*'].join('\n');
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

    it('keeps a parenthesis inside the link destination instead of truncating at the first `)`', () => {
      expect(githubMarkdownToMrkdwn('[doc](https://example.test/a_(b)_*literal*)')).toBe(
        '<https://example.test/a_(b)_*literal*|doc>',
      );
    });

    it('handles a destination with nested parentheses', () => {
      expect(githubMarkdownToMrkdwn('[doc](x(y)z)')).toBe('<x(y)z|doc>');
    });

    it('does not let an escaped `\\)` inside the destination close the link early', () => {
      expect(githubMarkdownToMrkdwn('[doc](a\\)b)')).toBe('<a\\)b|doc>');
    });

    it('still excludes image syntax `![alt](url)` when the destination contains parentheses', () => {
      expect(githubMarkdownToMrkdwn('![alt](https://example.test/a_(b)_c)')).toBe(
        '![alt](https://example.test/a_(b)_c)',
      );
    });
  });
});

describe('link labels with brackets', () => {
  it('converts a label containing a nested bracket pair', () => {
    expect(githubMarkdownToMrkdwn('[outer [inner]](https://example.test)')).toBe(
      '<https://example.test|outer [inner]>',
    );
  });

  it('converts a label containing an escaped closing bracket', () => {
    expect(githubMarkdownToMrkdwn('[a\\]b](https://example.test)')).toBe(
      '<https://example.test|a\\]b>',
    );
  });

  it('still excludes image syntax with a bracketed alt text', () => {
    const input = '![alt [x]](https://example.test/img.png)';
    expect(githubMarkdownToMrkdwn(input)).toBe(input);
  });
});
