import tarfile
import json

with tarfile.open('/tmp/tree-sitter-wasms-0.1.13.tgz', 'r:gz') as tar:
    f = tar.extractfile('package/package.json')
    if f:
        data = json.load(f)
        print("tree-sitter-wasms package.json:")
        print(json.dumps(data, indent=2))
