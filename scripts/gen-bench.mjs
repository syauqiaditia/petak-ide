import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const outDir = process.env.PETAK_BENCH_DIR || path.join(os.homedir(), 'petak-bench');
fs.mkdirSync(outDir, { recursive: true });

function generateKotlin(targetLines, filename) {
  const filePath = path.join(outDir, filename);
  console.log(`Generating ${targetLines} lines into ${filePath}...`);
  const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });

  stream.write(`package id.petak.bench\n\n`);
  stream.write(`// Generated synthetic Kotlin benchmark file: ${targetLines} lines\n`);
  stream.write(`import java.util.UUID\nimport kotlinx.coroutines.flow.*\n\n`);

  let currentLines = 5;
  let idx = 0;

  while (currentLines < targetLines) {
    idx++;
    const chunk = [
      `/**`,
      ` * Service handler for entity #${idx}`,
      ` */`,
      `data class BenchEntity${idx}(`,
      `    val id: String = "${idx}-${Math.random().toString(36).substring(2)}",`,
      `    val name: String = "Item_${idx}",`,
      `    val count: Int = ${idx * 42},`,
      `    val active: Boolean = ${idx % 2 === 0}`,
      `)`,
      ``,
      `class BenchService${idx} {`,
      `    private val items = mutableListOf<BenchEntity${idx}>()`,
      ``,
      `    fun processItem(item: BenchEntity${idx}): String {`,
      `        // Validate entity constraints`,
      `        if (item.count < 0) return "INVALID"`,
      `        items.add(item)`,
      `        return "Processed item \${item.name} with count \${item.count}"`,
      `    }`,
      ``,
      `    fun clear() {`,
      `        items.clear()`,
      `    }`,
      `}`,
      ``
    ];

    if (currentLines + chunk.length > targetLines) {
      const remaining = targetLines - currentLines;
      for (let i = 0; i < remaining; i++) {
        stream.write(`// filler line ${currentLines + i + 1}\n`);
      }
      currentLines = targetLines;
      break;
    }

    stream.write(chunk.join('\n') + '\n');
    currentLines += chunk.length;
  }

  stream.end();
  console.log(`Finished ${filePath}: ${currentLines} lines`);
}

generateKotlin(10000, 'Big10k.kt');
generateKotlin(50000, 'Big50k.kt');
