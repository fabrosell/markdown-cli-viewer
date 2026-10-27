#!/usr/bin/env node
// mdview — render a Markdown file in the terminal.
//
// Modes:
//   Print (default):  render once to stdout and exit. Pipe-friendly.
//   Pager (--pager):  interactive full-screen scrollable view.
//   Watch (--watch):  interactive pager that auto-reloads on file change,
//                     preserving scroll position (or the closest surviving line).

import fs from 'node:fs';
import { render } from './renderer.js';
import { startPager } from './pager.js';

const HELP = `mdview — render Markdown in the terminal

Usage:
  mdview <file.md> [options]

Options:
  -w, --watch        Auto-reload on file change, keeping cursor/scroll position
                     (implies interactive pager). "Auto reload" mode.
  -p, --pager        Interactive full-screen scrollable view (no watching)
      --width <n>    Wrap content to <n> columns (default: terminal width, max 120)
      --no-color     Disable ANSI colors/styles (also honors NO_COLOR env)
  -n, --no-numbers   Hide the source line-number gutter (shown by default)
  -h, --help         Show this help

Keys (pager/watch mode):
  q quit   ↑/↓ or j/k scroll   space/b page   g/G top/bottom

Examples:
  mdview README.md
  mdview README.md --watch
  mdview notes.md --width 72 --no-color | less -R
`;

function parseArgs(argv) {
  const opts = { file: null, watch: false, pager: false, color: true, width: null, lineNumbers: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-w': case '--watch': opts.watch = true; break;
      case '-p': case '--pager': opts.pager = true; break;
      case '--no-color': opts.color = false; break;
      case '-n': case '--no-numbers': case '--no-line-numbers': opts.lineNumbers = false; break;
      case '--width': opts.width = parseInt(argv[++i], 10); break;
      default:
        if (a.startsWith('--width=')) opts.width = parseInt(a.slice(8), 10);
        else if (a.startsWith('-')) { console.error(`Unknown option: ${a}`); process.exit(2); }
        else if (!opts.file) opts.file = a;
        else { console.error(`Unexpected argument: ${a}`); process.exit(2); }
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || (!opts.file)) {
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : (opts.file ? 0 : 1));
  }

  if (process.env.NO_COLOR) opts.color = false;
  if (opts.width != null && (Number.isNaN(opts.width) || opts.width < 20)) {
    console.error('--width must be a number >= 20');
    process.exit(2);
  }

  if (!fs.existsSync(opts.file)) {
    console.error(`Error: file not found: ${opts.file}`);
    process.exit(1);
  }

  // Interactive modes require a TTY. If output is piped, fall back to print.
  const interactive = (opts.watch || opts.pager) && process.stdout.isTTY && process.stdin.isTTY;

  if (interactive) {
    startPager(opts.file, { color: opts.color, watch: opts.watch, width: opts.width, lineNumbers: opts.lineNumbers });
    return;
  }

  if ((opts.watch || opts.pager) && !process.stdout.isTTY) {
    console.error('(not a TTY — rendering once instead of interactive mode)');
  }

  let md;
  try {
    md = fs.readFileSync(opts.file, 'utf8');
  } catch (err) {
    console.error(`Error reading ${opts.file}: ${err.message}`);
    process.exit(1);
  }

  const width = opts.width || (process.stdout.columns ? Math.min(process.stdout.columns, 120) : 80);
  // Coerce to a real boolean: `opts.color && isTTY` can be `undefined` when
  // piped, which would otherwise fall through to render()'s `color = true`
  // default and leak ANSI escapes into non-terminal output.
  const color = Boolean(opts.color && process.stdout.isTTY);
  const output = render(md, { width, color, lineNumbers: opts.lineNumbers });
  process.stdout.write(output.endsWith('\n') ? output : output + '\n');
}

main();
