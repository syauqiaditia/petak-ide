import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';

export type SupportedLanguage = 'dart' | 'kotlin' | 'swift';

export function getLangForFilename(filename: string): SupportedLanguage | null {
  if (filename.endsWith('.dart')) return 'dart';
  if (filename.endsWith('.kt') || filename.endsWith('.kts')) return 'kotlin';
  if (filename.endsWith('.swift')) return 'swift';
  return null;
}

export interface SnippetDef {
  label: string;
  detail: string;
  template: string;
}

export const SNIPPETS_BY_LANG: Record<SupportedLanguage, SnippetDef[]> = {
  dart: [
    {
      label: 'stless',
      detail: 'Flutter StatelessWidget',
      template: `class \${1:Name} extends StatelessWidget {
  const \${1:Name}({super.key});

  @override
  Widget build(BuildContext context) {
    return \${2:const Placeholder()};
  }
}`,
    },
    {
      label: 'stful',
      detail: 'Flutter StatefulWidget',
      template: `class \${1:Name} extends StatefulWidget {
  const \${1:Name}({super.key});

  @override
  State<\${1:Name}> createState() => _\${1:Name}State();
}

class _\${1:Name}State extends State<\${1:Name}> {
  @override
  Widget build(BuildContext context) {
    return \${2:const Placeholder()};
  }
}`,
    },
    {
      label: 'stanim',
      detail: 'Flutter StatefulWidget with AnimationController',
      template: `class \${1:Name} extends StatefulWidget {
  const \${1:Name}({super.key});

  @override
  State<\${1:Name}> createState() => _\${1:Name}State();
}

class _\${1:Name}State extends State<\${1:Name}>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return \${2:const Placeholder()};
  }
}`,
    },
    {
      label: 'sfw',
      detail: 'Flutter StatefulWidget (shorthand)',
      template: `class \${1:Name} extends StatefulWidget {
  const \${1:Name}({super.key});

  @override
  State<\${1:Name}> createState() => _\${1:Name}State();
}

class _\${1:Name}State extends State<\${1:Name}> {
  @override
  Widget build(BuildContext context) {
    return \${2:const Placeholder()};
  }
}`,
    },
    {
      label: 'initS',
      detail: 'initState() method',
      template: `@override
void initState() {
  super.initState();
  \${0}
}`,
    },
    {
      label: 'dis',
      detail: 'dispose() method',
      template: `@override
void dispose() {
  \${0}
  super.dispose();
}`,
    },
    {
      label: 'build',
      detail: 'build(BuildContext context) method',
      template: `@override
Widget build(BuildContext context) {
  return \${0:const Placeholder()};
}`,
    },
    {
      label: 'mateapp',
      detail: 'Flutter MaterialApp skeleton',
      template: `import 'package:flutter/material.dart';

void main() => runApp(const \${1:MyApp}());

class \${1:MyApp} extends StatelessWidget {
  const \${1:MyApp}({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      home: \${2:HomeScreen}(),
    );
  }
}`,
    },
    {
      label: 'cupapp',
      detail: 'Flutter CupertinoApp skeleton',
      template: `import 'package:flutter/cupertino.dart';

void main() => runApp(const \${1:MyApp}());

class \${1:MyApp} extends StatelessWidget {
  const \${1:MyApp}({super.key});

  @override
  Widget build(BuildContext context) {
    return const CupertinoApp(
      home: \${2:HomeScreen}(),
    );
  }
}`,
    },
    {
      label: 'tryc',
      detail: 'try / catch block',
      template: `try {
  \${1}
} catch (\${2:e}) {
  \${0}
}`,
    },
    {
      label: 'fori',
      detail: 'for index loop',
      template: `for (var \${1:i} = 0; \${1:i} < \${2:length}; \${1:i}++) {
  \${0}
}`,
    },
    {
      label: 'foreach',
      detail: 'for-in loop',
      template: `for (var \${1:element} in \${2:collection}) {
  \${0}
}`,
    },
    {
      label: 'main',
      detail: 'main() function',
      template: `void main() {
  \${0}
}`,
    },
    {
      label: 'print',
      detail: 'print() to console',
      template: `print('\${1:message}');`,
    },
    {
      label: 'log',
      detail: 'developer.log()',
      template: `log('\${1:message}');`,
    },
    {
      label: 'futureb',
      detail: 'Flutter FutureBuilder',
      template: `FutureBuilder<\${1:T}>(
  future: \${2:future},
  builder: (BuildContext context, AsyncSnapshot<\${1:T}> snapshot) {
    if (snapshot.hasData) {
      return \${3:Widget};
    } else if (snapshot.hasError) {
      return \${4:Widget};
    }
    return const \${5:CircularProgressIndicator()};
  },
)`,
    },
    {
      label: 'streamb',
      detail: 'Flutter StreamBuilder',
      template: `StreamBuilder<\${1:T}>(
  stream: \${2:stream},
  builder: (BuildContext context, AsyncSnapshot<\${1:T}> snapshot) {
    if (snapshot.hasData) {
      return \${3:Widget};
    } else if (snapshot.hasError) {
      return \${4:Widget};
    }
    return const \${5:CircularProgressIndicator()};
  },
)`,
    },
  ],
  kotlin: [
    {
      label: 'fun',
      detail: 'Kotlin function',
      template: `fun \${1:name}(\${2:params}): \${3:Unit} {
    \${0}
}`,
    },
    {
      label: 'main',
      detail: 'Kotlin main function',
      template: `fun main() {
    \${0}
}`,
    },
    {
      label: 'class',
      detail: 'Kotlin class',
      template: `class \${1:Name} {
    \${0}
}`,
    },
    {
      label: 'dataclass',
      detail: 'Kotlin data class',
      template: `data class \${1:Name}(
    val \${2:param}: \${3:String},
)`,
    },
    {
      label: 'when',
      detail: 'Kotlin when expression',
      template: `when (\${1:variable}) {
    \${2:condition} -> \${3:result}
    else -> \${0}
}`,
    },
    {
      label: 'for',
      detail: 'Kotlin for loop',
      template: `for (\${1:item} in \${2:items}) {
    \${0}
}`,
    },
  ],
  swift: [
    {
      label: 'func',
      detail: 'Swift function',
      template: `func \${1:name}(\${2:params}) -> \${3:Void} {
    \${0}
}`,
    },
    {
      label: 'guard',
      detail: 'Swift guard statement',
      template: `guard \${1:condition} else {
    \${0}
}`,
    },
    {
      label: 'iflet',
      detail: 'Swift if let optional binding',
      template: `if let \${1:value} = \${2:optional} {
    \${0}
}`,
    },
    {
      label: 'struct',
      detail: 'Swift struct',
      template: `struct \${1:Name} {
    \${0}
}`,
    },
    {
      label: 'class',
      detail: 'Swift class',
      template: `class \${1:Name} {
    \${0}
}`,
    },
    {
      label: 'main',
      detail: 'Swift @main entrypoint',
      template: `@main
struct \${1:App} {
    static func main() {
        \${0}
    }
}`,
    },
  ],
};

/**
 * Returns snippet completions for the given language.
 */
export function getSnippetCompletionsForLanguage(lang: SupportedLanguage): Completion[] {
  const snippets = SNIPPETS_BY_LANG[lang] || [];
  return snippets.map((s) => {
    const comp: Completion & { _kindLetter?: string } = {
      label: s.label,
      detail: s.detail,
      type: 'snippet',
      _kindLetter: 's',
      boost: 90,
    };
    return snippetCompletion(s.template, comp);
  });
}

/**
 * Autocompletion source for built-in code snippets.
 * Runs synchronously and independently from LSP.
 */
export function createSnippetCompletionSource(getPath: () => string | null): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const path = getPath();
    if (!path) return null;
    const lang = getLangForFilename(path);
    if (!lang) return null;

    const word = context.matchBefore(/[\w$]+/);
    if (!word && !context.explicit) return null;

    const from = word ? word.from : context.pos;
    const options = getSnippetCompletionsForLanguage(lang).map((opt) => ({
      ...opt,
      boost: -99,
    }));

    return {
      from,
      options,
      validFor: /^[\w$]*$/,
    };
  };
}
