// Markdown -> ANSI terminal string.
// Uses marked + marked-terminal for styling, with custom table and list
// renderers so tables align vertically (cli-table3) and list items get their
// inline markdown (bold/italic/code) properly styled.
//
// render() returns a plain string of ANSI-styled, width-wrapped lines. It does
// NOT print — callers own output, which keeps this reusable.

import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import Table from 'cli-table3';
import { Chalk } from 'chalk';

const ANSI_RE = /\[[0-9;]*m/g;
const displayWidth = (s) => s.replace(ANSI_RE, '').length;

// marked-terminal protects certain characters with internal sentinel tokens
// while it renders (e.g. it swaps ':' for *#COLON|* inside codespans so the
// emoji parser can't mistake `file:line` for a `:emoji:` shortcode). Those
// sentinels are normally undone by marked-terminal's own final transform, but
// our custom block renderers (paragraph/list/table) build output directly and
// bypass that step, so the raw tokens leak into the view. Restore them here as a
// final pass over the fully-rendered string. ANSI escape codes never contain
// these literals, so this is safe to run over styled output.
// Values mirror marked-terminal's constants (node_modules/marked-terminal/index.js).
const MT_PLACEHOLDERS = [
  ['*#COLON|*', ':'], // COLON_REPLACER -> literal colon
  ['^*||*^', ''],     // TABLE_CELL_SPLIT (orphaned outside our own table path)
  ['*|*|*|*', ''],    // TABLE_ROW_WRAP  (orphaned outside our own table path)
];
function restorePlaceholders(s) {
  let out = s;
  for (const [token, replacement] of MT_PLACEHOLDERS) {
    out = out.split(token).join(replacement);
  }
  return out;
}

// Full-justify a single visual line to `width` by distributing extra spaces
// evenly into the gaps between words. ANSI codes are preserved (they attach to
// their adjacent word and don't count toward width). Lines with a single word,
// or that already meet/exceed the width, are returned unchanged.
function justifyLine(line, width) {
  const trimmed = line.replace(/\s+$/, '');
  const cur = displayWidth(trimmed);
  if (cur >= width) return trimmed;

  const words = trimmed.split(/ +/).filter((w) => w.length > 0);
  const gaps = words.length - 1;
  if (gaps <= 0) return trimmed;

  const need = width - cur; // extra spaces to spread across the gaps
  const base = Math.floor(need / gaps);
  let extra = need % gaps; // the first `extra` gaps get one more space

  let out = words[0];
  for (let i = 1; i < words.length; i++) {
    const add = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out += ' '.repeat(1 + add) + words[i];
  }
  return out;
}

// Justify a wrapped block (visual lines separated by \n). Every line except the
// last is stretched to `width`; the last stays ragged (natural paragraph end).
function justifyBlock(text, width) {
  const lines = text.split('\n');
  return lines
    .map((l, i) => (i < lines.length - 1 ? justifyLine(l, width) : l.replace(/\s+$/, '')))
    .join('\n');
}

// Wrap a single logical string to a max display width (ignoring ANSI codes),
// breaking on spaces where possible. Falls back to hard-breaking over-long
// tokens. Preserves existing newlines (used for multi-line table cells).
function wrapText(text, width) {
  if (width <= 0) return text;
  const out = [];
  for (const rawLine of String(text).split('\n')) {
    if (displayWidth(rawLine) <= width) {
      out.push(rawLine);
      continue;
    }
    let line = '';
    let lineW = 0;
    for (const word of rawLine.split(/(\s+)/)) {
      if (word === '') continue;
      const wordW = displayWidth(word);
      if (wordW > width) {
        // Hard-break an over-long token (rare; e.g. a long URL).
        if (line) { out.push(line); line = ''; lineW = 0; }
        let rest = word;
        while (displayWidth(rest) > width) {
          out.push(rest.slice(0, width));
          rest = rest.slice(width);
        }
        line = rest;
        lineW = displayWidth(rest);
        continue;
      }
      if (/^\s+$/.test(word)) {
        // Whitespace chunk: keep only if it fits (drops trailing space at wrap).
        if (lineW + wordW <= width) { line += word; lineW += wordW; }
        continue;
      }
      if (lineW + wordW > width) {
        out.push(line.replace(/\s+$/, ''));
        line = word;
        lineW = wordW;
      } else {
        line += word;
        lineW += wordW;
      }
    }
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed) out.push(trimmed);
    else if (line === '') out.push('');
  }
  return out.join('\n');
}

// Custom table renderer using cli-table3 for real vertical alignment.
function renderTable(token, inline, width, color, c) {
  const alignMap = { left: 'left', right: 'right', center: 'center' };
  const colCount = token.header.length;

  // Budget content width to the viewport. cli-table3 chrome per column is
  // roughly 3 chars (border + 2 padding) plus one trailing border.
  const chromeWidth = colCount * 3 + 1;
  const contentBudget = Math.max(colCount * 3, width - chromeWidth);
  const maxColWidth = Math.max(3, Math.floor(contentBudget / colCount));

  const aligns = token.align.map((a) => alignMap[a] || 'left');

  const head = token.header.map((cell) =>
    c.bold(wrapText(restorePlaceholders(inline(cell.tokens)), maxColWidth))
  );

  const table = new Table({
    head,
    colAligns: aligns,
    style: { head: [], border: color ? ['grey'] : [] },
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },
  });

  for (const row of token.rows) {
    table.push(row.map((cell) => wrapText(restorePlaceholders(inline(cell.tokens)), maxColWidth)));
  }

  return '\n' + table.toString() + '\n\n';
}

/**
 * Render markdown source to an ANSI string.
 * @param {string} markdown - raw markdown
 * @param {object} opts
 * @param {number} opts.width - target content width in columns
 * @param {boolean} opts.color - whether to emit ANSI color/style
 * @returns {string}
 */
export function render(markdown, { width = 80, color = true, lineNumbers = true } = {}) {
  const c = new Chalk({ level: color ? 3 : 0 });
  const src = String(markdown).replace(/\r\n/g, '\n');

  // Gutter: a fixed-width column of source line numbers. Width is sized to the
  // largest line number in the file so the column is uniform top to bottom.
  const totalLines = src.split('\n').length;
  const numWidth = lineNumbers ? String(totalLines).length : 0;
  const gutterWidth = lineNumbers ? numWidth + 3 : 0; // "NNN │ "

  // The renderers wrap to the content area *left of* the gutter so the whole
  // line (gutter + content) fits within the requested viewport width.
  const contentWidth = Math.max(20, width - gutterWidth);
  let listDepth = 0; // tracks nesting to shrink wrap width for nested lists
  let quoteDepth = 0; // >0 while rendering inside a blockquote

  const marked = new Marked();

  marked.use(
    markedTerminal(
      {
        width: contentWidth,
        reflowText: true,
        tab: 2,
        firstHeading: c.magenta.bold.underline,
        heading: c.cyan.bold,
        code: c.yellow,
        blockquote: c.gray.italic,
        html: c.gray,
        hr: c.gray,
        strong: c.bold,
        em: c.italic,
        del: c.strikethrough,
        link: c.blue.underline,
        href: c.blue.underline,
        codespan: c.yellow,
      },
      undefined
    )
  );

  // Override table and list rendering so cells / items get styled inline
  // content. marked-terminal (with marked v15) renders these from raw text,
  // which leaves `**bold**` markers literal — parseInline fixes that.
  marked.use({
    useNewRenderer: true,
    renderer: {
      heading(token) {
        // Clean heading: colored + bold, no literal '#' markers. h1 underlined.
        const text = restorePlaceholders(this.parser.parseInline(token.tokens));
        const styled =
          token.depth === 1 ? c.magenta.bold.underline(text) : c.cyan.bold(text);
        return '\n' + styled + '\n\n';
      },
      blockquote(token) {
        // Render inner content with a left bar. Justification is disabled inside
        // quotes (the bar/indent would otherwise push justified lines past the
        // margin), so the body stays ragged-right within the quote.
        quoteDepth++;
        const inner = restorePlaceholders(this.parser.parse(token.tokens, true)).replace(/\n+$/, '');
        quoteDepth--;
        const bar = color ? c.gray('│ ') : '│ ';
        const lines = inner.split('\n').map((l) => bar + (color ? c.gray.italic(l) : l));
        return lines.join('\n') + '\n\n';
      },
      paragraph(token) {
        // Wrap to the content width, then full-justify every line except the
        // last so body text is flush against both margins. Soft line breaks in
        // the source (a paragraph hard-wrapped in the .md file) become spaces so
        // the whole paragraph reflows as one stream instead of per-source-line.
        // Inside a blockquote we skip justification and reserve room for the bar.
        const text = restorePlaceholders(this.parser.parseInline(token.tokens)).replace(/\s*\n\s*/g, ' ');
        const w = quoteDepth > 0 ? Math.max(8, contentWidth - 2 * quoteDepth) : contentWidth;
        const wrapped = wrapText(text, w);
        if (quoteDepth > 0) return wrapped + '\n\n';
        return justifyBlock(wrapped, w) + '\n\n';
      },
      table(token) {
        const inline = (tokens) => this.parser.parseInline(tokens);
        return renderTable(token, inline, contentWidth, color, c);
      },
      list(token) {
        const ordered = token.ordered;
        let start = Number(token.start);
        if (!Number.isFinite(start)) start = 1;
        // Nested lists are re-indented by 2 spaces per level after rendering,
        // so shrink the wrap width by the same amount to avoid orphaned words.
        listDepth++;
        const effectiveWidth = Math.max(20, contentWidth - (listDepth - 1) * 2);
        const lines = [];
        token.items.forEach((item, i) => {
          const marker = ordered ? c.cyan(`${start + i}.`) : c.cyan('•');
          const indent = ordered ? 3 + String(start + i).length : 4;
          const pad = ' '.repeat(indent + 2);

          // Split the item's tokens into its own inline text (wrapped under the
          // marker) and nested block content like sub-lists (already formatted;
          // just re-indented). Inline emphasis is styled via parseInline so
          // `**bold**` etc. don't leak as literal markers.
          let inlineStr = '';
          const blockStrs = [];
          for (const t of item.tokens) {
            if (t.type === 'text' && t.tokens) {
              inlineStr += this.parser.parseInline(t.tokens);
            } else if (t.type === 'text') {
              inlineStr += String(t.text);
            } else {
              blockStrs.push(this.parser.parse([t], !!item.loose).replace(/\n+$/, ''));
            }
          }

          // Continuation lines carry the widest prefix (`pad` = indent + 2), so
          // wrap to that constraint to keep every line within the viewport.
          const wrapped = wrapText(restorePlaceholders(inlineStr.trim()), Math.max(8, effectiveWidth - pad.length));
          const [first = '', ...rest] = wrapped.split('\n');
          lines.push(`  ${marker} ${first}`);
          for (const r of rest) lines.push(pad + r);

          // Nested blocks (e.g. sub-lists) are already indented internally by
          // their own renderer; add a little extra so they nest under this item.
          for (const block of blockStrs) {
            for (const bl of block.split('\n')) lines.push('  ' + bl);
          }
        });
        listDepth--;
        return lines.join('\n') + '\n\n';
      },
    },
  });

  // Render block-by-block so each block can be tagged with the source line it
  // begins on. Top-level tokens carry `.raw`; counting newlines through them
  // tracks the current source line exactly, so gutter numbers match the file.
  const tokens = marked.lexer(src);

  const gutterBlank = ' '.repeat(gutterWidth);
  const makeGutter = (lineNo) => {
    if (!lineNumbers) return '';
    const n = String(lineNo).padStart(numWidth);
    return color ? c.gray(`${n} │ `) : `${n} │ `;
  };

  const countNewlines = (s) => (String(s).match(/\n/g) || []).length;

  // Render one token's raw source to its visible lines (blank top/bottom
  // trimmed). Returns [] if the token produces no output.
  const renderBlockLines = (tok) => {
    const rendered = marked.parse(tok.raw, { async: false });
    const blockLines = String(rendered).replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
    if (blockLines.length === 1 && blockLines[0] === '') return [];
    return blockLines;
  };

  // Compute a source-line number (or null = blank gutter) for each visual line
  // of a rendered block. Strategy per type:
  //  - code:  each rendered line maps 1:1 to a source code line, so number every
  //           one (offset past the opening fence when present). Any extra lines
  //           beyond the source count (e.g. soft-wrapped) get null.
  //  - other: number the first visual line with the block's start line; the rest
  //           are wrap/reflow continuations and stay blank. (Lists are handled
  //           separately, per item, in the loop below.)
  const numbersForBlock = (tok, startLine, blockLines) => {
    if (tok.type === 'code') {
      const fenced = /^\s*(```|~~~)/.test(tok.raw);
      const firstContent = startLine + (fenced ? 1 : 0);
      const contentCount = countNewlines(tok.text) + 1; // code lines in source
      return blockLines.map((_, i) => (i < contentCount ? firstContent + i : null));
    }
    return blockLines.map((_, i) => (i === 0 ? startLine : null));
  };

  // Push a block's lines into the output with their gutter numbers.
  const pushBlock = (blockLines, numbers) => {
    blockLines.forEach((line, i) => {
      const n = numbers[i];
      outLines.push((n == null ? gutterBlank : makeGutter(n)) + line);
    });
  };

  const outLines = [];
  let srcLine = 1;
  for (const token of tokens) {
    const startLine = srcLine;
    // Advance the source-line counter by the newlines this token spans.
    srcLine += countNewlines(token.raw);

    if (token.type === 'space') continue; // blank lines produce no output

    if (token.type === 'list') {
      // Lists are numbered per item: render each item as its own single-item
      // list so we can tag the item's first visual line with its source line.
      // Nested content and wrapped lines within an item stay blank.
      let itemLine = startLine;
      token.items.forEach((item, idx) => {
        const subList = { ...token, items: [item], raw: item.raw };
        if (token.ordered) {
          const start = Number(token.start);
          subList.start = (Number.isFinite(start) ? start : 1) + idx;
        }
        const itemLines = renderBlockLines(subList);
        if (itemLines.length) {
          pushBlock(itemLines, itemLines.map((_, i) => (i === 0 ? itemLine : null)));
        }
        itemLine += countNewlines(item.raw);
      });
      outLines.push('');
      continue;
    }

    // Render this block through the full pipeline (marked-terminal styling +
    // our overrides) by re-parsing its raw source. Per-block rendering is what
    // lets us attach the correct source line number to each block's output.
    const blockLines = renderBlockLines(token);
    if (!blockLines.length) continue;

    pushBlock(blockLines, numbersForBlock(token, startLine, blockLines));
    outLines.push(''); // blank separator line (with no gutter) between blocks
  }

  // Trim a trailing blank separator and collapse any 3+ blank runs.
  while (outLines.length && outLines[outLines.length - 1] === '') outLines.pop();
  return restorePlaceholders(outLines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

export { wrapText };
