# Markdown CLI Viewer

A demo document to exercise the renderer. This paragraph is intentionally long so
you can confirm that **text wrapping** works: it should never run past the right
edge of your terminal, and it should re-wrap when you resize the window or pass a
different `--width`.

## Text styling

You can use **bold**, *italic*, ***bold italic***, ~~strikethrough~~, and
`inline code`. Links render underlined, e.g. [Anthropic](https://www.anthropic.com).

## Lists

- First bullet with some **bold** inside
- Second bullet with `code` and *emphasis*
  - A nested item that is long enough to demonstrate that continuation lines are
    indented to line up under the item text rather than the bullet
- Third bullet

1. Ordered one
2. Ordered two
3. Ordered three

## A table

| Language   | Typing   | Runtime speed | Notes                         |
| :--------- | :------: | ------------: | :---------------------------- |
| Python     | dynamic  |          slow | great for scripting           |
| Rust       | static   |          fast | memory-safe without a GC      |
| JavaScript | dynamic  |        medium | ubiquitous in the browser     |
| Go         | static   |          fast | simple concurrency primitives |

## A markdown table - INTA Bordenave rainfall per month

  | Month | Average Rainfall (mm) |
  |-------|----------------------|
  | January | 64 |
  | February | 71 |
  | March | 84 |
  | April | 53 |
  | May | 32 |
  | June | 19 |
  | July | 18 |
  | August | 23 |
  | September | 47 |
  | October | 74 |
  | November | 73 |
  | December | 68 |

## Colons in inline code

These exercise the placeholder-restore pass. Each inline code span below contains
colons, which must render as real `:` characters (not the `*#COLON|*` sentinel):

- A `file:line` citation like `renderer.js:42` should keep its colon.
- A URL in code: `https://example.com:8080/path` keeps both colons.
- A time range `09:00–17:30` and a ratio `3:1` inside `08:15:00` all survive.

## Code block

```js
function greet(name) {
  // wrapped and styled as a block
  return `Hello, ${name}!`;
}
```

## Blockquote

> This is a blockquote. It should render with a left bar and italic gray text,
> wrapped to the viewport width just like normal paragraphs.

---

That's the end of the sample.
