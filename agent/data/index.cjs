"use strict";

const waveform = require("./derived/nepal-waveform.json");
const corpus = require("./posts.cjs");

const sources = {
  "zenodo-nepal-mseed": {
    id: "zenodo-nepal-mseed", kind: "waveform", synthetic: false,
    name: "NEMRC / SASIN 尼泊尔实测台站波形",
    url: "https://doi.org/10.5281/zenodo.22338896",
    downloadUrl: "https://zenodo.org/records/22338896/files/Nepal_event_2026-08-26T025216_all_stations.mseed?download=1",
    publishedAt: "2026-09-05",
    license: "CC-BY-4.0",
    creators: "Lok Bijaya Adhikari and Shiba Subedi",
    md5: "4751372c87f06eaa53c42ca62c302c27",
    archive: waveform.archive,
    acquisition: "下载后验证 MD5 和 SHA-256。回放送达时间来自本地假设，未重建实况数据链。"
  },
  "seismica-source-study": {
    id: "seismica-source-study", kind: "reference", synthetic: false,
    name: "Tsangbu Ri 地震源区同行评议研究",
    url: "https://doi.org/10.26443/seismica.v5i2.3433",
    referenceOnly: true
  },
  "gyirong-source-study": {
    id: "gyirong-source-study", kind: "reference", synthetic: false,
    name: "吉隆冰岩崩过程研究",
    url: "https://doi.org/10.1007/s11629-026-1482-y",
    referenceOnly: true
  },
  "nepal-chwrr": {
    id: "nepal-chwrr", kind: "reference", synthetic: false,
    name: "尼泊尔 CHWRR 灾后技术报告",
    url: "https://hydrology.gov.np/cm/files/Bhotekoshi-Trishuli-Narayani_Flood_Report_CHWRR_1%20_1787809133090.pdf",
    referenceOnly: true,
    scope: "事后机构发报及水文报告，未作为运行时先验，亦未给出个人手机送达时间。"
  },
  "purepu-report": {
    id: "purepu-report", kind: "reference", synthetic: false,
    name: "2025 Purepu 灾后来源报告",
    url: "https://ndrrma.gov.np/mediafiles/publications/Rasuwagadhi_Flood_Sitrep1_08072025_.pdf",
    referenceOnly: true
  },
  "andes-report": {
    id: "andes-report", kind: "reference", synthetic: false,
    name: "Villa Santa Lucía 现场调查",
    url: "https://nhess.copernicus.org/articles/20/2319/2020/",
    referenceOnly: true
  },
  "synthetic-social": {
    id: "synthetic-social", kind: "post", synthetic: true,
    name: "三语合成贴文库",
    acquisition: "人工编写的虚构文本、账号和时钟。"
  }
};

const localTimes = {
  "01": "2026-08-26T02:50:00.000Z",
  "02": "2025-07-07T21:00:00.000Z",
  "09": "2026-08-26T02:50:00.000Z",
  andes: "2017-12-16T11:30:00.000Z"
};
const baseExerciseStart = "2026-11-10T00:00:00.000Z";
const coordinates = {
  ice: [85.52723, 28.2877],
  purepu: [85.646705, 28.402561],
  north: [85.370, 28.414],
  west: [85.410, 28.409],
  east: [85.450, 28.369],
  east2: [85.507, 28.312],
  south: [85.420, 28.165],
  bridge: [85.395, 28.240],
  lhendeBend: [85.45797, 28.33686],
  northernReach: [85.35146, 28.38528],
  southernReach: [85.39967, 28.15504],
  easternReach: [85.44564, 28.34476],
  bridgeReach: [85.35371, 28.21038],
  timureGauge: [85.36492, 28.25089],
  rasuwaPort: [85.37770, 28.27740],
  andesSource: [-72.42874, -43.36223],
  andesReach: [-72.373, -43.396]
};

function terminal(id, name, lon, lat, walkSeconds) {
  return { id, name, lon, lat, walkSeconds };
}

const port = terminal("port", "吉隆口岸 / Rasuwagadhi", ...coordinates.rasuwaPort, 315);
const timure = terminal("timure", "Timure 河岸演练点", 85.36568, 28.25285, 264);
const syapru = terminal("syapru", "Syapru Besi", 85.34273, 28.16588, 306);
const northGully = terminal("north-gully", "中国侧沟口", 85.35819, 28.37342, 198);
const southGully = terminal("south-gully", "尼泊尔侧沟口", 85.37725, 28.15208, 192);
const valley = [port, timure, syapru];

function event(id, kind, sourceId, observedAt, availableAt, payload) {
  return {
    id, kind, sourceId, observedAt, availableAt, synthetic: true, ...payload
  };
}

function release(id, coordinate, observedAt, delay, sourceType, label, extra = {}) {
  const [lon, lat] = coordinates[coordinate];
  return event(id, "camera", "sim-camera-" + coordinate, observedAt, observedAt + delay, {
    label, lon, lat, sourceType, releaseId: id, releaseAt: observedAt,
    role: "release_candidate", trigger: true, confidence: 0.85, ...extra
  });
}

function downstream(id, kind, coordinate, observedAt, delay, label, extra = {}) {
  const [lon, lat] = coordinates[coordinate];
  const stationId = "sim-" + kind + "-" + coordinate;
  return event(id, kind, stationId, observedAt, observedAt + delay, {
    label, lon, lat, role: "downstream_constraint", trigger: false,
    confidence: kind === "gauge" ? 0.91 : 0.82,
    ...(kind === "gauge" ? { feature: "simulated_wave_front_detected" }
      : { feature: "simulated_first_front_frame" }), ...extra
  });
}

const realCue = {
  id: "s01-waveform-corroboration",
  kind: "waveform", sourceId: waveform.sourceId, synthetic: false,
  label: "KKN / PKIN 实测振动异常",
  observedAt: waveform.observedAt, availableAt: waveform.availableAt,
  publishedAt: null, ingestedAt: null,
  evidenceEndAt: waveform.evidenceEndAt, replayIngestSeconds: waveform.replayIngestSeconds,
  role: "release_candidate", trigger: true, sourceType: "ice", releaseId: "s01-waveform-corroboration",
  lon: coordinates.ice[0], lat: coordinates.ice[1], releaseAt: 136, releaseWindow: [130, 143],
  confidence: 0.76,
  feature: "motion_anomaly",
  detector: waveform.detector, picks: waveform.picks, archive: waveform.archive,
  evidenceScope: "waveform_anomaly_only",
  locationBasis: "retrospective-hypothesis",
  sourceHypothesisSynthetic: true,
  sourceHypothesis: {
    locationBasis: "事后资料约束的演练源区假设，并非从台站样本自动定位。",
    timeBasis: "相对零点的工作假设，区间涵盖多来源参考时刻。",
    sourceIds: ["seismica-source-study", "gyirong-source-study"]
  },
  summary: "两个真实台站的持续振动异常，源区和释放时钟是重建回放假设。"
};

const cases = {
  "01": {
    title: "吉隆冰岩崩", duration: 1600, terminals: valley, familyId: "rasuwa-2026",
    references: ["seismica-source-study", "gyirong-source-study", "nepal-chwrr"],
    observations: [
      realCue,
      downstream("s01-cam-bend", "camera", "lhendeBend", 345, 21, "模拟东林藏布弯道相机确认"),
      downstream("s01-gauge-timure", "gauge", "timureGauge", 650, 19, "模拟 Timure 河段过流站")
    ]
  },
  "02": {
    title: "Purepu 冰面湖溃决", duration: 3200, terminals: valley, familyId: "purepu-2025",
    references: ["purepu-report"],
    observations: [
      release("s02-purepu-source", "purepu", 180, 55, "lake", "模拟 Purepu 释放候选", { capMeters: 54000 }),
      downstream("s02-cam-bend", "camera", "lhendeBend", 1350, 35, "模拟东林藏布弯道相机确认"),
      downstream("s02-gauge-timure", "gauge", "timureGauge", 1960, 30, "模拟 Timure 河段过流站")
    ]
  },
  "03": {
    title: "北坡支沟", duration: 980, terminals: [northGully, port], familyId: "local-north",
    observations: [
      release("s03-north-source", "north", 20, 50, "small", "模拟北坡释放候选", { capMeters: 11000 }),
      downstream("s03-gauge-north", "gauge", "northernReach", 212, 18, "模拟北坡支沟过流站")
    ]
  },
  "04": {
    title: "南坡支谷", duration: 900, terminals: [southGully, syapru, port], familyId: "local-south",
    observations: [
      release("s04-south-source", "south", 18, 47, "small", "模拟南坡释放候选", { capMeters: 10800 }),
      downstream("s04-gauge-south", "gauge", "southernReach", 148, 16, "模拟尼泊尔支谷过流站")
    ]
  },
  "05": {
    title: "一脊之隔", duration: 830, familyId: "ridge-local",
    terminals: [
      terminal("east-gully", "谷底演练点", 85.43779, 28.33488, 144),
      terminal("ridge-control", "隔脊演练点", 85.42658, 28.33191, 0)
    ],
    observations: [
      release("s05-ridge-source", "east", 15, 34, "small", "模拟东侧支沟释放候选", { capMeters: 9200 }),
      downstream("s05-gauge-east", "gauge", "easternReach", 151, 15, "模拟东侧谷底过流站")
    ]
  },
  "06": {
    title: "双源汇合", duration: 2100, terminals: valley, familyId: "dual-joint",
    observations: [
      release("s06-north-source", "north", 24, 32, "large", "模拟北支 A 释放候选", { capMeters: 36000 }),
      release("s06-east-source", "east", 24, 58, "large", "模拟东支 B 释放候选", { capMeters: 30500 }),
      downstream("s06-cam-north", "camera", "northernReach", 222, 20, "模拟北支相机确认", { releaseId: "s06-north-source" }),
      downstream("s06-cam-east", "camera", "easternReach", 135, 17, "模拟东支相机确认", { releaseId: "s06-east-source" }),
      downstream("s06-gauge-port", "gauge", "rasuwaPort", 765, 15, "模拟汇流口过流站")
    ]
  },
  "07": {
    title: "第二波", duration: 3300, terminals: valley, familyId: "dual-joint",
    observations: [
      release("s07-first-source", "west", 28, 48, "large", "模拟首波释放候选", { capMeters: 40500 }),
      release("s07-second-source", "east2", 550, 49, "small", "模拟第二源释放候选", { capMeters: 32400 }),
      downstream("s07-gauge-port-first", "gauge", "rasuwaPort", 875, 21, "模拟口岸首波过流", { releaseId: "s07-first-source" }),
      downstream("s07-gauge-port-second", "gauge", "rasuwaPort", 1640, 23, "模拟口岸第二波过流", { releaseId: "s07-second-source" })
    ]
  },
  "08": {
    title: "并发两谷", duration: 950, familyId: "independent-valleys",
    terminals: [northGully, southGully],
    observations: [
      release("s08-north-source", "north", 20, 37, "small", "模拟北谷 A 释放候选", { capMeters: 11000 }),
      release("s08-south-source", "south", 20, 61, "small", "模拟南谷 B 释放候选", { capMeters: 10500 }),
      downstream("s08-gauge-north", "gauge", "northernReach", 215, 20, "模拟北谷过流站", { releaseId: "s08-north-source" }),
      downstream("s08-gauge-south", "gauge", "southernReach", 162, 22, "模拟南谷过流站", { releaseId: "s08-south-source" })
    ]
  },
  "09": {
    title: "信号中断", duration: 1700, terminals: valley, familyId: "rasuwa-2026",
    references: ["nepal-chwrr"],
    observations: [
      event("s09-upstream-offline", "offline", "sim-upstream-status", 80, 85, {
        label: "模拟上游波形流离线", role: "sensor_outage", targetKind: "waveform"
      }),
      release("s09-port-front", "rasuwaPort", 575, 64, "large", "模拟口岸画面恢复后确认过流", { capMeters: 19500 }),
      downstream("s09-gauge-timure", "gauge", "timureGauge", 655, 26, "模拟 Timure 延迟送达")
    ]
  },
  "10": {
    title: "桥先失效", duration: 1200, familyId: "bridge-local",
    terminals: [
      terminal("bridge-near", "谷口演练点", 85.35371, 28.21038, 294),
      terminal("bridge-far", "下游演练点", 85.33577, 28.15998, 396)
    ],
    observations: [
      release("s10-bridge-source", "bridge", 28, 58, "small", "模拟尼泊尔支谷释放候选", { capMeters: 13800 }),
      event("s10-bridge-closed", "offline", "sim-bridge-status", 230, 251, {
        label: "模拟演练桥关闭", lon: 85.35819, lat: 28.22026,
        role: "bridge_closure", closureAt: 230
      }),
      downstream("s10-gauge-near", "gauge", "bridgeReach", 280, 40, "模拟支谷口回报")
    ]
  },
  andes: {
    title: "Villa Santa Lucía", duration: 1200, basin: "andes", familyId: "andes-santa-lucia",
    references: ["andes-report"],
    terminals: [
      terminal("canyon", "Burritos 峡谷", -72.374, -43.396, 204),
      terminal("villa", "Villa Santa Lucía", -72.367, -43.413, 282),
      terminal("fan", "冲积扇南缘", -72.373, -43.421, 198)
    ],
    observations: [
      release("andes-source", "andesSource", 30, 44, "andes", "模拟 Río Burritos 源区候选", { capMeters: 12700 }),
      downstream("andes-canyon-camera", "camera", "andesReach", 355, 18, "模拟 Río Burritos 峡谷画面")
    ]
  }
};

const catalog = Object.entries(cases).map(([id, spec]) => ({
  id, title: spec.title, basin: spec.basin || "himalaya",
  example: id === "andes", familyId: spec.familyId
})).sort((a, b) => (a.example ? 99 : Number(a.id)) - (b.example ? 99 : Number(b.id)));

function sourceEntry(id, observations) {
  if (sources[id]) return sources[id];
  const row = observations.find(candidate => candidate.sourceId === id);
  if (!row) throw new Error("Missing source entry for " + id);
  return {
    id, kind: row.kind, synthetic: true, name: row.label,
    acquisition: "虚构站点或画面，时间仅用于演练。"
  };
}

function loadScenario(id) {
  if (!Object.hasOwn(cases, id)) throw new RangeError("Unknown replay case: " + id);
  const spec = cases[id];
  // Keep answer labels, candidate locations and evaluation partitions out of the live post queue.
  const posts = corpus.filter(record => record.truth.caseId === id).map(record => record.observation);
  const observations = [...spec.observations, ...posts].map((row, index) => ({ ...row, seq: index + 1 }))
    .sort((a, b) => (a.availableAt - b.availableAt) || (a.seq - b.seq));
  const sourceIds = [...new Set([...observations.map(row => row.sourceId), ...(spec.references || [])])];
  return structuredClone({
    id, title: spec.title, startAt: localTimes[id] || baseExerciseStart,
    duration: spec.duration, basin: spec.basin || "himalaya",
    terminals: spec.terminals, observations,
    sources: sourceIds.map(sourceId => sourceEntry(sourceId, observations)),
    provenance: {
      familyId: spec.familyId,
      clock: "UTC with relative replay seconds",
      scope: id === "01" ? "real station samples, retrospective source hypothesis, synthetic ingestion/constraints/posts"
        : "synthetic live evidence and replay clock; any historical references are offline context"
    }
  });
}

module.exports = { catalog, loadScenario };
