import { EditorView } from '@codemirror/view';

export const lintTheme = EditorView.theme({
  '.cm-lintRange-error': {
    textDecoration: 'underline wavy #f07a74',
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  '.cm-lintRange-warning': {
    textDecoration: 'underline wavy #e8b45a',
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  '.cm-lintRange-info': {
    textDecoration: 'underline wavy #6ea8ff',
    textUnderlineOffset: '3px',
  },
  '.cm-gutter-lint': {
    width: '16px',
    paddingLeft: '4px',
  },
  '.cm-gutter-lint .cm-gutterElement': {
    padding: '0 2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-lint-marker': {
    width: '12px',
    height: '12px',
  },
  '.cm-lint-marker-error': {
    content: '""',
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '4px',
    backgroundColor: '#f07a74',
  },
  '.cm-lint-marker-warning': {
    content: '""',
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '4px',
    backgroundColor: '#e8b45a',
  },
  '.cm-tooltip-lint': {
    backgroundColor: '#1e1f22 !important',
    border: '1px solid #383a42 !important',
    borderRadius: '8px !important',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65), 0 2px 6px rgba(0, 0, 0, 0.4) !important',
    overflow: 'hidden',
    padding: '4px 8px !important',
    maxWidth: '460px',
    color: '#dfe1e5 !important',
    fontSize: '12px !important',
    zIndex: '500 !important',
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  '.cm-tooltip-lint ul': {
    margin: '0',
    padding: '0',
    listStyle: 'none',
  },
  '.cm-tooltip-lint li': {
    margin: '0',
    padding: '0',
  },
});
