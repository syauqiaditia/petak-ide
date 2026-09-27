import os
import shutil
import tarfile

target_dir = os.path.abspath('ui/public/ts')
os.makedirs(target_dir, exist_ok=True)

# 1. Copy tree-sitter.wasm from web-tree-sitter
src_ts_wasm = os.path.abspath('node_modules/web-tree-sitter/tree-sitter.wasm')
if os.path.exists(src_ts_wasm):
    dst_ts_wasm = os.path.join(target_dir, 'tree-sitter.wasm')
    shutil.copyfile(src_ts_wasm, dst_ts_wasm)
    print(f"Copied {src_ts_wasm} -> {dst_ts_wasm} ({os.path.getsize(dst_ts_wasm)} bytes)")

# 2. Extract dart, kotlin, swift wasms from /tmp/tree-sitter-wasms-0.1.13.tgz
wasms_to_extract = {
    'package/out/tree-sitter-dart.wasm': 'tree-sitter-dart.wasm',
    'package/out/tree-sitter-kotlin.wasm': 'tree-sitter-kotlin.wasm',
    'package/out/tree-sitter-swift.wasm': 'tree-sitter-swift.wasm',
}

with tarfile.open('/tmp/tree-sitter-wasms-0.1.13.tgz', 'r:gz') as tar:
    for tar_path, dest_name in wasms_to_extract.items():
        member = tar.getmember(tar_path)
        dest_path = os.path.join(target_dir, dest_name)
        f_src = tar.extractfile(member)
        if f_src:
            with open(dest_path, 'wb') as dst_f:
                shutil.copyfileobj(f_src, dst_f)
            f_src.close()
        print(f"Extracted {tar_path} -> {dest_path} ({os.path.getsize(dest_path)} bytes)")

print("\nFiles in", target_dir)
for f in os.listdir(target_dir):
    p = os.path.join(target_dir, f)
    print(f"  {f}: {os.path.getsize(p)} bytes ({os.path.getsize(p) / 1024 / 1024:.2f} MB)")
