import "client-only"

const themeEffectStyleId = "discloud-theme-transition-effect"

export const themeEffects = {
  triangle: {
    title: "Triangle",
    css: `
      ::view-transition-group(root) {
        animation-timing-function: var(--expo-out, cubic-bezier(0.16, 1, 0.3, 1));
      }
      ::view-transition-old(root),
      .dark::view-transition-old(root) {
        animation: none;
        animation-fill-mode: both;
        z-index: -1;
      }
      ::view-transition-new(root) {
        mask: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="m20 0 20 35H0z" fill="white"/></svg>') center / 0 no-repeat;
        animation: theme-transition-scale 0.7s;
        animation-fill-mode: both;
      }
      @keyframes theme-transition-scale {
        to { mask-size: 300vmax; }
      }
    `,
  },
  "triangle-blur": {
    title: "Triangle Blur",
    css: `
      ::view-transition-group(root) {
        animation-timing-function: var(--expo-out, cubic-bezier(0.16, 1, 0.3, 1));
      }
      ::view-transition-old(root),
      .dark::view-transition-old(root) {
        animation: none;
        animation-fill-mode: both;
        z-index: -1;
      }
      ::view-transition-new(root) {
        mask: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="m20 0 20 35H0z" fill="white" filter="url(%23blur)"/><defs><filter id="blur"><feGaussianBlur stdDeviation="1"/></filter></defs></svg>') center / 0 no-repeat;
        animation: theme-transition-scale 0.7s;
        animation-fill-mode: both;
      }
      @keyframes theme-transition-scale {
        to { mask-size: 300vmax; }
      }
    `,
  },
  circle: {
    title: "Circle",
    css: `
      ::view-transition-group(root) {
        animation-timing-function: var(--expo-out, cubic-bezier(0.16, 1, 0.3, 1));
      }
      ::view-transition-old(root),
      .dark::view-transition-old(root) {
        animation: none;
        animation-fill-mode: both;
        z-index: -1;
      }
      ::view-transition-new(root) {
        mask: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="white"/></svg>') center / 0 no-repeat;
        animation: theme-transition-scale 1s;
        animation-fill-mode: both;
      }
      @keyframes theme-transition-scale {
        to { mask-size: 200vmax; }
      }
    `,
  },
  "circle-blur": {
    title: "Circle Blur",
    css: `
      ::view-transition-group(root) {
        animation-timing-function: var(--expo-out, cubic-bezier(0.16, 1, 0.3, 1));
      }
      ::view-transition-old(root),
      .dark::view-transition-old(root) {
        animation: none;
        animation-fill-mode: both;
        z-index: -1;
      }
      ::view-transition-new(root) {
        mask: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs><circle cx="20" cy="20" r="18" fill="white" filter="url(%23blur)"/></svg>') center / 0 no-repeat;
        animation: theme-transition-scale 1s;
        animation-fill-mode: both;
      }
      .dark::view-transition-new(root) {
        animation: theme-transition-scale 1s;
        animation-fill-mode: both;
      }
      @keyframes theme-transition-scale {
        to { mask-size: 200vmax; }
      }
    `,
  },
  "circle-blur-top-left": {
    title: "Circle Blur Top Left",
    css: `
      ::view-transition-group(root) {
        animation-timing-function: var(--expo-out, cubic-bezier(0.16, 1, 0.3, 1));
      }
      ::view-transition-new(root) {
        mask: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs><circle cx="0" cy="0" r="18" fill="white" filter="url(%23blur)"/></svg>') top left / 0 no-repeat;
        mask-origin: content-box;
        animation: theme-transition-scale 1s;
        animation-fill-mode: both;
        transform-origin: top left;
      }
      ::view-transition-old(root),
      .dark::view-transition-old(root) {
        animation: theme-transition-scale 1s;
        animation-fill-mode: both;
        transform-origin: top left;
        z-index: -1;
      }
      @keyframes theme-transition-scale {
        to { mask-size: 350vmax; }
      }
    `,
  },
  polygon: {
    title: "Polygon",
    css: `
      ::view-transition-group(root) {
        animation-duration: 0.7s;
        animation-timing-function: var(--expo-out, cubic-bezier(0.16, 1, 0.3, 1));
      }
      ::view-transition-new(root) {
        animation-name: theme-transition-reveal-light;
        animation-fill-mode: both;
      }
      ::view-transition-old(root),
      .dark::view-transition-old(root) {
        animation: none;
        animation-fill-mode: both;
        z-index: -1;
      }
      .dark::view-transition-new(root) {
        animation-name: theme-transition-reveal-dark;
        animation-fill-mode: both;
      }
      @keyframes theme-transition-reveal-dark {
        from { clip-path: polygon(50% -71%, -50% 71%, -50% 71%, 50% -71%); }
        to { clip-path: polygon(50% -71%, -50% 71%, 50% 171%, 171% 50%); }
      }
      @keyframes theme-transition-reveal-light {
        from { clip-path: polygon(171% 50%, 50% 171%, 50% 171%, 171% 50%); }
        to { clip-path: polygon(171% 50%, 50% 171%, -50% 71%, 50% -71%); }
      }
    `,
  },
  "polygon-gradient": {
    title: "Polygon Gradient",
    css: `
      ::view-transition-group(root) {
        animation-timing-function: var(--expo-out, cubic-bezier(0.16, 1, 0.3, 1));
      }
      ::view-transition-new(root) {
        mask: url('data:image/svg+xml,<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0H40L0 40V0Z" fill="url(%23paint0_linear_16_14)"/><defs><linearGradient id="paint0_linear_16_14" x1="0" y1="0" x2="20.5" y2="20.5" gradientUnits="userSpaceOnUse"><stop stop-color="current"/><stop offset="0.84506" stop-color="current" stop-opacity="0.99"/><stop offset="0.9506" stop-color="current" stop-opacity="0"/><stop offset="1" stop-color="current" stop-opacity="0"/></linearGradient></defs></svg>') top left / 0 no-repeat;
        mask-origin: top left;
        animation: theme-transition-scale 1.5s;
        animation-fill-mode: both;
      }
      ::view-transition-old(root),
      .dark::view-transition-old(root) {
        animation: theme-transition-scale 1.5s;
        animation-fill-mode: both;
        z-index: -1;
        transform-origin: top left;
      }
      @keyframes theme-transition-scale {
        to { mask-size: 200vmax; }
      }
    `,
  },
  custom: {
    css: "",
  },
} as const

export type ThemeEffect = keyof typeof themeEffects

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown
}

export function applyThemeTransitionEffect(effect: ThemeEffect, customCSS: string) {
  let style = document.getElementById(themeEffectStyleId) as HTMLStyleElement | null

  if (!style) {
    style = document.createElement("style")
    style.id = themeEffectStyleId
    document.head.appendChild(style)
  }

  style.textContent = effect === "custom" ? customCSS : themeEffects[effect].css
}

export function removeThemeTransitionEffect() {
  document.getElementById(themeEffectStyleId)?.remove()
}

export function startThemeTransition(update: () => void) {
  const doc = document as ViewTransitionDocument
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (!doc.startViewTransition || reducedMotion) {
    update()
    return
  }

  doc.startViewTransition(update)
}