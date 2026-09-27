import subprocess
import time
import os
import sys
import json

def main():
    log_file = "/tmp/petak-bench-f02.log"
    with open(log_file, "w") as f:
        f.write("")
    try:
        with open("/tmp/petak_open.txt", "w") as f:
            f.write("")
    except Exception:
        pass

    # Kill existing
    subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "petak-app"], stderr=subprocess.DEVNULL)
    time.sleep(1.0)

    app_path = os.path.expanduser("~/petak/target/release/bundle/macos/Petak.app")
    cmd = [
        "open", "-n",
        "--env", "PETAK_BENCH=1",
        "--env", f"PETAK_BENCH_OUT={log_file}",
        app_path
    ]
    print(f"Launching Petak benchmark: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)

    time.sleep(1.0)
    subprocess.run(["osascript", "-e", 'tell application "Petak" to activate'])

    ram_before_kb = None
    ram_after_kb = None
    webcontent_pid = None
    completed = False

    t_start = time.time()
    seen_lines = 0

    while time.time() - t_start < 900:
        time.sleep(0.3)

        if not webcontent_pid:
            try:
                ps_out = subprocess.check_output(["ps", "-axo", "pid,command"], text=True)
                for line in ps_out.splitlines():
                    if "com.apple.WebKit.WebContent" in line:
                        parts = line.strip().split()
                        pid = parts[0]
                        webcontent_pid = int(pid)
                        print(f"Found WebContent PID: {webcontent_pid}")
                        break
            except Exception:
                pass

        if os.path.exists(log_file):
            with open(log_file, "r") as f:
                lines = f.readlines()

            while seen_lines < len(lines):
                line_str = lines[seen_lines].strip()
                seen_lines += 1
                if not line_str:
                    continue

                print(f"[BENCH_LOG] {line_str}")
                json_str = line_str
                if json_str.startswith("[LOG] "):
                    json_str = json_str[6:].strip()

                if json_str.startswith("{") and json_str.endswith("}"):
                    try:
                        data = json.loads(json_str)
                        metric = data.get("metric")
                        if metric == "f02_signal_before_preload" and ram_before_kb is None and webcontent_pid:
                            rss_out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(webcontent_pid)], text=True).strip()
                            ram_before_kb = int(rss_out)
                            print(f">>> WebContent RSS before preload: {ram_before_kb} KB ({ram_before_kb / 1024:.2f} MB)")
                        elif metric == "f02_signal_after_preload" and ram_after_kb is None and webcontent_pid:
                            rss_out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(webcontent_pid)], text=True).strip()
                            ram_after_kb = int(rss_out)
                            print(f">>> WebContent RSS after preload: {ram_after_kb} KB ({ram_after_kb / 1024:.2f} MB)")
                        elif metric == "bench_status" and data.get("status") == "complete":
                            print(">>> Benchmark complete!")
                            completed = True
                            break
                        elif metric == "bench_error":
                            print(f">>> Benchmark ERROR: {data.get('error')}")
                            completed = True
                            break
                    except json.JSONDecodeError:
                        pass

        if completed:
            break

    # Terminate Petak
    subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "petak-app"], stderr=subprocess.DEVNULL)

    print(f"\n=== Benchmark Summary ===")
    print(f"Completed: {completed}")
    if ram_before_kb and ram_after_kb:
        diff_kb = ram_after_kb - ram_before_kb
        print(f"WebContent RSS Before Preload: {ram_before_kb / 1024:.2f} MB")
        print(f"WebContent RSS After Preload:  {ram_after_kb / 1024:.2f} MB")
        print(f"WASM Preload Delta:           +{diff_kb / 1024:.2f} MB ({diff_kb} KB)")
    else:
        print(f"RAM: before={ram_before_kb}, after={ram_after_kb}")

if __name__ == "__main__":
    main()
