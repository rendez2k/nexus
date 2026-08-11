# Nexus icon set

The mark is a junction: one stem in at the bottom, fanning out to three
provider nodes. Colours track [`../brand/tokens.css`](../brand/tokens.css),
which is read off the desktop HUD so the icon and the widget stay one family —
near-black surface, one azure accent.

## Sources

Four hand-tuned SVGs. They are not scaled copies of each other: below about
32px the full mark's spokes disappear, so the small and tray variants carry
thicker strokes, larger nodes and a tighter hub.

| File | Use |
| --- | --- |
| `nexus.svg` | App icon, 48px and up. Gradient backdrop, glow, hairline edge. |
| `nexus-small.svg` | App icon, 16-32px. Same backdrop, fattened mark, inset to clear the corner radius. |
| `nexus-tray.svg` | Tray/menu bar. `currentColor`, no backdrop, tuned for a 16x16 slot. |
| `nexus-mark.svg` | Mark alone, `currentColor`, for docs and in-app UI. |

## Generated files

Everything below is built — edit the SVGs, never the PNGs.

```sh
npm i --no-save sharp png-to-ico
node assets/icon/build-icons.mjs
```

- `png/nexus-{16,24,32,48,64,128,256,512,1024}.png`
- `nexus.ico` — Windows app icon, 16-256 in one file
- `tray/nexus-trayTemplate.png` + `@2x` — macOS menu bar. The `Template`
  suffix is load-bearing: it is how AppKit (and Electron's `Tray`) know to
  invert the image for light and dark menu bars.
- `tray/nexus-tray-white.png` + `@2x` — Windows/Linux dark themes
- `tray/nexus-tray.ico` — Windows tray

## Two things that will bite you

**Gradients must be `gradientUnits="userSpaceOnUse"`.** The vertical stem is a
straight line, so its object bounding box has zero width. An
`objectBoundingBox` gradient on a degenerate box is undefined, and renderers
respond by dropping the path — the stem silently vanishes and the bottom node
floats unconnected. This is exactly what happened during the first build.

**Do not generate the tray PNGs by downscaling `nexus.svg`.** At 16px the
spokes fall below one pixel and the mark collapses into a blob. Use
`nexus-tray.svg`, which is drawn for that size. `build-icons.mjs` already
routes sizes at or under 32px to the small sources.
