# RUNOUT · Debris Flow Early Warning

[打开公开演练](https://serendizc.github.io/runout/) · [三维演出](https://serendizc.github.io/runout/film.html)

公开网页按原始时间顺序播放 11 场预警演练的 Agent 事件。点选位置时，浏览器使用当前预测版本重新计算。调整观测来源或注入新观测可使用本地运行服务。

## Agent Live

需要 Node.js 24。在项目目录运行以下命令，然后访问 http://127.0.0.1:8765/。

```sh
node agent/server.cjs
```

打开页面后自动播放 **01 吉隆冰岩崩**。换场景会启动下一场演练。左侧地图跟随回放时钟，右侧显示当前判断、预测修订和模拟手机送达。点击右侧事件可以回看说明，再打开对应的 Agent 工具与证据。点选地图或地点名称可以直接查询该位置。自由探索、平面地图和跟随演练共用这场运行。输入源、模型、倍速和单步推进位于「高级设置」。

规则模式和本地文本模型模式均离线运行。后者使用训练集贴文训练的朴素贝叶斯分类器补充候选提取。社交文本只触发查证，时空预测来自独立的地形传播工具与物理观测。日志显示实际工具执行。本地数据库默认位于 `agent/runout.sqlite`，可用 `RUNOUT_DB` 指定路径；`RUNOUT_PORT` 可修改端口。

吉隆回放使用实测 MiniSEED 派生的双站异常。源区候选来自事后定位假设，接收延迟、水位和相机约束是演练输入。其他案例也包含明示的演练数据。原始波形、许可及复算方式见 [数据说明](agent/data/README.md)。路径、到达窗口和模拟终端结果用于开发验证。

```sh
node tools/check-agent.cjs
node agent/evaluation.cjs
```

方法页的实验对比在同一回放内关闭上游波形，量测首次预测和送达变化；文本测试来自按场景分组的合成留出集。独立流域实测效果仍待校核。

## 预录三维演出

用支持 WebGL 的浏览器打开 `dist/index.html`。影像、场景与 3D 渲染依赖均已打包，可离线播放。通过服务访问 `/index.html` 也可播放。此入口标为预录演练。

- **演出**从 NASA Blue Marble 区域影像推近演练流域。事件开始后，时钟以恒定比例推进。高空航拍、汇入口、预警分发和撤离镜头共享这个时钟。红白卡片显示各点位的波前倒计时和撤离余量。测站、居民帖、Agent 判读、手机送达及人物动作都是回放设定。
- **自由视角**保留当前时刻，可暂停、拖转、平移、缩放和拖动时间轴。点击地形任意位置可查询影响、首波与估计影响持续时间。只有找到能在波前抵达之前完成的候选路线时，才画出路线并显示目标海拔。波尾不是解除预警的依据，路线和目标点需要当地核验。
- **场景**包括 10 个喜马拉雅演练和单列的 Villa Santa Lucía 安第斯 Example。每场片尾比较同一灾害、路线和步速下，预警送达再晚 6 分钟对演练点位完成撤离的影响。

## 模型与对照

高程来自 Copernicus GLO-30 的本地裁切。模型沿地形约束路径分段传播，在弯道外侧、出谷扇区和汇入口采用不同的横向扩展。汇入口可发生短程回冲，近同时到达的两股流可扩大局部影响范围；隔开山脊和未连通的流域分别传播。3D 波头高度、建筑损毁和冲击扬尘是视觉演绎。 [Copernicus GLO-30](https://registry.opendata.aws/copernicus-dem/) · [吉隆灾害动力学复盘](https://jms.imde.ac.cn/en/article/doi/10.1007/s11629-026-1482-y?viewType=HTML) · [吉隆口岸监控](https://commons.wikimedia.org/wiki/File:Mudslide_at_Gyirong_Port_1.webm)

吉隆口岸的 T+07:21 是历史约束下的拟合点。模拟通知在 T+04:06 送达，演练路线时间长于剩余时间。对照 Copernicus EMSR927 两块灾后制图区域，模型覆盖了 68/93 和 82/101 个已标为受影响的高程网格。该对照衡量空间重合，独立时序校验仍需更完整的现场记录。安第斯例覆盖约 77.5% 的论文灾后描线，交并比约 42.8%，仍漏判冲积扇南缘。 [GFZ 吉隆时间线](https://www.gfz.de/presse/meldungen/detailansicht/extreme-sturzflut-in-china-und-nepal) · [EMSR927 数据说明](https://ihp-wins.unesco.org/en/dataset/damage-grading-syapru-besi-and-timure-rasuwa-district-nepal-27-august-2026) · [Villa Santa Lucía 现场调查](https://nhess.copernicus.org/articles/20/2319/2020/)

执行 `node tools/check-runout-model.cjs` 可复核 11 个场景。下载 EMSR927 AOI01 和 AOI02 矢量 ZIP 后，可运行 `node tools/check-runout-ems.cjs <AOI01.zip> <AOI02.zip>` 重算灾后网格重合度。

片尾把高山冰冻圈变化和 ENSO 对区域降雨的影响作为气候背景，聚焦 COP31 的预警与适应议题。 [IPCC 高山亚洲](https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-12/) · [WMO ENSO](https://wmo.int/themes/el-nino-la-nina-phenomena) · [COP31 Early Warnings for All](https://unfccc.int/cop31/high-level)

## 素材与重建

区域开场影像为 NASA Earthdata GIBS Blue Marble Shaded Relief。 [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)

Three.js 渲染源在 `src/renderer.mjs`，浏览器使用随项目打包的 `dist/renderer.js`。如需重建渲染包，在本目录安装 `three@0.181.2` 和 `esbuild@0.25.12`，然后执行 `node build-renderer.cjs`。

Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

构建 GitHub Pages 静态站点需要 Node.js 24 和 esbuild。在项目目录运行 `node tools/build-pages.cjs <空目录>`。
