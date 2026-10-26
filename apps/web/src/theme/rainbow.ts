import { lightTheme, type Theme } from '@rainbow-me/rainbowkit'

/*
 * RainbowKit, themed with the app's semantic CSS variables (src/styles.css). Every colour is a variable, so one theme
 * follows the reader's colour scheme on its own: paper in light mode, Intaglio in dark mode. The stock ConnectButton
 * and modal stay as they are (the e2e drives their test ids and roles); only their paint changes.
 */

const base = lightTheme({ borderRadius: 'medium', fontStack: 'system', overlayBlur: 'small' })

export const rainbowTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: 'var(--brand)',
    accentColorForeground: 'var(--on-brand)',
    actionButtonBorder: 'var(--line)',
    actionButtonBorderMobile: 'var(--line)',
    actionButtonSecondaryBackground: 'var(--raised)',
    closeButton: 'var(--muted)',
    closeButtonBackground: 'var(--raised)',
    connectButtonBackground: 'var(--surface)',
    // Wrong network: Note on Seal Red (4.67:1 in both schemes).
    connectButtonBackgroundError: 'var(--seal)',
    connectButtonInnerBackground: 'var(--raised)',
    connectButtonText: 'var(--ink)',
    connectButtonTextError: 'var(--on-bad)',
    connectionIndicator: 'var(--good)',
    downloadBottomCardBackground: 'var(--surface)',
    downloadTopCardBackground: 'var(--raised)',
    error: 'var(--bad)',
    generalBorder: 'var(--line)',
    generalBorderDim: 'var(--line)',
    menuItemBackground: 'var(--raised)',
    modalBackdrop: 'color-mix(in srgb, var(--intaglio) 55%, transparent)',
    modalBackground: 'var(--surface)',
    modalBorder: 'var(--line)',
    modalText: 'var(--ink)',
    modalTextDim: 'var(--faint)',
    modalTextSecondary: 'var(--muted)',
    profileAction: 'var(--raised)',
    profileActionHover: 'var(--brand-soft)',
    profileForeground: 'var(--surface)',
    selectedOptionBorder: 'var(--brand)',
    standby: 'var(--warn)',
  },
  fonts: { body: 'var(--font-body)' },
  radii: {
    actionButton: '10px',
    connectButton: '10px',
    menuButton: '10px',
    modal: '16px',
    modalMobile: '16px',
  },
  shadows: {
    ...base.shadows,
    // The topbar button sits on the base-rate line; it is printed, not floating.
    connectButton: 'none',
  },
}
