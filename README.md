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

默认测量中文官网首页、工作台、短剧创作、视频创作、图片创作、工具中心、AI 换装、编辑器，共 8 个页面。配置集中在 `monitor.config.json`，源自业务项目原有 Lighthouse 桌面端配置。

- 北京时间每天 **09:17、21:17** 采集两个环境；cron 使用 UTC `17 1,13 * * *`。
- 每页 **3 次**独立匿名导航，清理浏览器缓存与站点存储；每个指标分别取中位数，并保留最小/最大值。
- 桌面视口 1350 × 940，模拟 40ms RTT、10240Kbps 网络、CPU ×1。固定 Lighthouse、Chrome for Testing 和 Node 版本。
- 同一环境内页面串行测量；两个环境使用独立 GitHub-hosted runner 并行运行。
- 失败样本自动重试 1 次。HTTP 错误、跳转到登录页/其他路由、Lighthouse 运行错误和缺失必要指标均视为采集失败。
- 不执行生成、提交或支付操作，不使用登录 Cookie，不需要业务仓库或云服务凭据。

GitHub schedule 只从默认分支触发，可能延迟或丢弃高负载时的任务。公开仓库长期没有活动时，GitHub 也可能停用定时任务；看板超过 18 小时没有新数据时提示检查 Actions。

## 手动运行

在 Actions → **Monitor** → **Run workflow**：

1. `environment`：`all`、`production` 或 `staging`。
2. `routes`：留空测全部；也可填写 `landing,home` 等页面 ID。
3. `runs`：默认 `3`；支持 `1`、`5`。

页面 ID：`landing`、`home`、`ai-video`、`video-create`、`image-create`、`tools`、`clothes-transfer`、`editor`。

推送到 `main` 会执行检查并用既有记录刷新看板，避免修改看板时重复测量线上页面。定时任务与手动运行执行实际采集；PR 仅执行代码质量检查与测试，不采集、不写历史、不部署。

## 如何使用看板

切换正式/测试环境和页面，查看 Performance、LCP、CLS、TBT 的指标、目标及历史趋势。支持 7 天、30 天、90 天和全部时间，中英文界面，时间统一为北京时间。

趋势仅连接相同环境、测量工具版本、配置和重复次数的完整采集。工具升级会开启新的对比序列；失败不会被记为零分或悄悄忽略。本次采集不完整时保留有效指标并明确标记，不会显示“达标”。手动只测部分页面时，其余页面继续显示各自最近一次记录和时间。

每次记录包括监控代码 SHA、工具版本、目标域名、页面、采样数、指标波动、站点 HTML 指纹与响应头。**监控代码 SHA 不代表被测站点的部署版本**；站点尚未提供公开版本接口时，源码版本显示为未公开。HTML 指纹只是公开首页内容指纹。

### 阈值与状态

桌面端初始目标沿用业务项目：Performance ≥90、LCP ≤2500ms、CLS ≤0.1、TBT ≤200ms；看板分别展示两种状态：**性能状态**仅根据 Performance、LCP、CLS、TBT 判断，**页面质量状态**仅根据无障碍、最佳实践、SEO 判断。每组取自身最严重的问题，并直接列出未达标项的实测值、目标值，严重问题还会显示触发的严重阈值。完整目标和严重阈值以 `monitor.config.json` 为准。

页面标题、概览表、趋势数据表和批次历史均使用独立的两组状态；侧栏性能分数的颜色只反映性能状态。历史记录使用对应批次保存的阈值，既有摘要中的综合 `status` 字段保留以兼容原始数据，不再作为看板的性能状态。采集不完整、缺少指标或阈值会明确标记，不能当作达标。

相较上次可比完整采集，Performance 下降超过 5 分，或 LCP 同时上升超过 20% 且超过 300ms，标记为“较上次明显回退”。该标记用于排查，不发送外部消息。

**工作流成功表示采集与发布管线跑通，不表示所有页面性能达标。** 性能未达标在看板标记；采集或发布故障会在证据归档后让 `Collection health` 检查失败。

这些是 GitHub runner 上的实验室数据，不代表真实用户体验或 Core Web Vitals；不同环境的内容、CDN、埋点和 API 配置也可能不同。

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
