# markdown-cli-viewer (`mdview`)

Render a Markdown file in your terminal in a human-readable way:

- **Text wraps** to fit the viewable area — nothing runs off the right edge.
- **Full-justified** body paragraphs, flush to both the left and right margins.
- **Line-number gutter**: a fixed-width column of real source line numbers. A
  source line that wraps onto several visual lines is numbered only on its first
  line. Toggle off with `--no-numbers`.
- **Tables** render as vertically-aligned, box-drawn grids (not `col1 | col2`).
- **Styling**: bold, italic, strikethrough, inline code, headings, links, lists,
  code blocks, and blockquotes are rendered with ANSI, not raw markdown markers.
- **Auto-reload** (`--watch`): re-renders on every file change while keeping your
  scroll/cursor position — or the closest surviving line if the content moved.

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

| Key              | Action            |
| :--------------- | :---------------- |
| `q` / `Ctrl-C`   | quit              |
| `↑` `↓` / `k` `j`| scroll one line   |
| `space` / `b`    | page down / up    |
| `g` / `G`        | top / bottom      |

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
