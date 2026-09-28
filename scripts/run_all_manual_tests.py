import subprocess
import time
import os
import sys

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

def wait_for_wid(max_retries=50):
    for _ in range(max_retries):
        time.sleep(0.2)
        wid = get_wid()
        if wid:
            return wid
    return None

def kill_petak():
    subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "petak-app"], stderr=subprocess.DEVNULL)
    time.sleep(1.0)

def main():
    print("=== Running Complete End-to-End Manual & Visual Verification on Mac ===")
    os.makedirs("/Users/uqi/petak/docs/phase1/screens", exist_ok=True)
    os.makedirs("/Users/uqi/petak/docs/phase1/logs", exist_ok=True)

    log_file = "/tmp/petak-e2e.log"

    # --- Phase 1: P1.2 (Tree + Tabs + Dirty Dot + Cmd-S + Cmd-W) ---
    print("\n--- [1/3] Testing P1.2: Tree, Tabs, Save, Cmd-W ---")
    kill_petak()
    with open(log_file, "w") as f:
        f.write("")

    app_path = os.path.expanduser("~/petak/target/release/bundle/macos/Petak.app")
    cmd = [
        "open", "-n",
        "--env", "PETAK_TEST_P12=P12",
        "--env", f"PETAK_BENCH_OUT={log_file}",
        app_path
    ]
    subprocess.run(cmd, check=True)
    wid = wait_for_wid()
    print(f"Petak window ID: {wid}")

    tree_captured = False
    for _ in range(60):
        time.sleep(0.3)
        if not os.path.exists(log_file):
            continue
        with open(log_file, "r") as f:
            content = f.read()

        if "P12_SETUP_READY" in content and not tree_captured and wid:
            time.sleep(0.8)
            screen_path = "/Users/uqi/petak/docs/phase1/screens/tree-tabs.png"
            subprocess.run(["screencapture", f"-l{wid}", screen_path], check=True)
            print(f"Captured {screen_path}")
            tree_captured = True
            break

    kill_petak()

    # --- Phase 2: P1.4 (Keymaps + Palette: Cmd-P, Cmd-Shift-F, Shift-Shift, Cmd-E, Alt-Enter, Goto Line) ---
    print("\n--- [2/3] Testing P1.4: Keymaps & Palette ---")
    kill_petak()
    with open(log_file, "w") as f:
        f.write("")

    cmd = [
        "open", "-n",
        "--env", "PETAK_TEST_P14=P14",
        "--env", f"PETAK_BENCH_OUT={log_file}",
        app_path
    ]
    subprocess.run(cmd, check=True)
    wid = wait_for_wid()
    print(f"Petak window ID: {wid}")

    fuzzy_captured = False
    find_captured = False
    all_p14_pass = False

    for _ in range(80):
        time.sleep(0.3)
        if not os.path.exists(log_file):
            continue
        with open(log_file, "r") as f:
            content = f.read()

        if "P14_FUZZY_FINDER_READY" in content and not fuzzy_captured and wid:
            time.sleep(0.8)
            screen_path = "/Users/uqi/petak/docs/phase1/screens/fuzzy-finder.png"
            subprocess.run(["screencapture", f"-l{wid}", screen_path], check=True)
            print(f"Captured {screen_path}")
            fuzzy_captured = True

        if "P14_FIND_IN_PROJECT_READY" in content and not find_captured and wid:
            time.sleep(0.8)
            screen_path = "/Users/uqi/petak/docs/phase1/screens/find-in-project.png"
            subprocess.run(["screencapture", f"-l{wid}", screen_path], check=True)
            print(f"Captured {screen_path}")
            find_captured = True

        if "P14_ALL_TESTS_PASS" in content:
            all_p14_pass = True
            print("P1.4 all test assertions PASSED!")
            break

    kill_petak()

    # --- Phase 3: P1.5 (Terminal: xterm.js + portable-pty, ls, flutter --version, tabs, resize) ---
    print("\n--- [3/3] Testing P1.5: Terminal Panel, Commands, Tabs, Resize ---")
    kill_petak()
    with open(log_file, "w") as f:
        f.write("")

    cmd = [
        "open", "-n",
        "--env", "PETAK_TEST_P15=P15",
        "--env", f"PETAK_BENCH_OUT={log_file}",
        app_path
    ]
    subprocess.run(cmd, check=True)
    wid = wait_for_wid()
    print(f"Petak window ID: {wid}")

    terminal_captured = False
    all_p15_pass = False

    for _ in range(80):
        time.sleep(0.3)
        if not os.path.exists(log_file):
            continue
        with open(log_file, "r") as f:
            content = f.read()

        if "P15_TERMINAL_READY" in content and not terminal_captured and wid:
            time.sleep(1.0)
            screen_path = "/Users/uqi/petak/docs/phase1/screens/terminal.png"
            subprocess.run(["screencapture", f"-l{wid}", screen_path], check=True)
            print(f"Captured {screen_path}")
            terminal_captured = True

        if "P15_ALL_TESTS_PASS" in content:
            all_p15_pass = True
            print("P1.5 all terminal test assertions PASSED!")
            break

    kill_petak()

    print("\n=== Verification Summary ===")
    print(f"P1.2 tree-tabs captured:     {tree_captured}")
    print(f"P1.4 fuzzy-finder captured:  {fuzzy_captured}")
    print(f"P1.4 find-in-proj captured:  {find_captured}")
    print(f"P1.4 assertions passed:      {all_p14_pass}")
    print(f"P1.5 terminal captured:      {terminal_captured}")
    print(f"P1.5 assertions passed:      {all_p15_pass}")

    if not (tree_captured and fuzzy_captured and find_captured and terminal_captured and all_p14_pass and all_p15_pass):
        print("ERROR: One or more verifications failed!")
        sys.exit(1)
    print("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
