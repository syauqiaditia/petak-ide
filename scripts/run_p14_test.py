import subprocess
import time
import os
import sys

log_file = "/Users/uqi/petak/bench.log"
with open(log_file, "w") as f:
    f.write("")

subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
time.sleep(0.5)

cmd = [
    "open", "-n",
    "--env", "PETAK_TEST_P14=1",
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

fuzzy_captured = False
grep_captured = False

os.makedirs("/Users/uqi/petak/docs/phase1/screens", exist_ok=True)

for _ in range(60):
    time.sleep(0.25)
    if not os.path.exists(log_file):
        continue
    with open(log_file, "r") as f:
        content = f.read()

    if "P14_FUZZY_FINDER_READY" in content and not fuzzy_captured and wid:
        time.sleep(0.5)
        os.system(f"screencapture -l{wid} /Users/uqi/petak/docs/phase1/screens/fuzzy-finder.png")
        print("Captured fuzzy-finder.png")
        fuzzy_captured = True

    if "P14_FIND_IN_PROJECT_READY" in content and not grep_captured and wid:
        time.sleep(0.5)
        os.system(f"screencapture -l{wid} /Users/uqi/petak/docs/phase1/screens/find-in-project.png")
        print("Captured find-in-project.png")
        grep_captured = True

    if "P14_ALL_TESTS_PASS" in content:
        print("All tests passed!")
        break

time.sleep(0.5)
subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)

print("Log contents:")
if os.path.exists(log_file):
    with open(log_file) as f:
        print(f.read())
