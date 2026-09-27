import { RangeSetBuilder } from '@codemirror/state';
import { Decoration } from '@codemirror/view';

try {
  const b = new RangeSetBuilder();
  const d1 = Decoration.mark({ class: "a" });
  const d2 = Decoration.mark({ class: "b" });
  b.add(0, 50, d1);
  b.add(5, 10, d2);
  b.finish();
  console.log("SUCCESS");
} catch (e) {
  console.error("ERROR:", e);
}
