#!/usr/bin/env bash
set -e

APP="/Users/uqi/petak/target/release/bundle/macos/Petak.app"
OUT="/tmp/petak-coldstart.out"

echo "=== Cold Start Benchmark ==="
pkill -x petak-app 2>/dev/null || true
sleep 1

measure_one() {
    : > "$OUT"
    local t_start=$(date +%s%3N)
    open -n --stdout "$OUT" "$APP"
    local ready=""
    local count=0
    while [ $count -lt 100 ]; do
        ready=$(grep "PETAK_READY" "$OUT" 2>/dev/null || true)
        if [ -n "$ready" ]; then
            break
        fi
        sleep 0.05
        count=$((count + 1))
    done
    pkill -x petak-app 2>/dev/null || true
    if [ -z "$ready" ]; then
        echo "FAILED_TO_START"
        return 1
    fi
    local t_ready=$(echo "$ready" | awk '{print $2}')
    local t_end=$(date +%s%3N)
    local delta=$((t_ready - t_start))
    local wall_delta=$((t_end - t_start))
    echo "READY: t_start=$t_start t_ready=$t_ready delta_ms=$delta wall_ms=$wall_delta"
}

echo "--- Run 0 (First Launch) ---"
measure_one
sleep 2

echo "--- Runs 1..5 (Subsequent Runs) ---"
for i in {1..5}; do
    printf "Run %d: " "$i"
    measure_one
    sleep 2
done
