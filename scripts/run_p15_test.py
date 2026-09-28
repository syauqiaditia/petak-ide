import subprocess
import time
import os
import sys

log_file = "/Users/uqi/petak/bench.log"
with open(log_file, "w") as f:
    f.write("")

# 1. Kill any existing instances
subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
time.sleep(0.5)

# Step 5 check: measure idle RAM with panel closed
print("Measuring idle RAM with panel closed...")
launch_cmd = [
    "open", "-n",
    "/Users/uqi/petak/target/release/bundle/macos/Petak.app"
]
subprocess.run(launch_cmd, check=True)
time.sleep(4.0)

# Measure RSS for petak-app and WebContent
ps_out = subprocess.check_output(
    "ps -A -o pid,rss,comm | grep -iE 'petak-app|WebContent' | grep -v grep || true",
    shell=True
).decode()
print("Processes found for idle RAM measurement:")
print(ps_out)

idle_rss_kb = 0
for line in ps_out.strip().splitlines():
    parts = line.split()
    if len(parts) >= 2:
        try:
            rss = int(parts[1])
            idle_rss_kb += rss
        except ValueError:
            pass

idle_ram_mb = idle_rss_kb / 1024.0
print(f"Total idle RAM (panel closed): {idle_ram_mb:.2f} MB")

subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
time.sleep(1.0)

# 2. Launch Petak for P1.5 automated terminal test
with open(log_file, "w") as f:
    f.write(f"IDLE_RAM_MB: {idle_ram_mb:.2f}\n")

cmd = [
    "open", "-n",
    "--env", "PETAK_TEST_P15=1",
    "--env", f"PETAK_BENCH_OUT={log_file}",
    "/Users/uqi/petak/target/release/bundle/macos/Petak.app"
]
print(f"Launching Petak test: {' '.join(cmd)}")
subprocess.run(cmd, check=True)

def get_wid():
    cmd = "swift /Users/uqi/petak/scripts/capture_petak.swift"
    try:
        out = subprocess.check_output(cmd, shell=True).decode()
        for line in out.splitlines():
            if "Found Petak window: ID=" in line and ("1440" in line or "name=Petak" in line):
                return line.split("ID=")[1].split()[0]
    except Exception as e:
        print(f"Error checking wid: {e}")
    return None

wid = None
for _ in range(40):
    time.sleep(0.2)
    wid = get_wid()
    if wid:
        print(f"Found wid: {wid}")
        break

terminal_captured = False
os.makedirs("/Users/uqi/petak/docs/phase1/screens", exist_ok=True)

for _ in range(80):
    time.sleep(0.25)
    if not os.path.exists(log_file):
        continue
    with open(log_file, "r") as f:
        content = f.read()

    if "P15_TERMINAL_READY" in content and not terminal_captured and wid:
        time.sleep(0.8)
        ret = os.system(f"screencapture -l{wid} /Users/uqi/petak/docs/phase1/screens/terminal.png")
        print(f"Captured terminal.png (exit code: {ret})")
        terminal_captured = True

    if "P15_ALL_TESTS_PASS" in content:
        print("All P1.5 tests passed!")
        break

time.sleep(0.5)
subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)

print("\n--- Final bench.log contents ---")
if os.path.exists(log_file):
    with open(log_file) as f:
        print(f.read())
