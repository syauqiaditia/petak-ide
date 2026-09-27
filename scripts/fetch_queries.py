import os
import urllib.request

queries_dir = os.path.abspath('ui/features/editor/ts/queries')
os.makedirs(queries_dir, exist_ok=True)

urls = {
    'dart.scm': 'https://raw.githubusercontent.com/UserNobody14/tree-sitter-dart/master/queries/highlights.scm',
    'kotlin.scm': 'https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/master/queries/highlights.scm',
    'swift.scm': 'https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/main/queries/highlights.scm',
}

for name, url in urls.items():
    dest = os.path.join(queries_dir, name)
    print(f"Fetching {name} from {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp, open(dest, 'wb') as f:
        f.write(resp.read())
    print(f"Saved {name}: {os.path.getsize(dest)} bytes")
