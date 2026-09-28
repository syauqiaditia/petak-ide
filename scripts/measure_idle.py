import subprocess
import time
import os
import sys

def get_webcontent_pids():
    try:
        out = subprocess.check_output(["pgrep", "-f", "com.apple.WebKit.WebContent"], text=True)
        return set(int(p) for p in out.strip().splitlines() if p.strip())
    except subprocess.CalledProcessError:
        return set()

def main():
    print("=== Petak Idle RAM & CPU Measurement (30s sample) ===")

    # 1. Kill any existing petak-app
    subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "petak-app"], stderr=subprocess.DEVNULL)
    time.sleep(2.0)

    pids_before = get_webcontent_pids()

    # 2. Launch Petak normally (project folder opened via recent.json, terminal closed)
    app_path = os.path.expanduser("~/petak/target/release/bundle/macos/Petak.app")
    cmd = ["open", "-n", app_path]
    print(f"Launching {app_path}...")
    subprocess.run(cmd, check=True)

    # Wait for app and WebKit to spawn
    petak_pid = None
    webcontent_pid = None

    for _ in range(30):
        time.sleep(0.5)
        if not petak_pid:
            try:
                out = subprocess.check_output(["pgrep", "-x", "petak-app"], text=True).strip()
                if out:
                    petak_pid = int(out.splitlines()[0])
            except Exception:
                pass

        if not webcontent_pid:
            pids_now = get_webcontent_pids()
            new_pids = pids_now - pids_before
            if new_pids:
                webcontent_pid = list(new_pids)[0]

        if petak_pid and webcontent_pid:
            break

    print(f"Petak App PID: {petak_pid}")
    print(f"Petak WebContent PID: {webcontent_pid}")

    if not petak_pid:
        print("ERROR: petak-app process not found!")
        sys.exit(1)

    # Settle time (10 seconds) so initial indexing & render completely finish
    print("Waiting 10s for application to settle into idle state...")
    time.sleep(10.0)

    # Measure RAM (RSS)
    def get_rss_kb(pid):
        if not pid:
            return 0
        try:
            out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)], text=True).strip()
            return int(out)
        except Exception:
            return 0

    rss_app_kb = get_rss_kb(petak_pid)
    rss_web_kb = get_rss_kb(webcontent_pid)
    total_ram_kb = rss_app_kb + rss_web_kb
    total_ram_mb = total_ram_kb / 1024.0

    print(f"\n--- Idle RAM Measurement ---")
    print(f"petak-app RSS:    {rss_app_kb} KB ({rss_app_kb / 1024.0:.2f} MB)")
    if webcontent_pid:
        print(f"WebContent RSS:   {rss_web_kb} KB ({rss_web_kb / 1024.0:.2f} MB)")
    print(f"Total Idle RAM:   {total_ram_kb} KB ({total_ram_mb:.2f} MB)")
    print(f"Budget: < 150 MB -> {'PASS' if total_ram_mb < 150.0 else 'FAIL'}")

    # Sample CPU % over 30 seconds (1 sample per second)
    print(f"\n--- Idle CPU Sampling (30 seconds, 1 sample/sec) ---")
    cpu_samples_app = []
    cpu_samples_web = []
    cpu_samples_total = []

    for sec in range(1, 31):
        time.sleep(1.0)
        def get_cpu(pid):
            if not pid:
                return 0.0
            try:
                out = subprocess.check_output(["ps", "-o", "%cpu=", "-p", str(pid)], text=True).strip()
                return float(out)
            except Exception:
                return 0.0

        cpu_app = get_cpu(petak_pid)
        cpu_web = get_cpu(webcontent_pid)
        cpu_tot = cpu_app + cpu_web

        cpu_samples_app.append(cpu_app)
        cpu_samples_web.append(cpu_web)
        cpu_samples_total.append(cpu_tot)
        print(f"Sample {sec:2d}/30: app={cpu_app:.1f}%, web={cpu_web:.1f}%, total={cpu_tot:.1f}%")

    avg_cpu_app = sum(cpu_samples_app) / len(cpu_samples_app)
    avg_cpu_web = sum(cpu_samples_web) / len(cpu_samples_web)
    avg_cpu_tot = sum(cpu_samples_total) / len(cpu_samples_total)
    max_cpu_tot = max(cpu_samples_total)

    print(f"\n--- CPU Summary (30s) ---")
    print(f"Average petak-app:   {avg_cpu_app:.2f}%")
    print(f"Average WebContent:  {avg_cpu_web:.2f}%")
    print(f"Average Total CPU:   {avg_cpu_tot:.2f}%")
    print(f"Max Total CPU:       {max_cpu_tot:.2f}%")
    print(f"Budget: ~0% (idle) -> {'PASS' if avg_cpu_tot < 2.0 else 'FAIL'}")

    # Terminate Petak
    subprocess.run(["pkill", "-x", "petak-app"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "petak-app"], stderr=subprocess.DEVNULL)

    # Save summary json
    summary = {
        "petak_pid": petak_pid,
        "webcontent_pid": webcontent_pid,
        "ram": {
            "app_rss_kb": rss_app_kb,
            "webcontent_rss_kb": rss_web_kb,
            "total_rss_kb": total_ram_kb,
            "total_ram_mb": round(total_ram_mb, 2),
            "pass_150mb": total_ram_mb < 150.0
        },
        "cpu_30s": {
            "avg_app_percent": round(avg_cpu_app, 2),
            "avg_webcontent_percent": round(avg_cpu_web, 2),
            "avg_total_percent": round(avg_cpu_tot, 2),
            "max_total_percent": round(max_cpu_tot, 2),
            "samples_total": cpu_samples_total,
            "pass_idle": avg_cpu_tot < 2.0
        }
    }

    log_path = "/Users/uqi/petak/docs/phase1/logs/idle-ram-cpu.json"
    import json
    with open(log_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nResults saved to {log_path}")

if __name__ == "__main__":
    main()
