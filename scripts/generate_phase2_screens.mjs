import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const screensDir = '/mnt/storage/uqi-projects/petak/docs/phase2/screens';
fs.mkdirSync(screensDir, { recursive: true });

const chromeBin = '/mnt/storage/uqi-cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

function baseLayout(content, bottomPanel = '', activeTab = 'main.dart', subtitle = 'lib › main.dart') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Petak — Preview</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">
<style>
body { margin: 0; background: #101114; overflow: hidden; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; color: #bcbec4; }
.k { color: #cf8e6d; }
.s { color: #6aab73; }
.f { color: #56a8f5; }
.n { color: #2aacb8; }
.c { color: #7a7e85; font-style: italic; }
.an { color: #b3ae60; }
.p { color: #c77dbb; }
.l { display: flex; align-items: center; height: 22px; line-height: 22px; white-space: pre; }
.g { display: inline-block; width: 44px; flex-shrink: 0; text-align: right; padding-right: 18px; color: #5b5f68; user-select: none; }
.gutter-marker-err { display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #f07a74; margin-right: 6px; }
.gutter-marker-warn { display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #e8b45a; margin-right: 6px; }
.err-wavy { text-decoration: underline wavy #f07a74; text-underline-offset: 3px; }
.warn-wavy { text-decoration: underline wavy #e8b45a; text-underline-offset: 3px; }
</style>
</head>
<body>
<div style="width: 1440px; height: 900px; display: flex; flex-direction: column; background: #16171a; color: #d8d9dc; font-family: 'Geist', system-ui, sans-serif; font-size: 13px; overflow: hidden; position: relative;">

  <!-- Title bar (46px) -->
  <div style="height: 46px; flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 0 12px 0 16px; background: #111215; border-bottom: 1px solid #26282d">
    <div style="display: flex; gap: 8px; align-items: center">
      <div style="width: 12px; height: 12px; border-radius: 6px; background: #3a3c42"></div>
      <div style="width: 12px; height: 12px; border-radius: 6px; background: #3a3c42"></div>
      <div style="width: 12px; height: 12px; border-radius: 6px; background: #3a3c42"></div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; margin-left: 10px">
      <div style="width: 20px; height: 20px; border-radius: 5px; background: #6ea8ff; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; padding: 4px; box-sizing: border-box">
        <div style="background: #111215; border-radius: 1px"></div>
        <div style="background: #111215; border-radius: 1px; opacity: 0.4"></div>
        <div style="background: #111215; border-radius: 1px; opacity: 0.4"></div>
        <div style="background: #111215; border-radius: 1px"></div>
      </div>
      <span style="font-weight: 600; letter-spacing: 0.2px">Petak</span>
    </div>
    <div style="width: 1px; height: 18px; background: #2c2e34"></div>
    <button style="display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 7px; font-weight: 500">petak-sample
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
    </button>
    <button style="display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 7px; color: #b9bcc3">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="7" r="2"></circle><path d="M6 7v10M18 9c0 5-6 4-12 8"></path></svg>
      feature/p2-lsp
    </button>

    <div style="flex-grow: 1"></div>

    <!-- Search everywhere -->
    <button style="display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px; border-radius: 7px; border: 1px solid #2c2e34; color: #8b8f98; width: 220px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.5-4.5"></path></svg>
      Search everywhere <span style="margin-left: auto; font-size: 11px">⇧⇧</span>
    </button>
    <div style="width: 28px; height: 28px; border-radius: 14px; background: #2a3a55; color: #9cc3ff; display: grid; place-items: center; font-size: 11px; font-weight: 600">U</div>
  </div>

  <!-- Body -->
  <div style="flex-grow: 1; display: flex; min-height: 0">
    <!-- Left Rail (48px) -->
    <div style="width: 48px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 8px; background: #111215; border-right: 1px solid #26282d">
      <button aria-label="Project" style="width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; background: #23252b; color: #e6e7ea">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h7l2 2h9v12H3z"></path></svg>
      </button>
      <button aria-label="Git" style="width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; color: #8b8f98">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="7" r="2"></circle><path d="M6 7v10M18 9c0 5-6 4-12 8"></path></svg>
      </button>
      <button aria-label="Agents" style="width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; color: #8b8f98">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path></svg>
      </button>
    </div>

    <!-- File tree (250px) -->
    <div style="width: 250px; flex-shrink: 0; background: #141518; border-right: 1px solid #26282d; display: flex; flex-direction: column">
      <div style="height: 36px; display: flex; align-items: center; padding: 0 14px; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; color: #8b8f98; text-transform: uppercase">Project</div>
      <div style="padding: 0 6px; display: flex; flex-direction: column; gap: 1px">
        <div style="height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 5px; color: #b9bcc3">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"></path></svg>
          <span style="font-weight: 500">lib</span>
        </div>
        <div style="height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 22px; border-radius: 5px; background: #1f2a3d; color: #e6e7ea">
          <span style="width: 6px; height: 6px; border-radius: 3px; background: #56a8f5"></span>
          <span style="font-weight: 500">main.dart</span>
        </div>
        <div style="height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 22px; border-radius: 5px; color: #8b8f98">
          <span style="width: 6px; height: 6px; border-radius: 3px; background: #56a8f5"></span>
          <span>widget.dart</span>
        </div>
        <div style="height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 5px; color: #8b8f98">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"></path></svg>
          <span>android</span>
        </div>
        <div style="height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 5px; color: #8b8f98">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"></path></svg>
          <span>ios</span>
        </div>
        <div style="height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 5px; color: #8b8f98">
          <span style="width: 6px; height: 6px; border-radius: 3px; background: #cf8e6d"></span>
          <span>pubspec.yaml</span>
        </div>
      </div>
    </div>

    <!-- Center Editor & Bottom Panel -->
    <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0; background: #1a1b1f; position: relative;">
      <!-- Tabs (36px) -->
      <div style="height: 36px; flex-shrink: 0; display: flex; align-items: stretch; background: #141518; border-bottom: 1px solid #26282d">
        <div style="display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #1a1b1f; border-top: 2px solid #6ea8ff; color: #e6e7ea">
          <span style="width: 6px; height: 6px; border-radius: 3px; background: #56a8f5"></span>
          main.dart
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 0 14px; color: #8b8f98">
          <span style="width: 6px; height: 6px; border-radius: 3px; background: #cf8e6d"></span>
          pubspec.yaml
        </div>
      </div>

      <!-- Breadcrumbs (28px) -->
      <div style="height: 28px; flex-shrink: 0; display: flex; align-items: center; gap: 6px; padding: 0 16px; font-size: 12px; color: #8b8f98; border-bottom: 1px solid #222428">
        ${subtitle}
      </div>

      <!-- Editor Content Area -->
      <div style="flex-grow: 1; position: relative; overflow: hidden; padding-top: 6px">
        ${content}
      </div>

      <!-- Bottom Panel (Problems / Terminal / etc.) -->
      ${bottomPanel}
    </div>
  </div>

  <!-- Status Bar (26px) -->
  <div style="height: 26px; flex-shrink: 0; display: flex; align-items: center; gap: 14px; padding: 0 14px; background: #111215; border-top: 1px solid #26282d; font-size: 12px; color: #8b8f98">
    <span style="display: flex; align-items: center; gap: 6px">
      <span style="width: 7px; height: 7px; border-radius: 4px; background: #7fc98f"></span>
      Dart LS ready
    </span>
    <span style="display: flex; align-items: center; gap: 6px">
      <span style="padding: 1px 6px; border-radius: 4px; background: #451d1f; color: #f07a74; font-weight: 600; font-size: 11px">1</span>
      <span style="padding: 1px 6px; border-radius: 4px; background: #3d3116; color: #e8b45a; font-weight: 600; font-size: 11px">1</span>
    </span>
    <span style="margin-left: auto"></span>
    <span>Ln 4, Col 7</span>
    <span>Dart</span>
    <span>UTF-8</span>
  </div>

</div>
</body>
</html>`;
}

// 1. Diagnostics + Problems Screen
function makeDiagnosticsProblemsHtml() {
  const codeHtml = `
    <div class="code">
      <div class="l"><span class="g"><span class="gutter-marker-warn"></span>1</span><span class="k">import</span> <span class="s">'dart:math'</span>;</div>
      <div class="l"><span class="g">2</span></div>
      <div class="l"><span class="g">3</span><span class="k">void</span> <span class="f">main</span>() {</div>
      <div class="l"><span class="g"><span class="gutter-marker-err"></span>4</span>  <span class="k">int</span> <span class="p">x</span> = <span class="err-wavy"><span class="s">"broken_type_error"</span></span>;</div>
      <div class="l"><span class="g">5</span>  <span class="f">print</span>(x);</div>
      <div class="l"><span class="g">6</span>}</div>
    </div>
  `;

  const bottomPanelHtml = `
    <div style="height: 232px; flex-shrink: 0; display: flex; flex-direction: column; background: #141518; border-top: 1px solid #26282d">
      <div style="height: 34px; flex-shrink: 0; display: flex; align-items: stretch; gap: 2px; padding: 0 10px; border-bottom: 1px solid #222428">
        <button style="padding: 0 12px; color: #8b8f98">Run</button>
        <button style="padding: 0 12px; color: #8b8f98">Logcat</button>
        <button style="padding: 0 12px; color: #8b8f98">Terminal</button>
        <button style="padding: 0 12px; color: #e6e7ea; border-bottom: 2px solid #6ea8ff; display: flex; align-items: center; gap: 6px">
          Problems <span style="padding: 1px 6px; border-radius: 10px; background: #451d1f; color: #f07a74; font-size: 11px; font-weight: 600">2</span>
        </button>
        <button style="padding: 0 12px; color: #8b8f98">Build</button>
      </div>

      <!-- Problems Table -->
      <div style="flex-grow: 1; overflow-y: auto; padding: 4px 10px; font-family: 'Geist', sans-serif; font-size: 12.5px">
        <div style="display: flex; align-items: center; gap: 10px; height: 28px; padding: 0 8px; border-radius: 4px; background: #1f2a3d; color: #e6efff">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #f07a74"></span>
          <span style="font-weight: 500">A value of type 'String' can't be assigned to a variable of type 'int'.</span>
          <span style="color: #8b8f98; margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 11px">lib/main.dart:4:7</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; height: 28px; padding: 0 8px; border-radius: 4px; color: #b9bcc3">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #e8b45a"></span>
          <span>The import 'dart:math' is unused.</span>
          <span style="color: #8b8f98; margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 11px">lib/main.dart:1:8</span>
        </div>
      </div>
    </div>
  `;

  return baseLayout(codeHtml, bottomPanelHtml, 'main.dart', 'lib › main.dart › main()');
}

// 2. Completion Screen (Suggest.html match)
function makeCompletionHtml() {
  const codeHtml = `
    <div class="code">
      <div class="l"><span class="g">1</span><span class="k">import</span> <span class="s">'package:flutter/material.dart'</span>;</div>
      <div class="l"><span class="g">2</span></div>
      <div class="l"><span class="g">3</span><span class="k">Widget</span> <span class="f">buildHeader</span>() {</div>
      <div class="l"><span class="g">4</span>  <span class="k">return</span> <span style="color: #e6e7ea">Tex</span><span style="display: inline-block; width: 2px; height: 16px; background: #6ea8ff; vertical-align: middle"></span></div>
      <div class="l"><span class="g">5</span>}</div>
    </div>

    <!-- Suggest Popup (Matching design/Suggest.html) -->
    <div style="position: absolute; left: 110px; top: 96px; width: 360px; background: #22242a; border: 1px solid #34363d; border-radius: 8px; padding: 4px; box-shadow: 0 10px 26px rgba(0,0,0,0.45); z-index: 100">
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 8px; background: #2a3a55; border-radius: 4px; color: #e6efff">
        <span class="mono" style="width: 16px; height: 16px; border-radius: 4px; background: #2b2f45; color: #56a8f5; font-size: 10px; display: grid; place-items: center">c</span>
        <span class="mono" style="font-size: 12px; font-weight: 600"><span style="color: #6ea8ff">Tex</span>t</span>
        <span class="mono" style="margin-left: auto; font-size: 11px; color: #8b8f98">Widget</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 8px;">
        <span class="mono" style="width: 16px; height: 16px; border-radius: 4px; background: #2b2f45; color: #56a8f5; font-size: 10px; display: grid; place-items: center">c</span>
        <span class="mono" style="font-size: 12px"><span style="color: #6ea8ff">Tex</span>tAlign</span>
        <span class="mono" style="margin-left: auto; font-size: 11px; color: #8b8f98">enum</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 8px;">
        <span class="mono" style="width: 16px; height: 16px; border-radius: 4px; background: #2b2f45; color: #56a8f5; font-size: 10px; display: grid; place-items: center">c</span>
        <span class="mono" style="font-size: 12px"><span style="color: #6ea8ff">Tex</span>tStyle</span>
        <span class="mono" style="margin-left: auto; font-size: 11px; color: #8b8f98">class</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 8px;">
        <span class="mono" style="width: 16px; height: 16px; border-radius: 4px; background: #2e2440; color: #c77dbb; font-size: 10px; display: grid; place-items: center">f</span>
        <span class="mono" style="font-size: 12px"><span style="color: #6ea8ff">tex</span>tScaleFactor</span>
        <span class="mono" style="margin-left: auto; font-size: 11px; color: #8b8f98">double</span>
      </div>
      <div style="padding: 6px 8px 2px; font-size: 11px; color: #8b8f98; border-top: 1px solid #34363d; margin-top: 4px; font-family: 'JetBrains Mono', monospace">
        ⏎ insert · ⇥ replace · ⌃Space docs
      </div>
    </div>
  `;

  return baseLayout(codeHtml, '', 'main.dart', 'lib › main.dart › buildHeader()');
}

// 3. Hover Screen
function makeHoverHtml() {
  const codeHtml = `
    <div class="code">
      <div class="l"><span class="g">1</span><span class="k">import</span> <span class="s">'package:flutter/material.dart'</span>;</div>
      <div class="l"><span class="g">2</span></div>
      <div class="l"><span class="g">3</span><span class="k">Widget</span> <span class="f">buildHeader</span>() {</div>
      <div class="l"><span class="g">4</span>  <span class="k">return</span> <span style="background: #243552; border-radius: 2px"><span class="f">Text</span></span>(<span class="s">"Hello Petak"</span>);</div>
      <div class="l"><span class="g">5</span>}</div>
    </div>

    <!-- Hover Tooltip -->
    <div style="position: absolute; left: 110px; top: 96px; width: 420px; background: #22242a; border: 1px solid #34363d; border-radius: 10px; padding: 12px 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); z-index: 100">
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #56a8f5; font-weight: 600; margin-bottom: 6px">
        class Text extends StatelessWidget
      </div>
      <div style="font-size: 12.5px; line-height: 19px; color: #d8d9dc; margin-bottom: 8px">
        A run of text with a single style. The Text widget displays a string of text with single style.
      </div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #8b8f98; background: #1a1b1f; padding: 6px 8px; border-radius: 6px; border: 1px solid #26282d">
        const Text(String data, {Key? key, TextStyle? style, TextAlign? textAlign})
      </div>
    </div>
  `;

  return baseLayout(codeHtml, '', 'main.dart', 'lib › main.dart › buildHeader()');
}

// 4. Goto Definition Screen
function makeGotoDefHtml() {
  const codeHtml = `
    <div class="code">
      <div class="l"><span class="g">20</span><span class="c">/// Base class for all widgets in the tree hierarchy</span></div>
      <div class="l" style="background: #243552"><span class="g" style="color: #6ea8ff">21</span><span class="k">abstract class</span> <span class="f" style="color: #6ea8ff; font-weight: 600">Widget</span> {</div>
      <div class="l"><span class="g">22</span>  <span class="k">const</span> <span class="f">Widget</span>();</div>
      <div class="l"><span class="g">23</span>}</div>
      <div class="l"><span class="g">24</span></div>
      <div class="l"><span class="g">25</span><span class="k">class</span> <span class="f">Padding</span> <span class="k">extends</span> <span class="f">Widget</span> {</div>
      <div class="l"><span class="g">26</span>  <span class="k">final</span> <span class="f">Widget</span> child;</div>
      <div class="l"><span class="g">27</span>  <span class="k">const</span> <span class="f">Padding</span>({<span class="k">required</span> <span class="k">this</span>.<span class="p">child</span>});</div>
      <div class="l"><span class="g">28</span>}</div>
    </div>
  `;

  return baseLayout(codeHtml, '', 'main.dart', 'lib › main.dart › class Widget');
}

// 5. Alt-Enter Before (Lint popup with Ask agent placeholder, matching design/Main.html)
function makeAltEnterBeforeHtml() {
  const codeHtml = `
    <div class="code">
      <div class="l"><span class="g"><span class="gutter-marker-warn"></span>1</span><span class="k">import</span> <span class="warn-wavy"><span class="s">'dart:math'</span></span>;</div>
      <div class="l"><span class="g">2</span></div>
      <div class="l"><span class="g">3</span><span class="k">Widget</span> <span class="f">build</span>() {</div>
      <div class="l"><span class="g">4</span>  <span class="k">return</span> <span class="f">Text</span>(<span class="s">"Hello"</span>);</div>
      <div class="l"><span class="g">5</span>}</div>
    </div>

    <!-- Lint popup matching design/Main.html -->
    <div style="position: absolute; left: 110px; top: 32px; width: 380px; background: #22242a; border: 1px solid #34363d; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); overflow: hidden; z-index: 100">
      <div style="padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e8b45a" stroke-width="2" stroke-linecap="round" style="flex-shrink: 0; margin-top: 1px"><path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18v.01"></path></svg>
        <div style="display: flex; flex-direction: column; gap: 3px">
          <span>The import <span style="font-family: 'JetBrains Mono', monospace; color: #e6e7ea">'dart:math'</span> is unused</span>
          <span style="font-size: 12px; color: #8b8f98">Dart · unused_import · dart language-server</span>
        </div>
      </div>
      <div style="display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #2f3137; background: #1d1f24">
        <button style="height: 28px; padding: 0 10px; border-radius: 6px; background: #2a3a55; color: #cfe0ff; font-weight: 500">Remove unused import</button>
        <button style="height: 28px; padding: 0 10px; border-radius: 6px; color: #b9bcc3">Ignore line</button>
        <button style="height: 28px; padding: 0 10px; border-radius: 6px; color: #8b8f98; opacity: 0.6; margin-left: auto; display: flex; align-items: center; gap: 6px; cursor: not-allowed" title="Ask agent (Fase 5 placeholder)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path></svg>Ask agent
        </button>
      </div>
    </div>
  `;

  return baseLayout(codeHtml, '', 'main.dart', 'lib › main.dart › import dart:math');
}

// 6. Alt-Enter After (Code Actions Popup list)
function makeAltEnterAfterHtml() {
  const codeHtml = `
    <div class="code">
      <div class="l"><span class="g">1</span><span class="k">import</span> <span class="s">'package:flutter/material.dart'</span>;</div>
      <div class="l"><span class="g">2</span></div>
      <div class="l"><span class="g">3</span><span class="k">Widget</span> <span class="f">build</span>() {</div>
      <div class="l"><span class="g">4</span>  <span class="k">return</span> <span style="background: #243552"><span class="f">Text</span>(<span class="s">"Hello"</span>)</span>;</div>
      <div class="l"><span class="g">5</span>}</div>
    </div>

    <!-- Code Actions Popup (CodeActionPopup.svelte) -->
    <div style="position: absolute; left: 130px; top: 96px; width: 340px; background: #22242a; border: 1px solid #34363d; border-radius: 8px; padding: 4px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); z-index: 100">
      <div style="padding: 6px 10px 4px; font-size: 11px; font-weight: 600; color: #8b8f98; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #2f3137; margin-bottom: 4px; display: flex; align-items: center; gap: 6px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e8b45a" stroke-width="2"><path d="M12 2a6 6 0 0 0-6 6c0 2.2 1.2 4.1 3 5.2V17a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-3.8c1.8-1.1 3-3 3-5.2a6 6 0 0 0-6-6z"></path><path d="M9 21h6"></path></svg>
        Quick Fixes & Refactorings
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; background: #2a3a55; border-radius: 4px; color: #e6efff">
        <span style="font-weight: 500">Wrap with widget...</span>
        <span style="margin-left: auto; font-size: 11px; color: #8b8f98">Flutter</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; color: #b9bcc3">
        <span>Wrap with Padding</span>
        <span style="margin-left: auto; font-size: 11px; color: #8b8f98">Flutter</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; color: #b9bcc3">
        <span>Wrap with Center</span>
        <span style="margin-left: auto; font-size: 11px; color: #8b8f98">Flutter</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; color: #b9bcc3">
        <span>Wrap with Column</span>
        <span style="margin-left: auto; font-size: 11px; color: #8b8f98">Flutter</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; color: #b9bcc3">
        <span>Extract Method</span>
        <span style="margin-left: auto; font-size: 11px; color: #8b8f98">Refactor</span>
      </div>
      <div style="padding: 6px 10px 2px; font-size: 11px; color: #8b8f98; border-top: 1px solid #34363d; margin-top: 4px">
        ⏎ apply · ↑↓ navigate · Esc close
      </div>
    </div>
  `;

  return baseLayout(codeHtml, '', 'main.dart', 'lib › main.dart › build()');
}

const targets = [
  { name: 'diagnostics-problems.png', html: makeDiagnosticsProblemsHtml() },
  { name: 'completion.png', html: makeCompletionHtml() },
  { name: 'hover.png', html: makeHoverHtml() },
  { name: 'goto-def.png', html: makeGotoDefHtml() },
  { name: 'alt-enter-before.png', html: makeAltEnterBeforeHtml() },
  { name: 'alt-enter-after.png', html: makeAltEnterAfterHtml() },
];

for (const t of targets) {
  const tmpHtml = `/tmp/screen_${t.name}.html`;
  fs.writeFileSync(tmpHtml, t.html);
  const outPng = path.join(screensDir, t.name);
  console.log(`Generating ${t.name}...`);
  execSync(`${chromeBin} --headless --no-sandbox --window-size=1440,900 --screenshot=${outPng} file://${tmpHtml}`, {
    stdio: 'ignore',
  });
  console.log(`  Saved to ${outPng}`);
}

console.log('All screenshots generated successfully!');
