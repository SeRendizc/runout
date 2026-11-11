"use strict";

function figureCoordinate(x, y) {
  // Approximate affine read from the labelled graticule of Figure 1b.
  return [
    -72.425 + (x - (668 - 0.029 * (y - 27))) / 5060,
    -43.350 - (y - 44 - 0.032 * (x - 578)) / 7100
  ];
}

globalThis.ValleyScenes = {
  himalaya: {
    region: "喜马拉雅 · 中尼边境",
    title: "吉隆跨境河谷",
    date: "2026.08.26",
    description: "冰岩崩进入 Lhende 河谷。观察波前在口岸汇流后怎样转入下游。",
    source: [85.52723, 28.2877],
    sites: [
      { name: "吉隆口岸", coordinate: [85.3777, 28.2774], walk: 7 },
      { name: "Timure", coordinate: [85.36667, 28.25285], walk: 5 },
      { name: "Syapru Besi", coordinate: [85.34273, 28.16588], walk: 8 },
      { name: "山脊对照点", coordinate: [85.438, 28.233], walk: 5 }
    ],
    references: [
      ["ICIMOD 事件复盘", "https://lib.icimod.org/records/r745z-mvm84"],
      ["源区判读和测点地图", "https://gyirong-rasuwa-flood.yilaoweather.org/en"]
    ],
    historical: "GFZ 将源区振动和口岸首波间隔回溯为约 7 分钟。历史锚点仅用于对照。",
    anchor: "吉隆口岸",
    documentedLength: "约 22 公里",
    documentedTime: "约 7 分钟",
    gap: "Timure 城镇有实际受灾记录，当前演练点却落在模拟范围外。"
  },
  andes: {
    region: "安第斯 · 智利巴塔哥尼亚",
    title: "Villa Santa Lucía",
    date: "2017.12.16",
    description: "Yelcho 山区岩体滑塌，泥流沿 Río Burritos 下行，在聚落附近展开。",
    source: figureCoordinate(646, 133),
    sites: [
      { name: "Burritos 峡谷", coordinate: figureCoordinate(924, 377), walk: 4 },
      { name: "Villa Santa Lucía", coordinate: [-72.367, -43.413], walk: 3.5 },
      { name: "冲积扇南缘", coordinate: figureCoordinate(899, 551), walk: 5 },
      { name: "山脊对照点", coordinate: [-72.410, -43.415], walk: 5 }
    ],
    observed: [
      [638,116], [655,116], [675,129], [690,151], [694,164], [723,186],
      [748,205], [769,210], [791,217], [810,216], [824,225], [843,230],
      [855,230], [880,223], [902,225], [918,250], [930,277], [946,284],
      [969,306], [994,304], [995,324], [978,328], [958,335], [946,328],
      [932,334], [921,333], [921,352], [926,368], [924,384], [922,407],
      [932,428], [945,449], [963,461], [977,475], [965,487], [970,500],
      [957,513], [943,521], [939,507], [930,514], [923,534], [915,547],
      [914,557], [904,575], [913,593], [907,597], [893,574], [891,555],
      [898,545], [898,533], [904,516], [918,505], [918,497], [906,489],
      [911,473], [925,459], [931,442], [926,425], [918,410], [918,394],
      [916,382], [916,362], [914,345], [918,324], [920,311], [911,293],
      [903,294], [890,298], [872,294], [863,288], [853,294], [850,311],
      [839,294], [827,288], [817,273], [804,258], [787,239], [764,230],
      [747,219], [724,207], [703,192], [682,177], [660,162], [641,151],
      [630,136], [629,125]
    ].map(([x, y]) => figureCoordinate(x, y)),
    references: [
      ["现场调查与灾后范围 · 图 1b", "https://nhess.copernicus.org/articles/20/2319/2020/"],
      ["智利大学地震信号复盘", "https://uchile.cl/noticias/242514/nuevos-antecedentes-sobre-aluvion-de-2017-en-villa-santa-lucia"]
    ],
    historical: "现场调查记录泥流沿 Río Burritos 行进约 10 公里并波及聚落。蓝色虚线为论文图 1b 的手工近似描线。",
    anchor: "Villa Santa Lucía",
    documentedLength: "约 10 公里（全程）",
    gap: "冲积扇南缘是模型漏判示例。交并比同时计入漏判和多画的区域。"
  }
};
