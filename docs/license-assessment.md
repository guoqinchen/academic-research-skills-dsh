# academic-research-skills → DSH 插件：授权许可与可行性评估

**评估对象**：`Imbad0202/academic-research-skills`（`main`，插件版本 `3.23.2`，提交 `1ec249df98728682dfbbdfb940a658338bfd6f80`）
**评估基准**：上游 `LICENSE`、`README.md`、`NOTICE.md`、`GOVERNANCE.md`、`.claude-plugin/plugin.json`；当前工作区 `academic-research-skills-dsh@2.0.0`
**评估日期**：2026-10-27
**性质**：工程与合规分析，不构成法律意见。商业分发前应取得上游书面许可并咨询执业律师。
**修订**：2026-10-27 已按 §8.1 完成 3 项优先修复；修复记录与验证见 §12。
**2026-10-28 更新**：2.1.0 已将 payload 升级到上游 3.24.0（commit `b34c63f8`）；上游许可证仍为 CC-BY-NC-4.0，本文的 3.23.2 分析保留为基线。

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 能否开发为 DSH 插件？ | **可以**。CC BY-NC 4.0 授予“produce, reproduce, and Share Adapted Material”的权利，移植到另一插件运行时属于典型改编。 |
| 许可类型 | **CC BY-NC 4.0**（Creative Commons Attribution-NonCommercial 4.0 International），SPDX `CC-BY-NC-4.0`，著作权人 Cheng-I Wu，2026。 |
| 商业使用 | **不允许**。付费插件、SaaS、商业产品捆绑、收费咨询或代写交付，均需另行取得书面商用许可。 |
| 技术可行性 | **高**。上游是提示词 + Python 确定性脚本 + 钩子；DSH 提供 `skills`、`commands`、`tools`、`systemPrompt`、`tools.guard` 五类契约。 |
| 当前状态 | 工作区已是完整移植，并发布 npm `academic-research-skills-dsh@2.0.0`（1,257 文件，26.07 MB，CC-BY-NC-4.0）。 |
| 主要风险 | NC 边界、第三方素材（COREQ/STROBE 许可、Semantic Scholar 非商业、IEEE 引文占比）、商标与背书、无专利许可、GitHub 识别为 `NOASSERTION`。 |

**一句话**：非商业可行且已落地；商业化不可行，除非同时拿到上游书面许可并清理 S2、COREQ、STROBE 与 IEEE 引文。

## 1. 上游仓库画像

### 1.1 功能定位

上游是面向 Claude Code 的学术研究技能套件，覆盖“研究 → 写作 → 同行评审 → 修订 → 定稿”的完整链路。其自我定位不是全自动论文生成器，而是 human-in-the-loop 的副驾驶：AI 负责检索、格式化、核验、一致性检查，作者保留署名权与最终判断权。仓库描述为 “Academic Research Skills for Claude Code: research → write → review → revise → finalize”。

规模与表面：

| 表面 | 数量 | 内容 |
|---|---|---|
| 技能 | 5 | `deep-research`、`academic-paper`、`academic-paper-reviewer`、`academic-pipeline`、`sr-screener` |
| 模式 | 35 | 由各技能的 `MODE_REGISTRY.md` 与技能正文定义 |
| 角色文件 | 47 | 43 个唯一角色（4 个插件级 + 39 个内联），另有 4 个根目录逐字节镜像 |
| 斜杠命令 | 16 | `/ars-full`、`/ars-plan`、`/ars-outline`、`/ars-revision`、`/ars-reviewer` 等 |
| 仓库文件 | 2,862 | 上游 `main` 的 blob 总数；移植载荷收录 1,199 个 |
| 仓库体积 | 约 24.7 MB | 主要由脚本、文档、示例 PDF 构成 |

### 1.2 核心机制

1. **提示词驱动的技能层**：每个技能是一个 `SKILL.md`，YAML frontmatter 声明名称、描述、版本、数据访问级别、任务类型与关联技能；正文包含路由纪律、模式协议、agent 调度指令、参考文件路径。技能本身不含可执行代码，行为由模型按文本执行。
2. **提示词级路由器**：Step 0 的 `[direct-mode]` 逃生口、Step 1 明确意图、Step 2 跨阶段材料澄清、Step 3 模糊意图澄清。路由是文本协议，不是代码分支。
3. **模式注册表**：35 种模式（full、quick、review、lit-review、fact-check、socratic、systematic-review、revision-coach、rebuttal-audit、disclosure、ta-screen、ft-screen、adjudicate 等），由技能正文与 `MODE_REGISTRY.md` 共同定义。
4. **确定性 Python 门禁**：引用核验、PRISMA/trAIce 新鲜度检查、系统综述筛选构建、修订补丁、审计一致性检查、写作用域守卫等由脚本执行，模型不参与裁决。这是“可复现门禁”与“模型判断”分离的关键设计。
5. **钩子层**：`hooks/hooks.json` 注册 `PreToolUse` 写作用域守卫，`hooks/run_guard.sh` 与阶段清单配合，限制不同阶段 agent 的写入范围；另有会话宣告脚本。
6. **10 阶段流水线**：RESEARCH → WRITE → 2.5 完整性门禁 → 3/3′ 评审 → 4 作者回应 → 4.5 完整性复验 → 5 进入阶段 → 6 过程总结；2.5 与 4.5 是强制门禁。
7. **多角色评审**：期刊匹配审查员 + 3 位动态审查员 + Devil's Advocate；评审结果带校准状态标注（上游明确标注 `NOT_CALIBRATED`）。
8. **数据流**：本地缓存、可选跨模型调用、插件更新检查；上游 `docs/DATA_FLOWS.md` 记录数据离开本机的路径与保留策略。

### 1.3 代码结构

以下文件数为 DSH 移植载荷的统计（`payload/` 内 1,199 个上游文件，另加 2 个生成的溯源文件）。

| 目录 | 作用 | 载荷文件数 |
|---|---|---|
| `deep-research/` | 研究技能：13 个 agent、8 种模式 | 53 |
| `academic-paper/` | 写作技能：12 个 agent、11 种模式 | 63 |
| `academic-paper-reviewer/` | 模拟审稿：7 个 agent、6 种模式 | 28 |
| `academic-pipeline/` | 10 阶段编排器 | 30 |
| `sr-screener/` | 系统综述筛选：4 个 agent、8 种模式 | 25 |
| `commands/` | 16 个 `/ars-*` 命令 | 16 |
| `agents/` | 4 个插件级 agent 角色 | 4 |
| `shared/` | 共享协议、引用规则、模板、参考 | 155 |
| `scripts/` | 确定性 Python/shell 门禁与适配器 | 642 |
| `hooks/` | 写作用域守卫、会话宣告 | 2 |
| `docs/` | 架构、数据流、能力矩阵、许可说明 | 121 |
| `examples/` | 12 个 showcase PDF、示例产物 | 45 |
| `tools/` | 发布纪律工具 | 6 |
| 根目录 | README、QUICKSTART、POSITIONING、MODE_REGISTRY、LICENSE、NOTICE 等 | 9 |
| **合计** | | **1,199** |

上游另有 1,663 个文件未进入载荷：`evals/`、`tests/`、`plugin-evals*`、`.github/`、`pi/`、`audits/`、本地化 README、4 个第三方网页镜像等。这些是测试、评估、CI 与分发包装，不是运行时内容；排除它们不影响功能，但意味着移植版不包含上游的评估语料与测试基线。

### 1.4 依赖关系

| 类别 | 上游 | DSH 移植 |
|---|---|---|
| 宿主 | Claude Code（插件市场安装） | DSH `>= 0.2.1-rc.3`（Cordis Host bundle） |
| 模型 | Claude，需 `ANTHROPIC_API_KEY` | DeepSeek Flash（DSH 内置，无 Claude 依赖） |
| Node | 未声明 | `>= 22` |
| Python | 可选；守卫与少数命令需要 | `>= 3.11`，必需（确定性门禁） |
| Python 包 | `requirements-dev.txt` 与可选分类器 | 8 个固定版本：PyYAML、ruamel.yaml、jsonschema、pypdf、defusedxml、openpyxl、markdown-it-py、linkify-it-py |
| 文档转换 | Pandoc（DOCX）；tectonic + Source Han Serif TC（PDF） | 保留为可选外部依赖 |
| npm 依赖 | 无；`package.json` 是 Pi wrapper，`private: true` | 无；仅 Node 内置模块与本地 ESM 模块 |
| 网络 | Claude WebSearch/WebFetch；脚本调用 arXiv、OpenAlex、Crossref、Semantic Scholar、中文文献客户端 | `web_search`/`web_fetch`；同样的脚本出口 |
| 平台 | macOS/Linux/Windows（Windows 有 Git Bash 注意事项） | macOS/Linux；Windows 暂不支持（POSIX `sh` wrapper） |

依赖关系的关键判断：上游的核心资产是**文本与脚本**，不是某个专有 SDK。移植的难点不在 API 适配，而在 1,199 个文件的文本改写、路径重解析、工具名映射与契约测试。

## 2. 授权许可类型

### 2.1 许可识别

- 上游 `LICENSE` 首行：`Copyright (c) 2026 Cheng-I Wu`；正文为 CC BY-NC 4.0 全文。
- 上游 `.claude-plugin/plugin.json` 与 `package.json` 均声明 `"license": "CC-BY-NC-4.0"`。
- SPDX 标识：`CC-BY-NC-4.0`。
- GitHub API 的 `license` 字段返回 `NOASSERTION`，原因是 GitHub 的许可证识别器不覆盖 NC 变体；这**不代表没有许可**。
- 该许可**不是 OSI 认可的开源许可证**；Creative Commons 自身不建议将 CC 许可用于软件，因为缺少专利授权、源代码/目标代码区分、专利报复等软件许可常见条款。
- 上游 `GOVERNANCE.md` 明确写道：许可证“already permits non-commercial community forks”。这与 CC BY-NC 4.0 的授权范围一致。

### 2.2 核心授权

`LICENSE` Section 2(a) 原文：

> “the Licensor hereby grants You a worldwide, royalty-free, non-sublicensable, non-exclusive, irrevocable license to exercise the Licensed Rights in the Licensed Material to: (a) reproduce and Share the Licensed Material, in whole or in part, for NonCommercial purposes only; and (b) produce, reproduce, and Share Adapted Material for NonCommercial purposes only.”

四项关键含义：

1. **改编被明确授权**：把 Claude Code 插件改造成 DSH 插件，属于 “produce ... Adapted Material”，不需要额外许可。
2. **非商业是前提条件**：不是“建议”，而是授权范围本身。超出非商业目的，授权不覆盖。
3. **不可再许可（non-sublicensable）**：你不能把商用权转授给他人；但接收者依 Section 2(a)(5)(a) 直接从原许可人获得同一许可，不需要你“再许可”。
4. **不可撤销（irrevocable）**：在著作权有效期内，非商业授权稳定；但违约会自动终止（Section 6(a)），30 天内补救可恢复（Section 6(b)）。

### 2.3 必须遵守的条件

| 条件 | 条款 | 具体要求 |
|---|---|---|
| 署名 | 3(a)(1)(A)(i)-(v) | 保留创作者标识、版权声明、许可声明、免责声明提示、材料 URI/超链接 |
| 修改标注 | 3(a)(1)(B) | 指明你修改过材料，并保留此前修改的指示 |
| 许可标注 | 3(a)(1)(C) | 指明材料依本许可授权，并附许可全文或 URI |
| 不得加限 | 2(a)(5)(b) | 不得对材料施加额外或不同的条款，不得施加有效技术措施限制接收者行使权利 |
| 适配层许可 | 3(a)(4) | 你对改编材料适用的许可，不得阻止接收者遵守 CC BY-NC |
| 不得背书 | 2(a)(6) | 不得暗示你或你的使用与许可人存在关联、赞助、背书或官方地位 |

### 2.4 未授予的权利

- **专利权不授权**：Section 2(b)(2) 明确 “Patent and trademark rights are not licensed under this Public License.” 若上游脚本或流程涉及专利方法，CC 许可不提供专利许可；非商业使用也不当然豁免专利侵权。
- **商标权不授权**：同上。使用 “Academic Research Skills” 或 “ARS” 作为产品名，可能涉及商标与来源混淆；暗示官方背书则直接违反 2(a)(6)。
- **精神权利不授权**：Section 2(b)(1) 保留精神权利，仅在不影响行使许可权利的必要范围内放弃或不行使。
- **无担保**：Section 5 为 “AS-IS”“AS-AVAILABLE”，不提供所有权、适销性、特定用途适用性、非侵权等担保。
- **不能再许可**：Section 2(a) 明确 `non-sublicensable`。

### 2.5 终止与救济

- Section 6(a)：违反许可，权利自动终止。
- Section 6(b)：在发现违约后 30 天内补救，权利自动恢复；或经许可人明确恢复。
- Section 6(c)：许可人可以另行提供不同条款，或随时停止分发；这为**商业许可谈判**留下明确空间。
- Section 6(d)：Sections 1、5、6、7、8 在终止后继续有效。

## 3. 允许的二次开发范围

| 行为 | 是否允许 | 条件与依据 |
|---|---|---|
| Fork、克隆、研究代码与文本 | 允许 | 非商业；保留版权与许可声明（3(a)） |
| 移植到 DSH：改写路径、工具名、模型标签、命令调用 | 允许 | 属于 Adapted Material；按 3(a)(1)(B) 指明修改 |
| 增加适配层：注册、守卫、venv、工具、状态报告 | 允许 | 适配层可单独授权，但不得限制接收者依 CC BY-NC 行使权利（3(a)(4)） |
| 免费分发：npm、GitHub、插件市场 | 允许 | 非商业；完整署名；不得加额外限制（2(a)(5)(b)） |
| 翻译、本地化、改写提示词 | 允许 | 指明修改；保留上游署名 |
| 用于教学、非营利研究、个人学术写作 | 允许 | 非商业目的 |
| 保持 `payload/` 逐字节不变 | 允许 | 复制（reproduce）在授权范围内 |
| 将适配层单独以 MIT 发布 | 有条件 | 仅限不含上游表达的原创代码；整体分发包仍含 CC BY-NC 内容；不得让接收者无法遵守 CC BY-NC |
| 向上游申请商用许可 | 允许 | 6(c) 明确许可人可另行提供条款 |

**关于“适配层单独许可”的说明**：CC BY-NC 4.0 没有 ShareAlike 条款，因此不强制你把适配层也放在 CC BY-NC 下。但整包分发时，上游内容仍受 CC BY-NC 约束；若适配层包含上游表达（改写的提示词、测试夹具、复制的示例），该部分不能脱离 CC BY-NC。当前工作区选择“整包 CC BY-NC 4.0”，是操作上最清晰、争议最小的做法。

## 4. 限制与禁止

| 行为 | 结论 | 依据 |
|---|---|---|
| 销售插件、订阅、付费墙 | 禁止 | Section 1(i)、2(a)(1)-(2) |
| SaaS、托管服务、API 化 | 禁止 | 同上 |
| 在收费咨询、代写、编辑服务中使用 | 禁止 | 构成商业优势或金钱报酬 |
| 捆绑进商业产品或商业发行版 | 禁止 | 同上 |
| 免费插件为付费服务引流 | 高风险，按禁止处理 | “directed towards commercial advantage” |
| 移除、篡改、隐藏署名 | 禁止 | 3(a)、6(a) |
| 增加 EULA、DRM、禁止再分发条款 | 禁止 | 2(a)(5)(b) |
| 再许可商用权 | 禁止 | 2(a) `non-sublicensable` |
| 以官方名义使用上游名称、标识 | 禁止 | 2(a)(6)、2(b)(2) |
| 依赖专利方法进行商业使用 | 无专利许可，需 FTO | 2(b)(2) |

## 5. NC 边界：按使用场景判定

`LICENSE` Section 1(i) 的定义：

> “NonCommercial means not primarily intended for or directed towards commercial advantage or monetary compensation.”

判断要点：

1. **看用途，不看主体**：营利公司可以做非商业使用；非营利机构也可以做商业使用。主体性质不是决定性因素。
2. **看主要意图**：“primarily” 留有一定余地，但不应依赖“顺带获得商业利益”的解释。
3. **金钱报酬包括**：费用、订阅、付费支持、付费咨询、按件计酬的交付。
4. **商业优势包括**：为付费产品引流、品牌背书、捆绑销售、以免费插件获取企业客户。

| 场景 | 判断 | 说明 |
|---|---|---|
| 个人学术写作、研究 | 允许 | 非商业 |
| 非营利教学、科研 | 允许 | 非商业 |
| 免费开源插件 | 允许 | 无金钱报酬 |
| 免费插件 + 自愿捐赠 | 通常允许，灰色 | 若捐赠是主要商业模式，风险上升 |
| 企业内部非商业研究 | 灰色 | 取决于是否指向商业优势；建议法律审查 |
| 企业内部商业研发、收费交付 | 禁止 | 商业使用 |
| 付费插件、订阅 | 禁止 | 商业使用 |
| 咨询、代写、编辑服务 | 禁止 | 商业使用 |
| 商业产品内置 | 禁止 | 商业使用 |
| 商业平台免费上架 | 灰色 | 平台商业目的与上架条款需单独评估 |

## 6. 第三方权利与排除项

CC BY-NC 4.0 只覆盖许可人有权许可的材料；上游仓库中的第三方内容不在授权范围内。

1. **4 个网页镜像**：`docs/design/snapshots/2026-05-13-ai-disclosure-discovery/{icmje,ieee,nature,prisma-trAIce}.html`。ICMJE、IEEE、Springer Nature 保留所有权利；第 4 个是 CC BY 4.0 内容，但其署名声明未随包分发。上游的 CC BY-NC 授权不覆盖它们，因此 DSH 移植版**不分发**这 4 个文件，只在 `PROVENANCE.json` 保留 URL、Wayback ID 与 SHA-256。
2. **嵌入字体**：12 个 showcase PDF 嵌入 Times New Roman、PingFang HK、STSong、Source Han Serif TC、Latin Modern Mono 10、Courier New 的子集。完整 PDF 的再分发通常由字体嵌入许可覆盖；**提取字体子集单独使用**需要字体自身许可（例如 Source Han Serif 的 SIL OFL）。审计结果：TrueType 的 `OS/2.fsType` 为 0 或 8；PingFang/Latin Modern 为 CFF、无 `fsType`；无独立字体文件与图片。不要提取。
3. **外部 API 条款**：payload 脚本会访问 arXiv、OpenAlex、Crossref、Semantic Scholar 与中文文献客户端。CC BY-NC 不改变这些 API 的服务条款。审计结果：arXiv/Crossref/OpenAlex/DOI/Handle 对本案使用的元数据开放；**Semantic Scholar 仅限非商业研究/教育**；NCBI 要求 `tool`/`email`、3 req/s 与免责声明。
4. **第三方引文与截图**：`docs/` 中可能包含对第三方页面的引用或短摘录。审计结果：49 条政策引文均 ≤50 词并带 locator；IEEE 引文 93 词（81 唯一），约占其短文 54%，为最高风险项；COREQ/STROBE 的改编清单缺少许可标注。
5. **上游 `NOTICE.md`**：声明这是作者个人项目、未使用雇主资源；它不增加也不减少 CC BY-NC 的条款。

逐项复核见 [`docs/third-party-audit.md`](third-party-audit.md)（2026-10-27）。非商业分发的主要剩余风险是 COREQ/STROBE 与 IEEE 引文；商业分发还受 Semantic Scholar 的 API 许可阻塞。

## 7. 技术可行性

### 7.1 DSH 契约映射

| 上游机制 | 上游实现 | DSH 对应面 | 移植状态 |
|---|---|---|---|
| 5 个技能 | `*/SKILL.md` + `references/`、`templates/` | `ctx.skills.register` | 5 个，正文在注册时改写 |
| 16 个命令 | `commands/*.md` | `ctx.commands.register` + `followup` | 16 个，作为一条用户消息提交 |
| 4 个插件级 agent | `agents/*.md` | agent-role skills + `subagent` | 4 个，模型可调用 |
| 43 个技能内角色 | 技能目录内 `agents/` | 39 个由技能正文直接读取；4 个以 agent-role skill 暴露 | 保留 |
| 写作用域钩子 | `hooks/hooks.json` + `PreToolUse` | `ctx.tools.guard` | 基础设施保护生效；阶段围栏 `unavailable` |
| 确定性门禁 | `scripts/*.py`（642） | `ars_script` + `bin/ars-python` | 642 个脚本，venv 隔离 |
| 插件根路径 | `${CLAUDE_PLUGIN_ROOT}` | `payloadRoot` | 注册时改写 |
| Claude 工具名 | `Read`、`Write`、`Task` 等 | `read`、`write`、`subagent` 等 | 映射表 |
| 模型标签 | `sonnet`、`opus`、`haiku` | `deepseek-flash` | 改写 |
| 模型 API | Claude API | DSH 内置模型 | 无 Claude 依赖 |
| 网络检索 | Claude WebSearch | `web_search`（`deepseek-official`） | 默认开启 |
| 图像检查 | Claude vision | `read_image` | 支持 |

### 7.2 摩擦点

1. **阶段围栏不可用**：DSH 的工具执行不暴露 `agent_type`，`ars_status` 如实报告 `guard.phaseFence: "unavailable"`。基础设施保护（禁止改写守卫脚本、阶段清单、agent 定义）仍然生效，但不能假装阶段围栏在工作。
2. **`ars_script` 不是沙箱**：它按声明的输出参数做基础设施保护，但位置参数不解释；脚本仍可写到自己的参数指向的位置。payload 脚本还会发起出站 HTTP 请求，因此 `ars_script` 同时是网络出口。技能文本应按不可信输入处理。
3. **Windows 不支持**：`bin/ars-python` 是 POSIX `sh` wrapper；当前只支持 macOS/Linux。
4. **Python 环境**：需要 Python 3.11+，首次 `ars_env_setup` 需要访问 PyPI；8 个固定版本用于可复现门禁。
5. **载荷不可变**：`PYTHONDONTWRITEBYTECODE=1` 防止在只读 payload 内生成 `__pycache__`；如果 payload 被改动，`node tools/check-payload.mjs` 会对固定摘要失败。
6. **包体较大**：1,199 个文件、24.1 MB；npm tarball 26.07 MB、1,257 个文件。对插件市场与安装体验有影响。
7. **命令 UI 未走真实 composer**：`/ars-*` 处理器用假 invocation 做过单元测试，注册状态由 `ars_status` 运行时验证；插件不驱动 Web composer 本身。
8. **更新检查未移植**：上游 `/plugin update` 提醒未移植；上游漂移通过 `tools/check-upstream.mjs` 与重建处理。

### 7.3 工作量

当前工作区已经完成移植：20 个 `lib/` 模块、6 个 `tools/` 脚本、10 个测试套件、3 个工具、5 个技能、16 个命令、4 个 agent 角色，并已发布 npm v2.0.0。因此“能否开发”不再是待验证问题，剩下的是合规边界与维护成本。

若从零重做，单人工作量约 **2–4 周**，主要成本在 1,199 个文件的文本改写、lint、路径契约与端到端测试，而不是插件骨架。这个估计不含上游评估语料的重建，也不含商业许可谈判与法律审查。

## 8. 当前工作区的合规核对

| 要求 | 状态 | 证据 | 缺口或建议 |
|---|---|---|---|
| 声明许可 | 已满足 | `package.json` `"license": "CC-BY-NC-4.0"`；根 `LICENSE` | 无 |
| 保留上游版权 | 已满足 | `LICENSE` 第 1 行；`NOTICE.md` 第 4 行 | 无 |
| 指明修改 | 已满足 | `NOTICE.md` “Porting changes are confined to ...” | 无 |
| 提供许可 URI | 已满足 | `NOTICE.md` 上游 URL；`LICENSE` 全文 | 无 |
| 非商业声明 | 已满足 | `README.md` “License and commercial use” 段；`NOTICE.md` “Commercial use” 段 | 无（原缺口已于 2026-10-27 修复） |
| 不背书声明 | 已满足 | `README.md`、`NOTICE.md`、`package.json` description | 无（原缺口已修复） |
| 运行时署名 | 已满足 | `lib/adapt.js` `UPSTREAM_ATTRIBUTION` / `NON_AFFILIATION_NOTICE`；announce 与 prelude | 无（原缺口已修复） |
| 第三方素材排除 | 已满足 | `PROVENANCE.json` 排除 4 个镜像 | 重建 payload 时保持排除；字体不单独提取 |
| 无额外限制 | 已满足 | 整包 CC BY-NC；无 EULA/DRM | 不要添加“禁止再分发”类条款 |
| 专利与商标 | 部分满足 | `NOTICE.md` 增加“无专利/商标许可”声明；未做 FTO | 商业化前做 FTO；名称已加 `-dsh` 区分 |
| 许可识别 | 部分满足 | README 首屏 SPDX 与许可链接；GitHub API 仍返回 `NOASSERTION` | 企业扫描器可能仍拦截；已在 README 说明 |
| 全文版权审计 | 已完成（2026-10-27） | `docs/third-party-audit.md`：字体 fsType、49 条政策引文、9 个报告指南、11 个 API | 商业发布前清理 S2、COREQ、STROBE、IEEE 引文四项 |

### 8.1 三个优先修复项（2026-10-27 已修复）

> 以下保留原始审查记录；修复内容与验证见 §12。

1. **运行时署名**：在 `buildAnnounce` 的输出中加入上游 README 指定的署名格式，并补许可标识：
   ```
   Based on Academic Research Skills by Cheng-I Wu
   https://github.com/Imbad0202/academic-research-skills
   Licensed under CC BY-NC 4.0.
   ```
   这是用户实际接触的介质；仅在 README/NOTICE 中署名，按 3(a)(2) 可能仍属“合理方式”，但运行时补一行成本极低、争议最小。
2. **非官方声明**：在 README 首屏与 `package.json` 的 `description` 中加入：
   `Unofficial DeepSeek Harness port; not affiliated with or endorsed by the upstream author.`
   对应 2(a)(6) 的不得背书条款。
3. **商用边界与联系路径**：在 README 的 Install 之前加入：
   `Non-commercial use only. Commercial use requires a separate written license from the upstream author.`
   避免 npm 使用者把 CC BY-NC 误读为可商用。

## 9. 商业化路径

| 路径 | 做法 | 优点 | 缺点与风险 |
|---|---|---|---|
| A. 取得书面商用许可 | 联系 Cheng-I Wu，签署范围、期限、地域、再许可、费用条款 | 合法保留上游内容；可商业分发 | 需谈判；上游未公开商用渠道；费用未知 |
| B. 双轨分发 | 社区版 CC BY-NC；商业版另签许可 | 兼顾社区与商业 | 需两套分发、品牌与合同隔离 |
| C. 净室重写 | 只借鉴功能与方法，不复制表达；独立实现 | 可完全自主许可 | 成本高；提示词文本是主要表达，重写难度大；需法律审查 |
| D. 仅分发适配器 | 不捆绑 payload；用户自备上游副本 | 降低分发风险 | 适配器仍可能被认定为衍生；体验差；法律上不彻底 |
| E. 替换上游内容 | 用自己的提示词与流程替换 | 无 NC 约束 | 失去上游质量与品牌；工作量大 |

**建议**：

- 目标是非商业社区分发：保留当前 CC BY-NC 路径，修复第 8.1 节三项。
- 目标是商业产品：优先 A；C 作为备选。不要把“免费插件 + 付费服务”当作规避 NC 的结构，NC 看的是主要意图与商业优势，不是标价。即使取得上游许可，仍需按 [`docs/third-party-audit.md`](third-party-audit.md) 清理 S2、COREQ、STROBE 与 IEEE 引文。
- 商业化构建：运行 `node tools/build-commercial.mjs --out <dir> --strict` 生成独立副本；它自动跳过 S2、替换 COREQ/STROBE、压缩 IEEE 引文并重算哈希，但不授予许可。详见 [`docs/commercial-build.md`](commercial-build.md)。
- 目标是企业内部使用：先做法律审查；如果产出用于收费交付，按商业使用处理。

## 10. 依据清单

**上游**

- `LICENSE`：CC BY-NC 4.0 全文；关键条款 Section 1(i)、2(a)(1)-(2)、2(a)(5)-(6)、2(b)(1)-(2)、3(a)、5、6。
- `README.md`：项目定位、安装方式、依赖、许可与署名格式。
- `.claude-plugin/plugin.json`：版本 `3.23.2`，`"license": "CC-BY-NC-4.0"`。
- `package.json`：`private: true`、Pi wrapper、`"license": "CC-BY-NC-4.0"`。
- `GOVERNANCE.md`：单一维护者；“license already permits non-commercial community forks”。
- `NOTICE.md`：个人项目声明，未使用雇主资源。
- GitHub API：`stargazers_count` 54,062；`forks_count` 4,137；`license.spdx_id` `NOASSERTION`；`pushed_at` 2026-10-27。

**本地工作区**

- `payload/PROVENANCE.json`：上游提交 `1ec249d`；1,199 文件、24,118,122 字节；排除项与 4 个镜像原因。
- `package.json`：`license`、`dsh.bundle.patch`、`engines`、无 npm 依赖。
- `NOTICE.md`：上游与适配层版权、修改说明、第三方镜像排除。
- `ASSET-LICENSES.md`：16 个 PDF、嵌入字体清单。
- `README.md`：移植表面、安装、配置、已知限制、许可说明。
- `lib/adapt.js`：`buildAnnounce`、`buildPrelude`、`lintText`；运行时署名与商用边界常量（原缺口已于 §12 修复）。
- `lib/payload-contract.js`：载荷快照、排除规则、许可元数据。
- `docs/code-review-2026-10-27.md`：既有内部评审已提示“非 OSI 属性会让 npm 使用者误判为可商用”。

**外部登记**

- npm registry：`academic-research-skills-dsh@2.0.0`，1,257 文件，26,071,949 字节，`license: CC-BY-NC-4.0`，发布时间 2026-10-27。

### 10.1 评估边界

- 本评估基于提交 `1ec249d` 的许可文本。上游后续版本可能变更许可；升级载荷时必须重新核对 `LICENSE` 与 `package.json`，不能假定许可不变。
- CC BY-NC 4.0 的 NC 判断具有事实特定性，取决于实际使用方式、收费结构、宣传方式与商业意图；本报告给出的是边界与风险分级，不是对具体交易的合法性认定。
- 第三方内容只核对了上游声明与本地排除清单，未逐文件做版权溯源；商业发布前的全文审计不可省略。

## 11. 下一步

1. **已完成（2026-10-27）**：运行时署名已加入 `buildAnnounce` 与每个 prelude；见 §12。
2. **已完成（2026-10-27）**：README、NOTICE、package description 已加入非官方声明与商用边界；见 §12。
3. 若计划商业化：起草给上游的书面许可请求，明确插件分发、付费层级、再许可、期限、地域与费用（约 30 分钟）。
4. 由执业律师审查许可请求与 NC 边界（约 1–2 小时）。
5. **已完成（2026-10-27）**：第三方内容全文审计见 [`docs/third-party-audit.md`](third-party-audit.md)；商业化前需清理 S2、COREQ、STROBE、IEEE 引文。

## 12. 修订记录（2026-10-27）

按第 8.1 节完成 3 项优先修复，并补充测试、变更记录与验证记录。

| 项 | 修订文件 | 具体改动 | 验证 |
|---|---|---|---|
| 运行时署名 | `lib/adapt.js` | 新增 `UPSTREAM_ATTRIBUTION`、`NON_AFFILIATION_NOTICE`；`buildAnnounce` 与 `buildPrelude` 输出署名与商用边界 | `test/adapt.test.mjs`、`test/e2e.test.mjs` 断言；`adapter.lint` 为 0 |
| 非官方声明 | `README.md`、`NOTICE.md`、`package.json` | 新增 “License and commercial use” 段；NOTICE 增加非关联、商用、担保段；description 标注 unofficial | 文档检查 |
| 商用边界 | `README.md`、`NOTICE.md` | 明确非商业、商用需书面许可、给出上游与适配层联系路径 | 文档检查 |
| 计数修正 | `README.md`、`docs/license-assessment.md` | 43 个唯一角色（4 暴露 + 39 内联），47 个角色文件含 4 个镜像 | 与 payload 计数一致 |
| 前言去重 | `lib/adapt.js` | 移除 `buildPrelude` 重复输出的 `Skill directory` 行，改由 `conventionsText` 单一负责 | 每份前言仅一行；测试通过 |
| 第三方审计 | `docs/third-party-audit.md`、`NOTICE.md`、`ASSET-LICENSES.md`、`README.md` | 字体、引文、9 个报告指南、11 个 API 逐项复核；标注 S2/COREQ/STROBE/IEEE 四项商用阻塞 | 审计报告；`NOTICE`/`ASSET-LICENSES` 交叉引用 |
| 商业模式 | `lib/config.js`、`lib/adapt.js`、`lib/env.js`、`index.js`、`cordis.patch.yml` | 新增 `commercialMode`；announce/prelude 输出商业边界；脚本环境导出 `ARS_COMMERCIAL_MODE=1` | `test/config.test.mjs`、`test/adapt.test.mjs`、`test/env.test.mjs` |
| 商业构建 | `tools/build-commercial.mjs`、`docs/commercial-build.md` | 独立副本：S2 跳过、COREQ/STROBE 改为指针、IEEE 压到 42 词、补许可标注、重算哈希 | 严格构建通过；`check-payload` 0 errors；228 tests / 226 pass / 2 skip |
| 测试与记录 | `test/adapt.test.mjs`、`test/e2e.test.mjs`、`docs/verification.md`、`CHANGELOG.md` | 新增运行时声明断言；记录 225 测试与验证结果 | `node --test test/*.test.mjs`：225 / 223 pass / 0 fail / 2 skip |

### 12.1 验证结果

| 命令 | 结果 |
|---|---|
| `node --test test/*.test.mjs` | **228 tests, 226 pass, 0 fail, 2 skipped** |
| `node tools/verify-install.mjs` | **44 PASS, 0 FAIL, 4 WARN, 2 SKIP** |
| `node tools/check-payload.mjs` | **0 errors, 4 warnings** |
| `node tools/build-python-wrapper.mjs --check` | up to date |

两个 skip 仍是真实 `@deepseek-ai/dsh-tools` 校验器用例；payload 未改动（1,199 文件 / 24,118,122 字节）。

### 12.2 未完成的项

- 商业许可谈判与书面合同（§9 路径 A）。
- 商业化的第三方清理：`tools/build-commercial.mjs` 已自动处理 S2/COREQ/STROBE/IEEE；仍需上游许可、COREQ/STROBE 许可（如恢复原文）、PingFang 替换与法律审查。
- 专利 FTO（仅在商业化时必要）。
- 上游后续版本的许可复核（本报告基于 commit `1ec249d`）。
