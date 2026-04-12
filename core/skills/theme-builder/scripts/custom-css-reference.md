# Custom CSS Reference

Adaptable CSS patterns for theme `custom_css` fields. Start from these,
adapt as needed — they're references, not rigid templates.

Replace `SLUG` with the theme's slug. Adjust opacity/blur values to taste.

---

## REQUIRED: Selection highlight (always include)

```css
::selection { background: rgba(ACCENT_R, ACCENT_G, ACCENT_B, 0.3); color: ACCENT_ON; }
```

---

## REQUIRED when theme has a pattern overlay

The pattern MUST be `body::after` (not `::before`) so it renders ON TOP of
the terminal's WebGL canvas. Omit entirely if the theme has no pattern.

```css
body::after {
  content: ''; position: fixed; inset: 0;
  background-image: url('theme-asset://SLUG/assets/pattern.svg');
  background-size: 30px 30px; background-repeat: repeat;
  opacity: 0.10;
  pointer-events: none; z-index: 0;
}
```

---

## Glassmorphism — DO NOT hand-write in `custom_css`

After the glassmorphism refactor, glass is driven entirely by manifest fields:

- `background.panels-blur` (px) — blur radius for header / status / input / popups
- `background.panels-opacity` (0–1) — panel color opacity on chrome + popups
- `background.bubble-blur` (px) — blur radius for chat bubbles
- `background.bubble-opacity` (0–1) — bubble color opacity

The app's `globals.css` reads these via always-on CSS vars (`--panels-blur`,
`--panels-opacity`, `--bubble-blur`, `--bubble-opacity`) and applies the right
`color-mix()` + `backdrop-filter` on every surface unconditionally. There is
NO `[data-panels-blur]` attribute gate anymore — rules based on it are dead.

**Rules for `custom_css`:**

- Never write `[data-panels-blur] { ... }` selectors. They match nothing.
- Never hardcode `backdrop-filter` on `.header-bar`, `.status-bar`,
  `.input-bar-container`, `.bg-inset`, `.bg-accent`, or `.layer-surface` —
  the app does it via the manifest vars.
- If you need different opacity on chrome vs. bubbles, use separate
  `panels-opacity` and `bubble-opacity` manifest values.
- `custom_css` is for *decorative* overlays only — glow effects, border
  accents, pattern overlays, theme-specific animations. Anything else.

Implicit opacity: if you set `panels-blur > 0` and omit `panels-opacity`,
the engine assumes `0.77`. Same for bubbles. Declare opacity explicitly if
you want a different feel.

---

## Optional: Decorative effects (include when they fit the theme)

### Themed scrollbar with SVG
```css
::-webkit-scrollbar-thumb { background-image: url('theme-asset://SLUG/assets/scrollbar-thumb.svg'); background-size: contain; }
::-webkit-scrollbar-track { background: transparent; }
```

### Custom cursor
```css
* { cursor: url('theme-asset://SLUG/assets/cursor.svg') 0 0, auto; }
```

### Glow effects on accent elements
```css
[data-theme="SLUG"] .bg-accent { box-shadow: 0 0 20px rgba(ACCENT_R, ACCENT_G, ACCENT_B, 0.4); }
```

### Animated gradient border on input
```css
[data-theme="SLUG"] .input-bar-container {
  border-image: linear-gradient(var(--angle, 0deg), ACCENT, ACCENT2) 1;
  animation: border-rotate 4s linear infinite;
}
@keyframes border-rotate { to { --angle: 360deg; } }
```

### Themed focus rings (buttons/links/selects only — NOT textarea/input)
```css
[data-theme="SLUG"] button:focus-visible,
[data-theme="SLUG"] a:focus-visible,
[data-theme="SLUG"] select:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
  box-shadow: 0 0 8px rgba(ACCENT_R, ACCENT_G, ACCENT_B, 0.3);
}
```

### Subtle text shadow on headings
```css
[data-theme="SLUG"] h1, [data-theme="SLUG"] h2 { text-shadow: 0 0 12px rgba(ACCENT_R, ACCENT_G, ACCENT_B, 0.2); }
```
