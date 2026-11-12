# AI Creator Lighthouse

正式环境与测试环境的定期 Lighthouse 性能监控。独立于业务仓库运行，直接测量已部署的公开页面。

- **看板：** https://liangjianhui1999.github.io/ai-creator-lighthouse/
- **运行与手动采集：** https://github.com/LIANGJIANHUI1999/ai-creator-lighthouse/actions/workflows/monitor.yml
- **长期指标数据：** `monitor-data` 分支的 `history/` 目录

## 采集范围

| 环境 | 目标 |
| --- | --- |
| 正式环境 `production` | https://vidma.ai |
| 测试环境 `staging` | https://vidmaeditor-ios.web.app |

默认测量中文官网首页、工作台、套餐与支付入口 `/zh/subscribe/`、短剧创作、视频创作、图片创作、工具中心、AI 换装、编辑器，共 9 个公共页面。测试环境额外覆盖英文广告创作页 `/en/ai-ads/`（看板名称“AI 广告（英文）”，ID `ai-ads-en`），因此正式环境测 9 页，测试环境测 10 页。套餐页面按匿名访问采集，不创建订单或提交付款。配置集中在 `monitor.config.json`，源自业务项目原有 Lighthouse 桌面端配置。

- 北京时间每天 **09:17、21:17** 采集两个环境；cron 使用 UTC `17 1,13 * * *`。
- 每页 **3 次**独立匿名导航，清理浏览器缓存与站点存储；每个指标分别取中位数，并保留最小/最大值。
- 桌面视口 1350 × 940，模拟 40ms RTT、10240Kbps 网络、CPU ×1。固定 Lighthouse、Chrome for Testing 和 Node 版本。
- 当前配置 `desktop-v2-native-ua` 显式使用固定 Chrome 的原生桌面 UA，避免 Lighthouse 默认的移动端 UA。旧 `desktop-v1` 批次虽然用了桌面视口及评分，UA 仍为移动端；历史数据保留，但不与修正后的批次连接或做回退比较。匿名 CI、个人浏览器会话和不同语言页面也需分别比较。
- 同一环境内页面串行测量；两个环境使用独立 GitHub-hosted runner 并行运行。
- 失败样本自动重试 1 次。HTTP 错误、跳转到登录页/其他路由、Lighthouse 运行错误和缺失必要指标均视为采集失败。
- 不执行生成、提交或支付操作，不使用登录 Cookie，不需要业务仓库或云服务凭据。

GitHub schedule 只从默认分支触发，可能延迟或丢弃高负载时的任务。公开仓库长期没有活动时，GitHub 也可能停用定时任务；看板超过 18 小时没有新数据时提示检查 Actions。

## 手动运行

在 Actions → **Monitor** → **Run workflow**：

1. `environment`：`all`、`production` 或 `staging`。
2. `routes`：留空测全部；也可填写 `landing,home` 等页面 ID。
3. `runs`：默认 `3`；支持 `1`、`5`。

页面 ID：`landing`、`home`、`ai-video`、`video-create`、`image-create`、`tools`、`clothes-transfer`、`editor`，以及仅测试环境可用的 `ai-ads-en`。

英文广告页可选择 `environment=staging`、`routes=ai-ads-en`、`runs=3` 单独采集。路由的可选 `environments` 配置用于限制采集与看板展示范围；手动选择不适用的环境会在采集前明确拒绝。

推送到 `main` 会执行检查并用既有记录刷新看板，避免修改看板时重复测量线上页面。定时任务与手动运行执行实际采集；PR 仅执行代码质量检查与测试，不采集、不写历史、不部署。

## 如何使用看板

切换正式/测试环境和页面，查看 Performance、LCP、CLS、TBT 的指标、目标及历史趋势。支持 7 天、30 天、90 天和全部时间，中英文界面，时间统一为北京时间。

趋势仅连接相同环境、测量工具版本、配置和重复次数的完整采集。工具升级会开启新的对比序列；失败不会被记为零分或悄悄忽略。本次采集不完整时保留有效指标并明确标记，不会显示“达标”。手动只测部分页面时，其余页面继续显示各自最近一次记录和时间。

每次记录包括监控代码 SHA、工具版本、目标域名、页面、采样数、指标波动、站点 HTML 指纹与响应头。**监控代码 SHA 不代表被测站点的部署版本**；站点尚未提供公开版本接口时，源码版本显示为未公开。HTML 指纹只是公开首页内容指纹。

### 阈值与状态

桌面端初始目标沿用业务项目：Performance ≥90、LCP ≤2500ms、CLS ≤0.1、TBT ≤200ms；看板分别展示两种状态：**性能状态**仅根据 Performance、LCP、CLS、TBT 判断，**页面质量状态**仅根据无障碍、最佳实践、SEO 判断。每组取自身最严重的问题，并直接列出未达标项的实测值、目标值，严重问题还会显示触发的严重阈值。完整目标和严重阈值以 `monitor.config.json` 为准。

页面标题、概览表、趋势数据表和批次历史均使用独立的两组状态；侧栏性能分数的颜色只反映性能状态。历史记录使用对应批次保存的阈值，既有摘要中的综合 `status` 字段保留以兼容原始数据，不再作为看板的性能状态。采集不完整、缺少指标或阈值会明确标记，不能当作达标。

工具中心和编辑器已改为允许收录，当前配置不再设置 `seoPolicy: "noindex"`，与其他公开页面一样直接用 Lighthouse 原始 SEO 总分对照目标 95 / 严重阈值 85。若再次出现禁止收录导致的 SEO 扣分，会正常显示未达标。既有禁止收录批次保留当时的策略、证据和原始分数，仍注明“按预期禁止收录”；历史记录与下载报告不改写。

相较上次可比完整采集，Performance 下降超过 5 分，或 LCP 同时上升超过 20% 且超过 300ms，标记为“较上次明显回退”。该标记用于排查，不发送外部消息。

**工作流成功表示采集与发布管线跑通，不表示所有页面性能达标。** 性能未达标在看板标记；采集或发布故障会在证据归档后让 `Collection health` 检查失败。

这些是 GitHub runner 上的实验室数据，不代表真实用户体验或 Core Web Vitals；不同环境的内容、CDN、埋点和 API 配置也可能不同。

## 编辑器实操基准

看板顶部“编辑器实操”入口展示独立基准；原来的编辑器 Lighthouse 页面继续测量首次加载。实操指标不参与 Lighthouse 百分制评分。

- 正式、测试环境分别打开 `/zh/editor/?benchmark=1`。该模式使用临时项目，不恢复或覆盖用户已有项目。
- 使用仓库内固定的 `fixtures/editor-5s.mp4`：5 秒、640×360、30fps、H.264/AAC。每次验证 SHA-256；不生成或购买线上素材。
- 每批默认 3 次，每次新建匿名浏览器上下文，关闭浏览器缓存，固定 Chrome、视口和软件渲染设置。
- 单独测量编辑器就绪、导入至首帧、缩略图就绪、播放首帧响应、定位帧响应、裁切响应、视频解码掉帧率、长任务数、导出 RTF。
- 播放和定位计时到视频帧回调；掉帧率来自 `getVideoPlaybackQuality()` 的实际帧计数。不能取得指标时显示不完整，不填零。
- 播放固定 2 秒，定位到约 55%，将出点裁切到约 70%，核对实际成片时长后点击真实导出按钮。确认生成非空 MP4，再计算 **RTF = 导出总耗时 / 成片时长**，其中包含首次导出代码下载。RTF 越低越好。
- 阈值沿用业务项目现有 `editor-benchmark.config.json` 的目标。运行中的导出引擎、软件渲染器、CPU、工具版本、素材哈希和场景版本全部记录；变化时分开比较，不将 Linux 软件渲染结果当作用户硬件性能。

定时任务每天自动包含两类采集。手动运行增加 `suite`：默认 `lighthouse` 保持原有行为；选择 `editor` 可只测编辑器（`routes` 留空），选择 `all` 可同时测两类。`environment` 和 `runs` 沿用现有输入。

编辑器批次长期保存在 `monitor-data` 分支的 `editor-history/`，与 Lighthouse 历史独立。看板提供逐指标趋势、具体未达标项、每次原始数据、JSON 和静态 HTML 报告；完整阶段诊断放入 30 天 Artifact。先归档和发布可用证据，再由 `Collection health` 报告未完成的测量。

无人值守采集器仅供 Linux GitHub Actions 使用：runner 没有 `ego-browser` 时使用固定 Chrome 与 Puppeteer Core；若检测到 `ego-browser`，会拒绝替代它。本地浏览器操作仍使用 `ego-browser`。本地人工复测可使用同一固定素材，按以上操作顺序复测，并单独标明本机的浏览器、硬件和引擎，不能与 CI 混作同一基线。

## 报告查看与下载

- **查看逐页报告 / 下载报告 JSON：** 看板直接提供每个页面最近一次采集中的真实代表报告。代表报告选取最接近 Performance 中位数的那次测量，因此其他指标不一定恰好等于摘要的逐项中位数。
- **下载批次摘要：** 每个历史批次均可直接下载 JSON，长期保留。
- **下载完整报告 ZIP：** 包含该环境所有采样和重试生成的原始 HTML/JSON，以及 `summary.json`。通过 Actions Artifact 保存 **30 天**，下载需登录 GitHub。到期后看板明确提示；历史指标仍保留。
- 最新逐页报告随 Pages 站点发布，不将完整原始报告提交到 Git 历史。只测一个环境或部分页面时，发布过程从未过期的既有 Artifact 恢复其余页面最近的代表报告；无法恢复时保留指标与批次下载信息，不伪造报告入口。

仓库和看板公开，只采集匿名公开页面。若以后要加入登录态测量，需先调整报告的访问和存储方案。

## 工作流与数据

单个 `.github/workflows/monitor.yml` 管理全部流程：

`Required Quality Gate → 双环境采集 → Artifact 归档 → monitor-data 指标归档 → 静态看板构建 → GitHub Pages → Collection health`

Pages 部署依赖唯一的 `Required Quality Gate`，不会绕过检查。整条监控流程有非取消式互斥锁，防止历史分支和看板相互覆盖。重复处理同一批次不会覆盖已归档记录；Actions 重跑以新的 attempt 单独保存。

权限按任务授予：采集只读；归档需要 `contents: write` 和 `actions: read`；Pages 发布使用 `pages: write` 与 `id-token: write`。均使用内置 `GITHUB_TOKEN` / OIDC，不需要额外 PAT 或云服务密钥。仓库 Pages 来源应设为 **GitHub Actions**。

## 本地开发与验证

Node 版本见 `.node-version`（Lighthouse 要求 Node ≥22.19），pnpm 版本见 `package.json`。

```sh
pnpm install --frozen-lockfile
pnpm verify:session
pnpm test
```

`verify:session` 检查 JavaScript 语法、配置、工作流 YAML 和中英文翻译；测试单独执行，CI 必须执行两者。测试使用模拟测量结果与临时文件，不请求正式环境。

手动采集需安装配置指定的 Chrome for Testing，并通过 `CHROME_PATH` 指定其可执行文件：

```sh
pnpm collect --environment=staging --routes=landing,home --runs=3
```

构建看板读取本地 `monitor-data/history/`。CI 会恢复历史分支和报告，本地可提供已有归档：

```sh
pnpm build
```

代码目录：`scripts/lib.mjs`（校验、聚合与状态）、`scripts/collect.mjs`（采集）、`scripts/archive.mjs`（历史归档）、`scripts/build.mjs`（静态站点）、`web/`（看板）、`tests/`（回归测试）。
