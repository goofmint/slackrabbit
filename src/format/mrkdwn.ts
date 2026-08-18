/**
 * Converts GitHub Flavored Markdown (as used in CodeRabbit / GitHub review
 * comments) into Slack's `mrkdwn` format.
 *
 * The conversion runs in three stages:
 *
 * 1. **Stash code regions.** Fenced code blocks and inline code spans are
 *    cut out of the input and replaced with unique placeholder tokens
 *    (built from a NUL byte so they cannot collide with anything a human
 *    or a markdown renderer would type). This must happen first because
 *    code review notifications routinely contain snippets like `**ptr`
 *    (a C pointer dereference) or `_leading_underscore` identifiers that
 *    look exactly like markdown emphasis syntax. If those were left in
 *    place, stage 2 would happily "convert" them and corrupt the code.
 * 2. **Convert the remaining text.** With code safely out of the way,
 *    ordinary GFM constructs (headings, bold, italic, strikethrough,
 *    links) are rewritten into their Slack `mrkdwn` equivalents.
 * 3. **Restore the stashed code.** Inline code placeholders are restored
 *    first, then fenced code block placeholders, putting the original
 *    (untouched) code back into the converted text. Fenced code blocks
 *    are restored without their language tag, since Slack's ``` fences
 *    don't support one.
 */

const CODE_BLOCK_PATTERN = /```[^\n]*\n([\s\S]*?)```/g;
const INLINE_CODE_PATTERN = /`([^`\n]*)`/g;

const CODE_BLOCK_TOKEN = (index: number): string => `\u0000CODEBLOCK${index}\u0000`;
const INLINE_CODE_TOKEN = (index: number): string => `\u0000INLINE${index}\u0000`;

const CODE_BLOCK_TOKEN_PATTERN = /\u0000CODEBLOCK(\d+)\u0000/g;
const INLINE_CODE_TOKEN_PATTERN = /\u0000INLINE(\d+)\u0000/g;

// Temporary marker used between the bold and italic passes so that a
// `**bold**` span already converted to `*bold*`-shaped text doesn't get
// re-matched (and mangled) by the italic pass that runs right after it.
const BOLD_MARKER_PATTERN = /\u0001([\s\S]*?)\u0001/g;

const HEADING_PATTERN = /^#{1,6} +(.*)$/gm;
const DOUBLE_STAR_BOLD_PATTERN = /\*\*([^*]+?)\*\*/g;
const DOUBLE_UNDERSCORE_BOLD_PATTERN = /__([^_]+?)__/g;
const SINGLE_STAR_ITALIC_PATTERN = /\*([^*\n]+?)\*/g;
const STRIKETHROUGH_PATTERN = /~~([^~]+?)~~/g;
// Negative lookbehind excludes image syntax `![alt](url)`.
const LINK_PATTERN = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Converts a GitHub Flavored Markdown string into Slack `mrkdwn`.
 *
 * See the module-level comment for the three-stage design.
 */
export function githubMarkdownToMrkdwn(md: string): string {
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // Stage 1a: stash fenced code blocks (and drop their language tag).
  let text = md.replace(CODE_BLOCK_PATTERN, (_match: string, inner: string): string => {
    const token = CODE_BLOCK_TOKEN(codeBlocks.length);
    codeBlocks.push('```\n' + inner + '```');
    return token;
  });

  // Stage 1b: stash inline code spans.
  text = text.replace(INLINE_CODE_PATTERN, (_match: string, inner: string): string => {
    const token = INLINE_CODE_TOKEN(inlineCodes.length);
    inlineCodes.push('`' + inner + '`');
    return token;
  });

  // Stage 2.1: headings -> bold line. Uses the same temporary marker as
  // bold below (and is resolved together with it) so the single-asterisk
  // italic pass in stage 2.3 doesn't re-match the `*` it would otherwise
  // produce here.
  text = text.replace(HEADING_PATTERN, '\u0001$1\u0001');

  // Stage 2.2: bold (`**x**` / `__x__`) -> temporary marker, converted to
  // `*x*` after the italic pass below runs.
  text = text.replace(DOUBLE_STAR_BOLD_PATTERN, '\u0001$1\u0001');
  text = text.replace(DOUBLE_UNDERSCORE_BOLD_PATTERN, '\u0001$1\u0001');

  // Stage 2.3: italic. Only single-asterisk `*x*` needs conversion;
  // underscore italic `_x_` is already valid Slack mrkdwn and is left
  // untouched.
  text = text.replace(SINGLE_STAR_ITALIC_PATTERN, '_$1_');

  // Resolve the heading/bold marker now that the italic pass can no
  // longer see it.
  text = text.replace(BOLD_MARKER_PATTERN, '*$1*');

  // Stage 2.4: strikethrough.
  text = text.replace(STRIKETHROUGH_PATTERN, '~$1~');

  // Stage 2.5: links (image syntax `![alt](url)` is left as-is).
  text = text.replace(LINK_PATTERN, '<$2|$1>');

  // Stage 3: restore inline code, then fenced code blocks.
  text = text.replace(INLINE_CODE_TOKEN_PATTERN, (_match: string, index: string): string => {
    return inlineCodes[Number(index)] ?? '';
  });
  text = text.replace(CODE_BLOCK_TOKEN_PATTERN, (_match: string, index: string): string => {
    return codeBlocks[Number(index)] ?? '';
  });

  return text;
}
