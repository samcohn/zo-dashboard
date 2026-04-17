import { CSSProperties } from 'react';

/**
 * Design tokens — black and white, thin, minimal.
 * Cardinal for display/headings, Diatype for body.
 */
export const tokens = {
  color: {
    bg: '#000000',
    surface: '#0a0a0a',
    surface2: '#111111',
    surface3: '#181818',
    border: 'rgba(255, 255, 255, 0.08)',
    borderHover: 'rgba(255, 255, 255, 0.2)',
    text: '#ffffff',
    textMuted: 'rgba(255, 255, 255, 0.5)',
    textDim: 'rgba(255, 255, 255, 0.25)',
    accent: '#ffffff',
    accentMuted: 'rgba(255, 255, 255, 0.08)',
    green: 'rgba(255, 255, 255, 0.8)',
    greenMuted: 'rgba(255, 255, 255, 0.06)',
    yellow: 'rgba(255, 255, 255, 0.5)',
    yellowMuted: 'rgba(255, 255, 255, 0.04)',
    red: 'rgba(255, 255, 255, 0.9)',
    redMuted: 'rgba(255, 255, 255, 0.08)',
    orange: 'rgba(255, 255, 255, 0.6)',
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    full: 9999,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  font: {
    display: '"Cardinal", Georgia, "Times New Roman", serif',
    body: '"Diatype", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
  },
} as const;

export const s = {
  card: {
    background: tokens.color.surface,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.lg,
  } as CSSProperties,

  badge: (color: string, bg: string) => ({
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: tokens.radius.full,
    color,
    background: bg,
    display: 'inline-block',
    fontFamily: tokens.font.body,
  }) as CSSProperties,

  label: {
    fontSize: 10,
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: tokens.color.textDim,
    fontFamily: tokens.font.body,
  } as CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space.sm,
  } as CSSProperties,

  col: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.space.md,
  } as CSSProperties,
};
