# RUNOUT replay data

`index.cjs` exports `catalog` and `loadScenario(id)`. Each call returns its own scenario object. A scenario includes UTC replay zero, duration in seconds, terminal fixture locations, ordered observations and a source manifest. `sourceId` names the provider or exercise station. `releaseId` identifies a separate physical release when the observation can be associated with one.

`availableAt` is when the replay can use a record. It is distinct from the sampled or reported `observedAt`. A stage gauge, a camera frame or a first station anomaly does not independently determine the release time. Posted reports can appear after their claimed observation. For the real waveform, original network receipt and live dispatch times remain unknown. The delay in this replay is explicit.

## 2026 Nepal station archive

- Lok Bijaya Adhikari and Shiba Subedi, *Seismic Waveform Dataset for the 26 August 2026 Tsangbu Ri Slope Failure and Flash Flood, Nepal*, v1.0. [Zenodo DOI](https://doi.org/10.5281/zenodo.22338896), CC BY 4.0.
- File [MiniSEED](https://zenodo.org/records/22338896/files/Nepal_event_2026-08-26T025216_all_stations.mseed?download=1), 3,081,728 bytes. MD5 `4751372c87f06eaa53c42ca62c302c27`. SHA-256 `924eb45ed2746882a56a1b2bdae8f09dd19fcf1c1545b898ca200567e10ea0da`.
- Regenerate the derived JSON with `python3 agent/data/derive-waveform.py` from the `valley-relay` directory using ObsPy 1.5.1. The script checks the raw checksum, selects two continuous 50 Hz channels, computes the one-second RMS of first differences in uncalibrated counts, and picks two successive windows above eight times each channel's first 90 seconds of baseline median. KKN and PKIN cross the criterion at T+149 s and T+153 s. A two-second confirmation and an assumed eight-second ingest delay make the cue visible at T+163 s. This simple detector was only exercised on the bundled event. Its precision or false-positive rate in operational use has not been measured.
- The fixture supplies a **retrospective release hypothesis** alongside the waveform anomaly. Its source coordinate, release time, release type and confidence are assumptions. They are not automatic station localization or telemetry observed at the time. The synthetic gauge and camera observations change the working forecast during playback. Historical references are source metadata outside the event queue. No future disaster report or prerecorded film-arrival array is consumed as a live input.

## Synthetic corpus and cases

`posts.cjs` contains 120 unique synthetic posts in Chinese, English and Nepali. There are 65 routine posts, 25 witness clues and 30 confounders, including forwards with original IDs, old footage, vague names, reposts, lookalikes and instruction-like text. Run `node agent/data/posts.cjs` for a JSON export including partition, cluster, label and intended place. The live queue contains the posts without these evaluation answers. The two Rasuwa variants share a partition, as do the two common-confluence variants and the independent local-valley family.

Cases 01–10 and the Andes example contain synthetic exercise terminals, time delays, paths' input hypotheses, and source enablement evidence. Only the 01 waveform samples and their derived cue are replayed from a real raw observation. Other cited events provide historical context. The scenario clock starts are replay labels, not claims about exact disaster origin times. Gauge station coordinates and detections are exercise fixtures unless explicitly identified otherwise.
