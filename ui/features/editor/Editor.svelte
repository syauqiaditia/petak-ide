<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    EditorView,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    keymap,
  } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { vim } from '@replit/codemirror-vim';
  import { filenameFacet, treeSitterPlugin, highlightTheme } from './ts/highlight';

  let {
    content = '',
    filename = 'Untitled',
    filepath = '',
    onReady,
  } = $props<{
    content?: string;
    filename?: string;
    filepath?: string;
    onReady?: (view: EditorView) => void;
  }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  const filenameCompartment = new Compartment();

  const petakTheme = EditorView.theme(
    {
      '&': {
        color: '#bcbec4',
        backgroundColor: '#1a1b1f',
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
        caretColor: '#6ea8ff',
        padding: '6px 0',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: '#6ea8ff',
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: '#1f2a3d',
      },
      '.cm-gutters': {
        backgroundColor: '#1a1b1f',
        color: '#5b5f68',
        borderRight: '1px solid #26282d',
        paddingRight: '8px',
      },
      '.cm-gutterElement': {
        paddingLeft: '12px',
      },
      '.cm-activeLine': {
        backgroundColor: '#23252b44',
      },
      '.cm-activeLineGutter': {
        backgroundColor: '#23252b44',
        color: '#b9bcc3',
      },
      '.cm-vim-panel': {
        backgroundColor: '#141518',
        color: '#d8d9dc',
        padding: '2px 8px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '12px',
        borderTop: '1px solid #26282d',
      },
      '.cm-vim-panel input': {
        color: '#d8d9dc',
        backgroundColor: 'transparent',
      },
    },
    { dark: true }
  );

  onMount(() => {
    const state = EditorState.create({
      doc: content,
      extensions: [
        vim(),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        petakTheme,
        highlightTheme,
        filenameCompartment.of(filenameFacet.of(filename)),
        treeSitterPlugin,
      ],
    });

    view = new EditorView({
      state,
      parent: container,
    });

    view.focus();

    // Call onReady after 2 requestAnimationFrames
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (view && onReady) {
          onReady(view);
        }
      });
    });
  });

  onDestroy(() => {
    if (view) {
      view.destroy();
      view = null;
    }
  });

  // Watch content updates from outside
  $effect(() => {
    if (view && content !== undefined) {
      const currentDoc = view.state.doc.toString();
      if (currentDoc !== content) {
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: content },
        });
      }
    }
  });

  // Watch filename changes to reconfigure highlight language
  $effect(() => {
    if (view && filename) {
      view.dispatch({
        effects: filenameCompartment.reconfigure(filenameFacet.of(filename)),
      });
    }
  });

  export function getEditorView(): EditorView | null {
    return view;
  }
</script>

<div class="editor-wrapper">
  <!-- Tab bar -->
  <div class="tabs-bar">
    <div class="tab active">
      <span>{filename}</span>
      <span class="tab-dot"></span>
    </div>
  </div>

  <!-- Breadcrumbs -->
  <div class="breadcrumbs">
    {#if filepath}
      <span>{filepath}</span>
    {:else}
      <span>src › <strong>{filename}</strong></span>
    {/if}
  </div>

  <!-- Editor container -->
  <div class="editor-container" bind:this={container}></div>
</div>

<style>
  .editor-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: #1a1b1f;
    position: relative;
    overflow: hidden;
  }
  .tabs-bar {
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    background: #141518;
    border-bottom: 1px solid #26282d;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: #1a1b1f;
    border-top: 2px solid #6ea8ff;
    color: #e6e7ea;
    font-size: 13px;
    font-weight: 500;
  }
  .tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: #6ea8ff;
  }
  .breadcrumbs {
    height: 28px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 16px;
    font-size: 12px;
    color: #8b8f98;
    border-bottom: 1px solid #202227;
  }
  .breadcrumbs strong {
    color: #b9bcc3;
    font-weight: 500;
  }
  .editor-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  :global(.editor-container .cm-editor) {
    height: 100%;
    outline: none;
  }
</style>
