#!/usr/bin/env bash
set -euo pipefail
package=app.marmaladeplayer.mobile
# One shell owns the variables and trap for the entire test.
# Stream logs from before launch, so a disappearing emulator cannot erase evidence.
timeout 30 adb shell getprop sys.boot_completed | grep -q '^1'
timeout 30 adb shell dumpsys webviewupdate | tee marmalade-webview.txt
# Allow first-boot initialization to settle before launching the app.
sleep 20
adb logcat -c
adb logcat -v threadtime > marmalade-logcat.txt 2>&1 &
log_pid=$!
cleanup(){
  timeout 15 adb logcat -d -s AndroidRuntime:E > marmalade-runtime.txt 2>&1 || true
  timeout 15 adb exec-out screencap -p > marmalade-screen.png 2>/dev/null || true
  kill "$log_pid" 2>/dev/null || true
}
trap cleanup EXIT
timeout 90 adb install candidate/app-debug.apk
timeout 60 adb shell am start -W -n "$package/.MainActivity" | tee marmalade-launch.txt
grep -F 'Status: ok' marmalade-launch.txt
# Capture evidence immediately and again after a sustained foreground launch.
timeout 15 adb exec-out screencap -p > marmalade-startup.png
for i in 1 2 3; do
  sleep 4
  if ! timeout 30 adb shell pidof "$package" | grep -Eq '[0-9]'; then
    echo "Application process unavailable; checking emulator transport" >&2
    timeout 10 adb devices -l || true
    timeout 10 adb shell getprop sys.boot_completed || true
    tail -80 marmalade-logcat.txt || true
    exit 1
  fi
done
timeout 20 adb shell dumpsys activity activities > marmalade-activities.txt
grep -E "(mResumedActivity|topResumedActivity).*app[.]marmaladeplayer[.]mobile" marmalade-activities.txt
timeout 15 adb logcat -d -s AndroidRuntime:E > marmalade-runtime.txt
if grep -A 5 -F 'FATAL EXCEPTION' marmalade-runtime.txt | grep -F "Process: $package"; then
  echo 'MarmaladePlayer crashed on Android emulator' >&2
  exit 1
fi
echo 'PASS Android emulator: APK installed, activity launched and process survived 12 seconds'
