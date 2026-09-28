import os
import shutil
import subprocess

def main():
    target = os.path.expanduser("~/petak/target")
    paths_to_clean = [
        os.path.join(target, "release", "build"),
        os.path.join(target, "release", "deps"),
        os.path.join(target, "debug"),
    ]

    for p in paths_to_clean:
        if os.path.exists(p):
            print(f"Removing {p}...")
            shutil.rmtree(p, ignore_errors=True)

    print("\n--- Disk Usage on Mac ---")
    subprocess.run(["df", "-h", "/"])

if __name__ == "__main__":
    main()
