import collections
import glob
import json
import os
import re
import subprocess
import sys


def ymax_of(video, crop=""):
    log = video + (".inner" if crop else "") + ".diff.txt"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", video, "-vf", f"{crop}tblend=all_mode=difference,signalstats,metadata=print:file={log}", "-f", "null", "-"], check=False)
    t = None
    out = []
    if not os.path.exists(log):
        return out
    for line in open(log):
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            t = float(m.group(1))
            continue
        m = re.search(r"lavfi\.signalstats\.YMAX=([0-9.]+)", line)
        if m and t is not None:
            out.append((t, float(m.group(1))))
    return out


for d in sys.argv[1:]:
    report_path = os.path.join(d, "report.json")
    if not os.path.exists(report_path):
        print(f"== {d}: no report.json (the probe didn't finish); log tail:")
        for name in ("probe.log", "sway.log"):
            p = os.path.join(d, name)
            if os.path.exists(p):
                print("".join(open(p).readlines()[-15:]))
        continue
    report = json.load(open(report_path))
    print(f"== {os.path.basename(d)}")
    for row in report:
        name = f"{row['state']}-{'control' if row['window'] == 'control' else 'w' + str(row['window'])}"
        video = os.path.join(d, name + ".mkv")
        frames = ymax_of(video) if os.path.exists(video) else []
        cut = row.get("stopAt")
        dropped = 0
        if cut is not None:
            kept = [f for f in frames if f[0] < cut - 0.25]
            dropped = len(frames) - len(kept)
            frames = kept
        dur = frames[-1][0] - frames[0][0] if len(frames) > 1 else 0
        fps = round(len(frames) / dur, 1) if dur else 0
        hist = collections.Counter(min(int(v // 16) * 16, 128) for _, v in frames)
        big = [(round(t, 3), v) for t, v in frames if v >= 48]
        floor = min((v for _, v in frames), default=0)
        above = [(round(t, 3), v) for t, v in frames if v > floor]
        line = f"  {name}: {len(frames)} frames (~{fps} fps, {dropped} after stop dropped), YMAX min {floor} max {max((v for _, v in frames), default=0)}, frames above min: {len(above)}, histogram {sorted(hist.items())}, frames with YMAX>=48: {len(big)}"
        if above and row["window"] != "control":
            inner = dict(ymax_of(video, "crop=iw-32:ih:0:0,"))
            outside = [(t0, v) for t0, v in above if inner.get(t0, floor) > floor]
            line += f"; of those, outside the right 32px scrollbar strip: {len(outside)} {outside[:6]}"
        line += f"; trace: {row['rafSamples']} rAF + {row.get('timerSamples', 0)} timer samples, {row['geometryMoves']} geometry moves, {row['scrollTopWritesThatMoved']} moving scrollTop writes, {row['resizeCallbacks']} resize callbacks"
        print(line)
        if row["window"] == "control":
            print(f"    control pulses (seconds from record start, frames): {[(round(p['at'], 2), p['frames']) for p in row['pulses']]}")
            print(f"    control detections: {big[:24]}")
        elif above:
            print(f"    first changes above min: {above[:12]}")
