# markdown-cli-viewer (`mdview`)

Render a Markdown file in your terminal in a human-readable way:

- **Text wraps** to fit the viewable area — nothing runs off the right edge.
- **Full-justified** body paragraphs, flush to both the left and right margins.
- **Line-number gutter**: a fixed-width column of real source line numbers.
  Code blocks are numbered line-by-line, list items each get their source line,
  and headings/paragraphs/tables are numbered on their first line; soft-wrapped
  continuation lines get a blank gutter. Toggle off with `--no-numbers`.
- **Tables** render as vertically-aligned, box-drawn grids (not `col1 | col2`).
- **Styling**: bold, italic, strikethrough, inline code, headings, links, lists,
  code blocks, and blockquotes are rendered with ANSI, not raw markdown markers.
  Internal rendering placeholders (e.g. the colon in `file:line` code spans) are
  cleaned up so no sentinel tokens leak into the view.
- **Interactive pager** (`--pager`): full-screen scrollable view with a
  **vertical scrollbar** you can **click and drag** with the mouse, plus
  **mouse-wheel scrolling** (5 lines per notch).
- **Full-text search** in the pager: `Ctrl+F` or `/`, with a live `[3/10]` match
  counter, next/previous navigation, and highlighting — the current match stands
  out (black on yellow) from the other hits (reverse-video).
- **Auto-reload** (`--watch`): re-renders on every file change while keeping your
  scroll/cursor position — or the closest surviving line if the content moved.
  Search matches are recomputed automatically across reloads and resizes.

## Install

```bash
npm install
# optional: make `mdview` available globally
npm link
```

## Usage

```bash
mdview <file.md> [options]
# or without linking:
node src/cli.js <file.md> [options]
```

### Options

| Option           | Description                                                        |
| :--------------- | :---------------------------------------------------------------- |
| `-w`, `--watch`  | Auto-reload on change, preserving position ("auto reload" mode)   |
| `-p`, `--pager`  | Interactive scrollable view (no watching)                         |
| `--width <n>`    | Wrap to `n` columns (default: terminal width, capped at 120)      |
| `--no-color`     | Disable ANSI styling (also honors the `NO_COLOR` env var)         |
| `-n`, `--no-numbers` | Hide the source line-number gutter (shown by default)        |
| `-h`, `--help`   | Show help                                                          |

### Keys (pager / watch mode)

| Key                       | Action                                   |
| :------------------------ | :--------------------------------------- |
| `q` / `Ctrl-C`            | quit                                     |
| `↑` `↓` / `k` `j`         | scroll one line                          |
| `space` / `f` — `b`       | page down / page up                      |
| `PgDn` / `PgUp`           | page down / page up                      |
| `g` / `Home` — `G` / `End`| top / bottom                             |
| mouse wheel               | scroll 5 lines per notch                 |
| click / drag scrollbar    | jump to / scrub position                 |
| `Ctrl-F` / `/`            | open search                              |
| `n` / `F3` / `Ctrl-F`     | next match                               |
| `N` / `Shift-F3`          | previous match                           |
| `Esc`                     | cancel typing / clear active search      |

### Searching

Press `Ctrl-F` or `/` to open the search prompt, type a term, and press `Enter`
(case-insensitive). The status line shows the term and a `[current/total]` counter,
e.g. `/needle  [3/10]`. Step through hits with `n`/`F3` (next) and `N`/`Shift-F3`
(previous); navigation wraps around and scrolls the match into view. The current
match is highlighted black-on-yellow so it's easy to spot among the other
(reverse-video) matches. Press `Esc` to clear the search.

## Examples

```bash
mdview sample.md              # print once
mdview sample.md --pager      # scrollable view
mdview sample.md --watch      # live preview: edit in another window and watch it update
mdview sample.md --width 72 --no-color | less -R
```

## How position is preserved on reload

Raw line numbers are unreliable across a re-render (content above the viewport can
grow or shrink). Instead, `mdview` remembers the *text* at the top of the viewport,
and after re-rendering snaps to the line whose content matches — choosing the one
closest to the previous position, or the nearest surviving line if it's gone.

## Requirements

Node.js >= 18. Built on [`marked`](https://github.com/markedjs/marked),
[`marked-terminal`](https://github.com/mikaelbr/marked-terminal),
[`cli-table3`](https://github.com/cli-table/cli-table3), and
[`chalk`](https://github.com/chalk/chalk).
