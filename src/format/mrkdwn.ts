/**
 * Converts GitHub Flavored Markdown (as used in CodeRabbit / GitHub review
 * comments) into Slack's `mrkdwn` format.
 *
 * The conversion runs in three stages:
 *
 * 1. **Stash code and link regions.** Fenced code blocks, inline code
 *    spans, and links are cut out of the input and replaced with unique
 *    placeholder tokens (built from a NUL byte so they cannot collide with
 *    anything a human or a markdown renderer would type). This must happen
 *    first because code review notifications routinely contain snippets
 *    like `**ptr` (a C pointer dereference) or `_leading_underscore`
 *    identifiers that look exactly like markdown emphasis syntax, and link
 *    URLs routinely contain characters (`*`, `_`, `~`) that must never be
 *    touched by the emphasis passes. If those were left in place, stage 2
 *    would happily "convert" them and corrupt the code or the URL.
 *      - Fenced code blocks are found with a small line-by-line state
 *        machine (not a single regex) so the full CommonMark fence grammar
 *        is honored: an opening fence is a line starting with 3+ backticks
 *        OR 3+ tildes (optionally followed by an info string), and the
 *        matching closing fence must use the same character with a length
 *        greater than or equal to the opening length. A fence with no
 *        matching close runs to the end of the input. The block's contents
 *        are preserved verbatim; only the fence itself is normalized to
 *        Slack's plain ``` with the info string dropped.
 *      - Inline code spans are matched by delimiter run length (a run of
 *        N backticks opens, the next run of exactly N backticks - not part
 *        of a longer run - closes), matching CommonMark's code span rule
 *        instead of assuming a single backtick. Per CommonMark, a code
 *        span may contain newlines; this implementation allows that too
 *        rather than restricting spans to a single line.
 *      - Links (`[text](url)`, excluding image syntax `![alt](url)`) are
 *        stashed as a `{ text, url }` pair so the URL can be kept
 *        completely verbatim through stage 2, while the link text is run
 *        back through the same emphasis conversion in stage 3 so
 *        `[**bold**](url)` still renders bold inside the link.
 * 2. **Convert the remaining text.** With code and links safely out of the
 *    way, ordinary GFM constructs (headings, bold, italic, strikethrough)
 *    are rewritten into their Slack `mrkdwn` equivalents.
 * 3. **Restore the stashed regions.** Links are restored first (their
 *    display text converted through the same emphasis pipeline as stage 2,
 *    their URL untouched), then inline code, then fenced code blocks,
 *    putting the original (untouched) code back into the converted text.
 *    Fenced code blocks are restored without their language tag, since
 *    Slack's ``` fences don't support one.
 */

const NUL = String.fromCharCode(0);

const CODE_BLOCK_TOKEN = (index: number): string => `${NUL}CODEBLOCK${index}${NUL}`;
const INLINE_CODE_TOKEN = (index: number): string => `${NUL}INLINE${index}${NUL}`;
const LINK_TOKEN = (index: number): string => `${NUL}LINK${index}${NUL}`;

const CODE_BLOCK_TOKEN_PATTERN = new RegExp(`${NUL}CODEBLOCK(\\d+)${NUL}`, 'g');
const INLINE_CODE_TOKEN_PATTERN = new RegExp(`${NUL}INLINE(\\d+)${NUL}`, 'g');
const LINK_TOKEN_PATTERN = new RegExp(`${NUL}LINK(\\d+)${NUL}`, 'g');

// A code span opens with a run of N backticks and closes with the next run
// of exactly N backticks that isn't part of a longer run (CommonMark code
// span rule). Newlines are allowed inside a span, matching CommonMark.
const INLINE_CODE_PATTERN = /(`+)([\s\S]*?)\1(?!`)/g;

// A line that opens a fenced code block: 3+ backticks or 3+ tildes at the
// start of the line, optionally followed by an info string.
const FENCE_OPEN_PATTERN = /^(`{3,}|~{3,})/;

// Negative lookbehind excludes image syntax `![alt](url)`.
const LINK_PATTERN = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

// Temporary marker (SOH) used between the bold and italic passes so that a
// `**bold**` span already converted to `*bold*`-shaped text doesn't get
// re-matched (and mangled) by the italic pass that runs right after it.
const SOH = String.fromCharCode(1);
const BOLD_MARKER_PATTERN = new RegExp(`${SOH}([\\s\\S]*?)${SOH}`, 'g');

const HEADING_PATTERN = /^#{1,6} +(.*)$/gm;
const DOUBLE_STAR_BOLD_PATTERN = /\*\*([^*]+?)\*\*/g;
const DOUBLE_UNDERSCORE_BOLD_PATTERN = /__([^_]+?)__/g;
const SINGLE_STAR_ITALIC_PATTERN = /\*([^*\n]+?)\*/g;
const STRIKETHROUGH_PATTERN = /~~([^~]+?)~~/g;

interface StashedLink {
  text: string;
  url: string;
}

/**
 * Stashes fenced code blocks using a line-by-line scan so the full
 * CommonMark fence grammar (3+ backticks or tildes, closing fence must
 * match the opening character with length >= the opening length, unclosed
 * fences run to EOF) is honored rather than just exactly-three-backtick
 * fences. The block content is preserved verbatim; the emitted fence is
 * always normalized to plain ``` with the info string dropped.
 */
function stashCodeBlocks(text: string, codeBlocks: string[]): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const openMatch = FENCE_OPEN_PATTERN.exec(lines[i]);
    if (!openMatch) {
      output.push(lines[i]);
      i++;
      continue;
    }

    const fenceChar = openMatch[1][0];
    const fenceLen = openMatch[1].length;
    const closePattern = new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`);

    const contentLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && !closePattern.test(lines[j])) {
      contentLines.push(lines[j]);
      j++;
    }
    const closed = j < lines.length;
    const inner = contentLines.length > 0 ? contentLines.join('\n') + '\n' : '';

    const token = CODE_BLOCK_TOKEN(codeBlocks.length);
    codeBlocks.push('```\n' + inner + '```');
    output.push(token);

    // If unclosed, the block (and thus the scan) runs to end of input.
    i = closed ? j + 1 : lines.length;
  }

  return output.join('\n');
}

/** Stashes inline code spans, matching by delimiter run length. */
function stashInlineCode(text: string, inlineCodes: string[]): string {
  return text.replace(INLINE_CODE_PATTERN, (_match: string, backticks: string, inner: string): string => {
    const token = INLINE_CODE_TOKEN(inlineCodes.length);
    inlineCodes.push(backticks + inner + backticks);
    return token;
  });
}

/** Stashes links, keeping their text and URL separate. */
function stashLinks(text: string, links: StashedLink[]): string {
  return text.replace(LINK_PATTERN, (_match: string, linkText: string, url: string): string => {
    const token = LINK_TOKEN(links.length);
    links.push({ text: linkText, url });
    return token;
  });
}

/**
 * Converts GFM headings/bold/italic/strikethrough into Slack `mrkdwn`.
 * Shared between the main document pass and, during link restoration, the
 * stashed link display text (so `[**bold**](url)` still renders bold).
 */
function convertEmphasis(input: string): string {
  let text = input;

  // Headings -> bold line. Uses the same temporary marker as bold below
  // (and is resolved together with it) so the single-asterisk italic pass
  // doesn't re-match the `*` it would otherwise produce here.
  text = text.replace(HEADING_PATTERN, `${SOH}$1${SOH}`);

  // Bold (`**x**` / `__x__`) -> temporary marker, converted to `*x*` after
  // the italic pass below runs.
  text = text.replace(DOUBLE_STAR_BOLD_PATTERN, `${SOH}$1${SOH}`);
  text = text.replace(DOUBLE_UNDERSCORE_BOLD_PATTERN, `${SOH}$1${SOH}`);

  // Italic. Only single-asterisk `*x*` needs conversion; underscore italic
  // `_x_` is already valid Slack mrkdwn and is left untouched.
  text = text.replace(SINGLE_STAR_ITALIC_PATTERN, '_$1_');

  // Resolve the heading/bold marker now that the italic pass can no
  // longer see it.
  text = text.replace(BOLD_MARKER_PATTERN, '*$1*');

  // Strikethrough.
  text = text.replace(STRIKETHROUGH_PATTERN, '~$1~');

  return text;
}

/**
 * Converts a GitHub Flavored Markdown string into Slack `mrkdwn`.
 *
 * See the module-level comment for the three-stage design.
 */
export function githubMarkdownToMrkdwn(md: string): string {
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];
  const links: StashedLink[] = [];

  // Stage 1: stash fenced code blocks, then inline code spans, then links
  // (in that order, so link text/URLs already have any code spans they
  // contain replaced with opaque tokens before we snapshot them).
  let text = stashCodeBlocks(md, codeBlocks);
  text = stashInlineCode(text, inlineCodes);
  text = stashLinks(text, links);

  // Stage 2: convert the remaining text.
  text = convertEmphasis(text);

  // Stage 3a: restore links. The URL is restored verbatim; the display
  // text is converted through the same emphasis pipeline used above.
  text = text.replace(LINK_TOKEN_PATTERN, (_match: string, index: string): string => {
    const link = links[Number(index)];
    if (!link) return '';
    return `<${link.url}|${convertEmphasis(link.text)}>`;
  });

  // Stage 3b: restore inline code, then fenced code blocks.
  text = text.replace(INLINE_CODE_TOKEN_PATTERN, (_match: string, index: string): string => {
    return inlineCodes[Number(index)] ?? '';
  });
  text = text.replace(CODE_BLOCK_TOKEN_PATTERN, (_match: string, index: string): string => {
    return codeBlocks[Number(index)] ?? '';
  });

  return text;
}
