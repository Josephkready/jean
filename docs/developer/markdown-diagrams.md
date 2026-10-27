# Mermaid diagrams in messages

The shared `Markdown` component recognizes fenced code blocks with the
`mermaid` language. Unfenced text and other code blocks are unchanged.
This applies to desktop, Web Access, compact/mobile, and tool-call Markdown.

`MermaidBlock` is lazy-loaded only for completed messages containing diagrams.
During streaming, the original code block stays visible; incomplete diagrams
are not parsed. Completed diagrams provide a single-selection Diagram/Code segmented control,
icon actions with tooltips and accessible names for clipboard copy through the
shared native/web helper, and an accessible enlarged dialog. Icon actions use
44px targets on mobile.
Invalid syntax falls back to readable source without breaking the message.

Diagrams render with [Pele](https://pele.run/) (`pele`, pinned), a
dependency-free Mermaid-syntax renderer. Its own layout engine means diagrams
do not match mermaid.js pixel for pixel. The module is imported once on the
first diagram; after that, `render()` is synchronous and runs during render
(`useMemo`), so remounts such as session switches keep their height without a
cache. A failed module load is retried on the next mount. Each block passes a
unique `idPrefix` (from `useId`) and the body font as `fontFamily`, because
Pele measures text with that font and embeds it in the SVG.

Theming uses CSS variables only: `.pele` in `src/App.css` maps `--pele-*` to the
app theme tokens, so light/dark switches need no re-render. Mermaid themes and
`themeVariables` in diagram directives have no effect.

Treat diagram source as untrusted: render with `links: false` and
`images: false`, and sanitize the SVG with DOMPurify before insertion. Scripts,
links, embedded frames, external images, and SVG foreignObjects are disallowed.
Pele ignores `click` JavaScript callbacks and only emits SVG text labels.
Parser errors (`PeleError`) are shown as React text, never as HTML, because
they contain diagram source.

Tests: `markdown-mermaid.test.tsx` covers routing and streaming;
`mermaid-block.test.tsx` runs the real Pele renderer (jsdom falls back to its
built-in text width table) and covers controls, failures, sanitization, and
synchronous remounts. They do not replace real-browser checks of layout.
