// viewport presets + flag -> viewport resolution.

export const VIEWPORTS = {
  "desktop-1280":  { width: 1280, height: 800,  dpr: 1, label: "Desktop 1280x800" },
  "desktop-1440":  { width: 1440, height: 900,  dpr: 1, label: "Desktop 1440x900" },
  "desktop-1920":  { width: 1920, height: 1080, dpr: 1, label: "Desktop 1920x1080" },
  "desktop-2560":  { width: 2560, height: 1440, dpr: 1, label: "QHD 2560x1440" },
  "ultrawide-3440":{ width: 3440, height: 1440, dpr: 1, label: "Ultrawide 3440x1440" },
  "tablet-768":    { width: 768,  height: 1024, dpr: 2, label: "Tablet portrait 768x1024 @2x" },
  "tablet-1024":   { width: 1024, height: 768,  dpr: 2, label: "Tablet landscape 1024x768 @2x" },
  "mobile-375":    { width: 375,  height: 812,  dpr: 3, label: "iPhone X 375x812 @3x" },
  "mobile-414":    { width: 414,  height: 896,  dpr: 3, label: "iPhone XR 414x896 @3x" },
  "mobile-360":    { width: 360,  height: 800,  dpr: 2, label: "Android 360x800 @2x" },
};

export const DEFAULT_VIEWPORT = VIEWPORTS["desktop-1280"];

import { listViewportPresets } from "./plugin.js";

export function listViewports() {
  return Object.entries({ ...VIEWPORTS, ...listViewportPresets() }).map(([k, v]) => ({ name: k, ...v }));
}

function asNum(v, dflt) {
  if (v === undefined || v === null) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function resolveViewport(flags = {}) {
  const all = { ...VIEWPORTS, ...listViewportPresets() };
  const name = flags.preset || flags.viewport;
  if (name && all[name]) return { ...all[name], name };
  if (flags.width || flags.height) {
    return {
      name: "custom",
      label: `Custom ${flags.width}x${flags.height}`,
      width: asNum(flags.width, DEFAULT_VIEWPORT.width),
      height: asNum(flags.height, DEFAULT_VIEWPORT.height),
      dpr: asNum(flags.dpr, 1),
    };
  }
  return { ...DEFAULT_VIEWPORT, name: "desktop-1280" };
}