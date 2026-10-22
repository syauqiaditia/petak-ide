import { EditorView } from '@codemirror/view';

/**
 * Android Studio Dark Theme (Darcula / New UI).
 * Colors: slate gray canvas #2b2d30, gutter #26282b, border #393b40, selection #353b4b (legacy: #1e1f22, #214283).
 */
export const darculaTheme = EditorView.theme(
  {
    '&': {
      color: '#dbdee1',
      backgroundColor: '#2b2d30',
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
      caretColor: '#3574f0',
      padding: '6px 0',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#3574f0',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: '#353b4b !important',
    },
    '.cm-selectionBackground': {
      backgroundColor: '#353b4b !important',
    },
    '.cm-gutters': {
      backgroundColor: '#26282b',
      color: '#949ba4',
      borderRight: '1px solid #393b40',
      paddingRight: '8px',
    },
    '.cm-gutterElement': {
      paddingLeft: '12px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.04) !important',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#323539 !important',
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
      backgroundColor: '#26282b',
      color: '#dbdee1',
      padding: '2px 8px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '12px',
      borderTop: '1px solid #393b40',
    },
    '.cm-vim-panel input': {
      color: '#dbdee1',
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
