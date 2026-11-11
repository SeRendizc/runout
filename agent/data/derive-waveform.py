"""Derive a causal 2-station RMS cue from the verified Nepal event MiniSEED."""

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import obspy
from obspy import UTCDateTime, read


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw/Nepal_event_2026-08-26T025216_all_stations.mseed"
OUT = HERE / "derived/nepal-waveform.json"
SHA256 = "924eb45ed2746882a56a1b2bdae8f09dd19fcf1c1545b898ca200567e10ea0da"
START = UTCDateTime("2026-08-26T02:50:00Z")
CHANNELS = ("NK.KKN..BHN", "NK.PKIN..SHZ")
BASELINE_SECONDS = 90
THRESHOLD = 8.0
SUSTAIN_SECONDS = 2
REPLAY_INGEST_SECONDS = 8


def detect(trace):
    # The selected channels are continuous over the replay window. Avoid
    # implicitly merging the overlapping miniSEED fragments in other channels.
    rate = int(trace.stats.sampling_rate)
    sample_offset = round((START - trace.stats.starttime) * rate)
    if sample_offset < 0 or abs(trace.stats.starttime + sample_offset / rate - START) > 1e-5:
        raise ValueError(f"{trace.id} cannot align to the replay clock")
    values = np.asarray(trace.data[sample_offset:], dtype=np.float64)
    seconds = len(values) // rate
    if seconds < 2 * BASELINE_SECONDS:
        raise ValueError(f"{trace.id} has incomplete samples")
    windows = values[:seconds * rate].reshape(-1, rate)
    rms = np.sqrt(np.mean(np.diff(windows, axis=1) ** 2, axis=1))
    baseline = float(np.median(rms[:BASELINE_SECONDS]))
    if baseline <= 0:
        raise ValueError(f"{trace.id} has no usable pre-event baseline")
    ratios = rms / baseline
    picked = next((second for second in range(BASELINE_SECONDS, seconds - SUSTAIN_SECONDS + 1)
                   if min(ratios[second:second + SUSTAIN_SECONDS]) >= THRESHOLD), None)
    if picked is None:
        raise ValueError(f"No detected cue in {trace.id}")
    return {
        "channel": trace.id,
        "samplingHz": rate,
        "availableSamples": int(trace.stats.npts),
        "baselineRmsCounts": round(baseline, 3),
        "firstAboveSecond": picked,
        "decisionAtSecond": picked + SUSTAIN_SECONDS,
        "ratios": [round(float(x), 3) for x in ratios[picked:picked + SUSTAIN_SECONDS]],
    }


def main():
    digest = hashlib.sha256(RAW.read_bytes()).hexdigest()
    if digest != SHA256:
        raise ValueError(f"Unexpected MiniSEED SHA-256 {digest}")
    stream = read(str(RAW))
    picks = []
    for channel in CHANNELS:
        traces = stream.select(id=channel)
        if len(traces) != 1:
            raise ValueError(f"Expected one continuous trace for {channel}, got {len(traces)}")
        picks.append(detect(traces[0]))
    evidence_end = max(pick["decisionAtSecond"] for pick in picks)
    observed_at = max(pick["firstAboveSecond"] for pick in picks)
    if abs(picks[0]["firstAboveSecond"] - picks[1]["firstAboveSecond"]) > 12:
        raise ValueError("Stations do not corroborate within the 12-second cue gate")
    result = {
        "sourceId": "zenodo-nepal-mseed",
        "startAt": str(START),
        "observedAt": observed_at,
        "evidenceEndAt": evidence_end,
        "availableAt": int(math.ceil(evidence_end + REPLAY_INGEST_SECONDS)),
        "replayIngestSeconds": REPLAY_INGEST_SECONDS,
        "detector": {
            "id": "two-station-difference-rms-v1",
            "feature": "one-second RMS of first differences in uncalibrated counts",
            "baselineSeconds": BASELINE_SECONDS,
            "relativeThreshold": THRESHOLD,
            "sustainSeconds": SUSTAIN_SECONDS,
            "processingLibrary": f"ObsPy {obspy.__version__}",
        },
        "picks": picks,
        "archive": {
            "path": "raw/" + RAW.name,
            "sha256": digest,
            "license": "CC-BY-4.0",
            "traceSegments": len(stream),
            "distinctChannels": len({trace.id for trace in stream}),
        },
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.name}: corroboration T+{observed_at}s, replay visibility T+{result['availableAt']}s")


if __name__ == "__main__":
    main()
