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

// Blank lines appended after the rendered content so the last document line can
// scroll past the status bar with breathing room rather than touching it.
const BOTTOM_PADDING = 3;

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

  // --- search state ---
  let query = '';        // active search term ('' = no search)
  let matches = [];      // [{ line, start, length }] in each line's VISIBLE (ANSI-stripped) coords
  let matchIdx = -1;     // index into matches of the current/focused match
  let searchMode = false;// true while the user is typing a query
  let searchInput = '';  // buffer shown in the prompt while typing
  let searchMsg = '';    // transient message (e.g. "No matches")

  // Find every occurrence of `query` (case-insensitive) across all lines, in
  // visible coordinates (ANSI stripped, gutter included) so offsets line up with
  // what highlightLine walks. Offsets include the gutter — searching plain words
  // is unaffected; only digit searches might incidentally hit a line number.
  function computeMatches() {
    matches = [];
    if (!query) { matchIdx = -1; return; }
    const needle = query.toLowerCase();
    for (let li = 0; li < lines.length; li++) {
      const vis = strip(lines[li]);
      const hay = vis.toLowerCase();
      let from = 0;
      let at;
      while ((at = hay.indexOf(needle, from)) !== -1) {
        matches.push({ line: li, start: at, length: query.length });
        from = at + Math.max(1, query.length);
      }
    }
  }

  // Scroll so the match at `matches[idx]` is comfortably in view, then focus it.
  function gotoMatch(idx) {
    if (!matches.length) return;
    matchIdx = ((idx % matches.length) + matches.length) % matches.length;
    const ln = matches[matchIdx].line;
    const h = viewHeight();
    if (ln < top || ln >= top + h) {
      top = Math.max(0, ln - Math.floor(h / 3));
    }
    clampTop();
  }

  // Run a fresh search for `q`: compute matches and jump to the first one at or
  // after the current viewport top (wrapping to the first overall otherwise).
  function runSearch(q) {
    query = q;
    computeMatches();
    searchMsg = '';
    if (!matches.length) {
      matchIdx = -1;
      searchMsg = `No matches for "${q}"  (Esc to close)`;
      return;
    }
    let idx = matches.findIndex((m) => m.line >= top);
    if (idx === -1) idx = 0;
    gotoMatch(idx);
  }

  // Wrap `line`'s match ranges in highlight attributes. Uses reverse-video
  // (SGR 7/27) so only the inverse bit toggles — surrounding color/bold from the
  // syntax styling survive untouched. The focused match adds bold (1/22) on top.
  function highlightLine(line, lineIdx) {
    if (!query) return line;
    const lm = matches.filter((m) => m.line === lineIdx);
    if (!lm.length) return line;
    lm.sort((a, b) => a.start - b.start);

    let out = '';
    let vis = 0;      // visible column walked so far
    let i = 0;        // byte index into the (ANSI-bearing) line
    let mi = 0;       // next match to open
    let open = null;  // currently open match or null
    let curEnd = -1;
    while (i < line.length) {
      if (line[i] === '\x1b') {
        const esc = line.slice(i).match(/^\x1b\[[0-9;]*m/);
        if (esc) { out += esc[0]; i += esc[0].length; continue; }
      }
      if (open && vis === curEnd) { out += open.post; open = null; }
      if (!open && mi < lm.length && vis === lm[mi].start) {
        const focused = matches[matchIdx] && matches[matchIdx].line === lineIdx && matches[matchIdx].start === lm[mi].start;
        // Non-focused matches: reverse-video (toggles only the inverse bit via
        // SGR 7/27, so surrounding syntax color/bold survive). The focused match
        // gets a distinct, high-contrast look — bold black text on a yellow
        // background — so it's unmistakable among several hits on one screen.
        open = focused
          ? { pre: '\x1b[1m\x1b[30m\x1b[43m', post: '\x1b[22m\x1b[39m\x1b[49m' }
          : { pre: '\x1b[7m', post: '\x1b[27m' };
        curEnd = lm[mi].start + lm[mi].length;
        out += open.pre;
        mi++;
      }
      out += line[i];
      i++;
      vis++;
    }
    if (open) out += open.post; // match ran to end of line
    return out;
  }

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
    // Append a few blank lines so the document's last line can scroll clear of
    // the status bar instead of sitting flush against it at END.
    for (let i = 0; i < BOTTOM_PADDING; i++) lines.push('');
    if (query) computeMatches(); // keep highlights/counts valid across re-render

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

  // Compute the scrollbar thumb's [start, end) row range within a viewport of
  // `h` rows showing `total` lines from offset `top`. Returns null when all
  // content fits (no scrollbar needed).
  function thumbRange(total, h, topIdx) {
    if (total <= h) return null;
    const size = Math.max(1, Math.round((h * h) / total));
    const maxStart = h - size;
    const scrollable = total - h;
    let start = Math.round((topIdx / scrollable) * maxStart);
    if (topIdx >= scrollable) start = maxStart; // pin to bottom at END
    if (start < 0) start = 0;
    return { start, end: start + size };
  }

  function draw() {
    const h = viewHeight();
    clampTop();
    const col = out.columns || 80;
    const slice = lines.slice(top, top + h);
    // Move home, clear screen, draw (highlighting search matches in view).
    // Reset SGR first: clearing the screen does NOT reset text attributes, so an
    // unbalanced style on the previous frame's last line (e.g. a stray underline)
    // would otherwise bleed into the top of this frame.
    let buf = '\x1b[0m\x1b[H\x1b[2J';
    buf += slice.map((line, i) => highlightLine(line, top + i)).join('\n');
    // Pad remaining rows so stale content is cleared.
    const pad = h - slice.length;
    if (pad > 0) buf += '\n'.repeat(pad);

    // Vertical scrollbar: overlay a single column on the far right using absolute
    // cursor addressing, so it sits atop the content without needing per-line
    // width math (content rarely reaches the last column). '█' = thumb, '░' =
    // track. Hidden entirely when everything fits.
    const thumb = thumbRange(lines.length, h, top);
    if (thumb) {
      for (let r = 0; r < h; r++) {
        const ch = r >= thumb.start && r < thumb.end ? '█' : '░';
        const cell = color ? `\x1b[90m${ch}\x1b[0m` : ch;
        buf += `\x1b[${r + 1};${col}H${cell}`;
      }
    }

    // Status line (inverse video), placed absolutely on the row below content.
    let status;
    if (searchMode) {
      // Live search prompt while typing.
      status = ` /${searchInput}_ `;
    } else if (query) {
      // Active search: show the term and current/total count.
      const count = matches.length ? `${matchIdx + 1}/${matches.length}` : '0/0';
      const hint = searchMsg || `(n/F3 next  N prev  Esc clear)`;
      status = ` /${query}  [${count}]  ${hint} `;
    } else {
      const atBottom = top >= Math.max(0, lines.length - h);
      const pct = lines.length <= h ? 'ALL' : atBottom ? 'END' : `${Math.round((top / Math.max(1, lines.length - h)) * 100)}%`;
      const mode = watch ? ' [auto-reload] ' : ' ';
      status = ` ${file}${mode}${pct}  (q quit  ↑↓/jk scroll  space/b page  g/G top/bottom  /^f find  r reload) `;
    }
    buf += `\x1b[${h + 1};1H\x1b[7m${status.slice(0, col)}\x1b[0m`;
    out.write(buf);
  }

  // Terminal control sequences.
  // Mouse reporting: X11 button tracking (1000) reports wheel notches as button
  // presses (64 = up, 65 = down); SGR mode (1006) makes those reports arrive as
  // the parseable `ESC[<btn;x;y;M` form. We enable both so wheel events reach us
  // as data instead of the terminal translating a notch into a single arrow key
  // (which is what made scrolling crawl one line at a time).
  // 1002 = button-event tracking: reports button press, release, AND motion
  // while a button is held (needed for click-and-drag on the scrollbar). 1006 =
  // SGR encoding so reports arrive as the parseable `ESC[<btn;x;y;M/m` form.
  const MOUSE_ON = '\x1b[?1002h\x1b[?1006h';
  const MOUSE_OFF = '\x1b[?1002l\x1b[?1006l';
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

  const nextMatch = () => { if (matches.length) { gotoMatch(matchIdx + 1); draw(); } };
  const prevMatch = () => { if (matches.length) { gotoMatch(matchIdx - 1); draw(); } };

  process.stdin.on('keypress', (str, key) => {
    if (!key) return;
    const name = key.name;
    if (key.ctrl && name === 'c') return quit(0);

    // --- search input mode: capture typing until Enter/Esc ---
    if (searchMode) {
      if (name === 'return' || name === 'enter') {
        searchMode = false;
        const q = searchInput;
        searchInput = '';
        if (q) runSearch(q);
        else { query = ''; matches = []; matchIdx = -1; }
        return draw();
      }
      if (name === 'escape') {
        searchMode = false;
        searchInput = '';
        return draw();
      }
      if (name === 'backspace') {
        searchInput = searchInput.slice(0, -1);
        return draw();
      }
      // Append any single printable character.
      if (str && str.length === 1 && str >= ' ' && !key.ctrl && !key.meta) {
        searchInput += str;
        return draw();
      }
      return; // ignore other keys while typing
    }

    // Open search: Ctrl+F (when no active search) or '/'.
    if ((key.ctrl && name === 'f') || str === '/') {
      if (key.ctrl && name === 'f' && query) return nextMatch(); // Ctrl+F repeats = next
      searchMode = true;
      searchInput = '';
      searchMsg = '';
      return draw();
    }

    // Search navigation (only meaningful with an active query).
    if (name === 'f3') return key.shift ? prevMatch() : nextMatch();
    if (query && (str === 'n' || (name === 'n' && !key.shift))) return nextMatch();
    if (query && (str === 'N' || (name === 'n' && key.shift))) return prevMatch();
    if (query && name === 'escape') { query = ''; matches = []; matchIdx = -1; return draw(); }

    // Manual reload: re-read and re-render the file, keeping the scroll position.
    if (str === 'r' || (name === 'r' && !key.ctrl && !key.meta)) {
      rebuild(true);
      return draw();
    }

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

  // Move `top` so the scrollbar thumb lands at viewport row `y` (1-based). Used
  // for click and drag on the scrollbar. Returns true if it could move.
  function setTopFromRow(y) {
    const h = viewHeight();
    const total = lines.length;
    const scrollable = total - h;
    if (scrollable <= 0) return false;
    const size = Math.max(1, Math.round((h * h) / total));
    const maxStart = Math.max(1, h - size);
    let r = y - 1;
    if (r < 0) r = 0;
    if (r > maxStart) r = maxStart;
    top = Math.round((r / maxStart) * scrollable);
    clampTop();
    return true;
  }

  // Mouse: parse SGR reports (ESC[<btn;x;y;M press / m release). We read these
  // from the raw data stream rather than keypress because readline doesn't
  // surface mouse reports as key events. A single chunk can carry several events,
  // so we scan them all and redraw once.
  //   btn 64/65         = wheel up/down -> scroll WHEEL_LINES lines.
  //   btn 0 (+32 motion) = left button press / drag -> grab the scrollbar.
  // Dragging latches on press over the scrollbar column; once grabbed, further
  // motion keeps steering it even if the pointer drifts off that column, until
  // release.
  const MOUSE_SGR = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let scrollDragging = false;
  process.stdin.on('data', (data) => {
    const s = data.toString('latin1');
    if (s.indexOf('\x1b[<') === -1) return; // not a mouse report
    let m;
    let moved = false;
    MOUSE_SGR.lastIndex = 0;
    while ((m = MOUSE_SGR.exec(s)) !== null) {
      const btn = parseInt(m[1], 10);
      const x = parseInt(m[2], 10);
      const y = parseInt(m[3], 10);
      const release = m[4] === 'm';
      if (btn === 64) { top -= WHEEL_LINES; moved = true; continue; }       // wheel up
      if (btn === 65) { top += WHEEL_LINES; moved = true; continue; }       // wheel down

      const base = btn & ~32;      // strip the "motion" bit
      const isMotion = (btn & 32) !== 0;
      if (base !== 0) continue;    // only the left button drives the scrollbar

      if (release) { scrollDragging = false; continue; }

      const col = out.columns || 80;
      const onBar = x >= col;      // scrollbar lives in the last column
      if (!isMotion) {
        // Fresh left press: grab only if it landed on the scrollbar.
        if (onBar && setTopFromRow(y)) { scrollDragging = true; moved = true; }
      } else if (scrollDragging) {
        // Drag in progress: keep steering regardless of column.
        if (setTopFromRow(y)) moved = true;
      }
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
