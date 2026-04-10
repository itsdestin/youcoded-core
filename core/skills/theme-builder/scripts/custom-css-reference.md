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

## REQUIRED when `panels-blur > 0` (glassmorphism)

When a theme has glassmorphism, all chrome layers above the wallpaper need
to be either transparent or frosted glass. Adjust opacity percentages:
- **Bars** (header, status, input): 78-88% panel opacity, blur 20-28px
- **Bubbles**: controlled by manifest `bubble-blur` / `bubble-opacity` fields —
  do NOT hardcode `.bg-inset` or `.bg-accent` blur/opacity here

```css
/* Transparent app shell so body wallpaper shows through */
[data-panels-blur] .app-shell { background-color: transparent !important; }

/* Header bar — frosted glass, chat scrolls underneath */
[data-panels-blur] .header-bar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 20;
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  background-color: color-mix(in srgb, var(--panel) 82%, transparent);
}

/* DO NOT add .chat-scroll padding — the app handles it automatically */

/* Status bar — frosted glass */
[data-panels-blur] .status-bar {
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  background-color: color-mix(in srgb, var(--panel) 82%, transparent);
}

/* Input bar — frosted glass (skip for minimal input-style) */
[data-panels-blur]:not([data-input-style="minimal"]) .border-t.shrink-0:has(form) {
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  background-color: color-mix(in srgb, var(--panel) 82%, transparent);
}
```

Notes:
- `color-mix(in srgb, var(--token) N%, transparent)` creates semi-transparent
  versions without needing to know RGB values
- `saturate(1.2)` boosts blurred wallpaper color through the frost
- Header becomes `position: absolute` so chat scrolls underneath
- Terminal view disables WebGL when glassmorphism is active — wallpaper shows
  through via DOM renderer. Patterns use `body::after` which renders on top

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
