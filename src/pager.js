// Interactive full-screen pager with optional auto-reload on file change.
//
// Responsibilities:
//  - Draw rendered markdown into the alternate screen buffer.
//  - Scroll with keyboard (arrows, j/k, PgUp/PgDn, space, g/G, q).
//  - In watch mode, re-render when the file changes on disk and restore the
//    scroll position by anchoring to the content that was at the top of the
//    viewport — snapping to the closest surviving line if it moved or vanished.
//
// Position preservation strategy: raw line numbers are unreliable because a
// re-render can insert/remove lines above the viewport. Instead we remember the
// *text* of the line at the top of the viewport (stripped of ANSI + whitespace)
// and, after re-render, find the line whose content best matches, preferring the
// closest index to the old one. This keeps the reader anchored to the same block.

import fs from 'node:fs';
import readline from 'node:readline';
import { render } from './renderer.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s) => s.replace(ANSI, '');
// Strip a leading line-number gutter ("  45 │ ") so the scroll anchor matches on
// content, not the number — content survives across an edit even when its line
// number changes.
const stripGutter = (s) => s.replace(/^\s*\d+\s*│ /, '').replace(/^\s*│ /, '');
const norm = (s) => stripGutter(strip(s)).trim().replace(/\s+/g, ' ');

function readFileSafe(file) {
  return fs.readFileSync(file, 'utf8');
}

// Find the best line index in `lines` matching the remembered anchor text.
// Prefers exact normalized matches closest to `hintIdx`; falls back to hint.
function findAnchor(lines, anchorText, hintIdx) {
  if (!anchorText) return Math.min(hintIdx, Math.max(0, lines.length - 1));
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    if (norm(lines[i]) === anchorText) {
      const d = Math.abs(i - hintIdx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  if (best !== -1) return best;
  // No exact match: clamp the old index into range (closest surviving line).
  return Math.min(hintIdx, Math.max(0, lines.length - 1));
}

export function startPager(file, { color = true, watch = false, width, lineNumbers = true } = {}) {
  const out = process.stdout;

  const getWidth = () =>
    width || (out.columns ? Math.min(out.columns, 120) : 80);
  const viewHeight = () => Math.max(3, (out.rows || 24) - 1); // leave 1 row for status

  let lines = [];
  let top = 0; // index of first visible rendered line

  function rebuild(preservePos) {
    let anchorText = null;
    let anchorHint = top;
    if (preservePos && lines.length) {
      anchorText = norm(lines[Math.min(top, lines.length - 1)]);
      anchorHint = top;
    }

    let md;
    try {
      md = readFileSafe(file);
    } catch (err) {
      lines = [`\x1b[31mError reading ${file}: ${err.message}\x1b[0m`];
      top = 0;
      return;
    }
    const rendered = render(md, { width: getWidth(), color, lineNumbers });
    lines = rendered.split('\n');

    if (preservePos) {
      top = findAnchor(lines, anchorText, anchorHint);
    }
    clampTop();
  }

  function clampTop() {
    const maxTop = Math.max(0, lines.length - viewHeight());
    if (top > maxTop) top = maxTop;
    if (top < 0) top = 0;
  }

  function draw() {
    const h = viewHeight();
    clampTop();
    const slice = lines.slice(top, top + h);
    // Move home, clear screen, draw.
    let buf = '\x1b[H\x1b[2J';
    buf += slice.join('\n');
    // Pad remaining rows so stale content is cleared.
    const pad = h - slice.length;
    if (pad > 0) buf += '\n'.repeat(pad);

    // Status line (inverse video).
    const atBottom = top >= Math.max(0, lines.length - h);
    const pct = lines.length <= h ? 'ALL' : atBottom ? 'END' : `${Math.round((top / Math.max(1, lines.length - h)) * 100)}%`;
    const mode = watch ? ' [auto-reload] ' : ' ';
    const status = ` ${file}${mode}${pct}  (q quit  ↑↓/jk scroll  space/b page  g/G top/bottom) `;
    buf += `\n\x1b[7m${status.slice(0, out.columns || 80)}\x1b[0m`;
    out.write(buf);
  }

  // Terminal control sequences.
  // Mouse reporting: X11 button tracking (1000) reports wheel notches as button
  // presses (64 = up, 65 = down); SGR mode (1006) makes those reports arrive as
  // the parseable `ESC[<btn;x;y;M` form. We enable both so wheel events reach us
  // as data instead of the terminal translating a notch into a single arrow key
  // (which is what made scrolling crawl one line at a time).
  const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
  const MOUSE_OFF = '\x1b[?1000l\x1b[?1006l';
  const WHEEL_LINES = 5; // lines moved per wheel notch
  const ENTER = '\x1b[?1049h\x1b[?25l' + MOUSE_ON; // alt screen + hide cursor + mouse
  const LEAVE = MOUSE_OFF + '\x1b[0m\x1b[?25h\x1b[?1049l'; // mouse off, reset style, show cursor, leave alt screen

  // --- input handling ---
  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isTTY;
  if (wasRaw) process.stdin.setRawMode(true);
  process.stdin.resume();

  let watcher = null;
  let cleanedUp = false;
  // cleanup() runs the non-output teardown (watcher, stdin, raw mode) exactly
  // once and then writes the terminal-restore sequence. It returns the write's
  // completion callback registration via `onFlushed` so quit() can defer exit
  // until the bytes have actually left for the terminal.
  function cleanup(onFlushed) {
    if (cleanedUp) {
      // Already torn down (e.g. quit() then the 'exit' handler). The restore
      // sequence was already written; nothing left to flush.
      if (onFlushed) onFlushed();
      return;
    }
    cleanedUp = true;
    if (watcher) watcher.close();
    process.stdin.removeAllListeners('keypress');
    process.stdin.removeAllListeners('data');
    if (wasRaw && process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    process.stdin.pause();
    // Reset styles, restore the cursor, and leave the alternate screen so the
    // shell prompt returns to a clean, normal buffer. Pass the flush callback
    // straight to write() — it fires once the data is handed to the OS, which is
    // the signal quit() waits on before exiting.
    out.write(LEAVE, onFlushed);
  }

  function quit(code = 0) {
    // Exit only after the restore sequence has flushed. Writing to a TTY and
    // then calling process.exit() synchronously can truncate the escape codes
    // mid-sequence, leaving the terminal in the alternate screen with the cursor
    // hidden — the "no proper cleanup" symptom. A short timeout is a safety net
    // in case the flush callback never fires (e.g. a stuck pipe).
    let exited = false;
    const done = () => {
      if (exited) return;
      exited = true;
      process.exit(code);
    };
    cleanup(done);
    setTimeout(done, 200).unref?.();
  }

  const h = () => viewHeight();

  process.stdin.on('keypress', (str, key) => {
    if (!key) return;
    const name = key.name;
    if (key.ctrl && name === 'c') return quit(0);
    switch (name) {
      case 'q':
        return quit(0);
      case 'down':
      case 'j':
        top += 1; break;
      case 'up':
      case 'k':
        top -= 1; break;
      case 'space':
      case 'pagedown':
      case 'f':
        top += h() - 1; break;
      case 'b':
      case 'pageup':
        top -= h() - 1; break;
      case 'g':
        top = 0; break;
      case 'G':
        top = Math.max(0, lines.length - h()); break;
      case 'home':
        top = 0; break;
      case 'end':
        top = Math.max(0, lines.length - h()); break;
      default:
        if (str === 'G') top = Math.max(0, lines.length - h());
        else return;
    }
    draw();
  });

  // Mouse wheel: parse SGR mouse reports (ESC[<btn;x;y;M). Button 64 = wheel up,
  // 65 = wheel down; each notch moves WHEEL_LINES lines. We read these from the
  // raw data stream rather than keypress because readline doesn't surface mouse
  // reports as key events. A single data chunk can carry several notches, so we
  // scan them all and redraw once.
  const MOUSE_SGR = /\x1b\[<(\d+);\d+;\d+[Mm]/g;
  process.stdin.on('data', (data) => {
    const s = data.toString('latin1');
    if (s.indexOf('\x1b[<') === -1) return; // not a mouse report
    let m;
    let moved = false;
    MOUSE_SGR.lastIndex = 0;
    while ((m = MOUSE_SGR.exec(s)) !== null) {
      const btn = parseInt(m[1], 10);
      if (btn === 64) { top -= WHEEL_LINES; moved = true; }       // wheel up
      else if (btn === 65) { top += WHEEL_LINES; moved = true; }  // wheel down
    }
    if (moved) draw();
  });

  out.on('resize', () => {
    rebuild(true);
    draw();
  });

  // --- watch mode ---
  if (watch) {
    let debounce = null;
    try {
      watcher = fs.watch(file, () => {
        clearTimeout(debounce);
        // Debounce: editors often emit several events per save.
        debounce = setTimeout(() => {
          rebuild(true);
          draw();
        }, 80);
      });
    } catch {
      // If watching fails, degrade gracefully to a static view.
      watch = false;
    }
  }

  // Enter alternate screen (+ hide cursor) and do the first draw.
  out.write(ENTER);
  rebuild(false);
  draw();

  // Safety nets: always restore the terminal, however we leave. 'exit' runs the
  // synchronous cleanup; signals and crashes route through quit()/cleanup first.
  // Wrap cleanup so the exit code Node passes to the listener isn't forwarded as
  // the onFlushed callback (it's a number, not a function).
  process.on('exit', () => cleanup());
  process.on('SIGINT', () => quit(0));
  process.on('SIGTERM', () => quit(0));
  process.on('SIGHUP', () => quit(0));
  process.on('uncaughtException', (err) => {
    cleanup();
    console.error(err);
    process.exit(1);
  });
}
