import { EditorView } from '@codemirror/view';

/**
 * Android Studio Dark Theme (Darcula / New UI).
 * Colors: slate gray #1e1f22, gutter #1e1f22, line #2b2d30, selection #214283.
 */
export const darculaTheme = EditorView.theme(
  {
    '&': {
      color: '#bcbec4',
      backgroundColor: '#1e1f22',
      height: '100%',
      fontSize: '13px',
      fontFamily: "'JetBrains Mono', monospace",
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: "'JetBrains Mono', monospace",
      lineHeight: '22px',
    },
    '.cm-content': {
      caretColor: '#ced0d6',
      padding: '6px 0',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#ced0d6',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: '#2e5788 !important',
    },
    '.cm-selectionBackground': {
      backgroundColor: '#264f78 !important',
    },
    '.cm-gutters': {
      backgroundColor: '#1e1f22',
      color: '#4e5157',
      borderRight: '1px solid #2b2d30',
      paddingRight: '8px',
    },
    '.cm-gutterElement': {
      paddingLeft: '12px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.04) !important',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#2b2d30 !important',
      color: '#a8adbd',
      fontWeight: '500',
    },
    '.cm-search-match': {
      backgroundColor: '#32593d !important',
      borderRadius: '2px',
    },
    '.cm-search-match-active': {
      backgroundColor: '#32593d !important',
      outline: '1.5px solid #ffffff !important',
      boxShadow: '0 0 5px rgba(255, 255, 255, 0.7) !important',
      borderRadius: '2px',
      zIndex: '5',
    },
    '.cm-vim-panel': {
      backgroundColor: '#1e1f22',
      color: '#dfe1e5',
      padding: '2px 8px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '12px',
      borderTop: '1px solid #2b2d30',
    },
    '.cm-vim-panel input': {
      color: '#dfe1e5',
      backgroundColor: 'transparent',
    },
    '.cm-flash-line': {
      backgroundColor: '#2b3b55 !important',
    },
    '.cm-ghost-text': {
      color: '#7d808a !important',
      opacity: '0.65',
      fontStyle: 'normal',
    },
    '.cm-foldPlaceholder': {
      background: '#2a2d32',
      border: '1px solid #3c3c3c',
      color: '#8b8f98',
      borderRadius: '3px',
      padding: '0 4px',
    },
  },
  { dark: true }
);
