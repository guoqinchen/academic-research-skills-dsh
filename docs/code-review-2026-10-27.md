# 代码审阅报告 — academic-research-skills-dsh

- 基线：`main` @ `395082c`（v1.0.5），工作树干净
- 审阅方式：全量静态阅读（lib 20 模块 / tools 6 脚本 / test 11 套 / 文档 5 篇）+ 实测（测试、打包、校验、计时、脚本扫描）
- 审阅范围：`payload/` 为上游逐字节快照（1,199 文件），只评其完整性、许可与运行风险，不评上游代码风格

> **执行状态（2026-10-27）。** P1 五项、P2 十项（P2-4 部分）、P3 六项与重复逻辑 #1–#8 已落地，验证见
> `docs/verification.md` §0（224 用例 / 222 通过 / 2 跳过；`verify-install` 44 PASS / 4 WARN /
> 2 SKIP；`check-payload` 0 errors / 4 warnings）。
> 三项有意偏离原文，理由已记录：**P2-4** 不改 `inject`（Cordis 4.0.5 的 `Inject` 没有
> required/optional 之分，见 §13）；**P3-6** 保留 `test/` 与 `tools/` 随包发布（README 要求
> 用户自行运行这三条验证命令）；**P2-9** 的 `registerTools.warnings` 参数保留：实现虽不传，
> 但 `test/tools.test.mjs` 用它注入告警，属测试接缝而非死参数。
>
> **复核修正（同日 12:45）。** 本文档有 4 处事实错误（§6 P2-1、P2-4、§7 #5、§9 网络访问）
> 已就地更正，逐条依据见 **§13 审核修订记录**。其中 §9 的错误会抬高 `ars_script` 的风险等级：
> 载荷内确有 5 个出网客户端。

---

## 0. 结论摘要

| 维度 | 评级 | 依据 |
|---|---|---|
| 架构分层 | 4.0 / 5 | 无环分层，契约模块（payload / python / reference）各自单一真源 |
| 可维护性 | 3.5 / 5 | 注释与文档密度高；但存在死代码、死参数、三份重复注册样板 |
| 性能 | 3.5 / 5 | 无热点；但有可避免的全树遍历与每调用两次子进程探测 |
| 安全 | 3.0 / 5 | 无 shell 拼接、防穿越、fail-closed 做得好；`ars_script` 在写入守卫之外 |
| 测试 | 4.0 / 5 | 4,971 行测试 / 4,875 行被测代码，含上游 Python 对拍；关键路径有缺口 |
| 文档一致性 | 2.5 / 5 | 架构文档优秀，但 README 的验证数字与发布包内链接已漂移 |

**未发现 P0（数据破坏、构建不可重现、未授权远程执行）。** 列出 P1 5 项、P2 10 项、P3 6 项，均给出位置、影响与验收口径。

---

## 1. 项目定位

一个把上游 Claude Code 插件 `academic-research-skills`（CC-BY-NC-4.0，commit `1ec249d`，插件版本 3.23.2）移植为 DeepSeek Harness（DSH）Host bundle 的适配层。核心命题：

1. **载荷不可变**：`payload/` 是上游仓库的逐字节镜像，运行期只读，永不改写；
2. **注册期适配**：所有 Claude Code → DSH 的语义改写发生在内存中（`lib/adapt.js`），不落盘；
3. **确定性闸门**：上游 400+ Python 校验脚本通过受管解释器执行，模型不做本可由脚本判定的事；
4. **写入约束**：把上游 `PreToolUse` 钩子移植为 `ctx.tools.guard`。

## 2. 整体结构与技术栈

```text
index.js                     组合根：读配置 → 建 inventory → 协商 Host 能力 → 调各注册器
├── 契约层（纯数据/纯函数，无 I/O）
│   ├── lib/payload-contract.js   上游身份、载荷摘要、包含/排除清单、运行时依赖 pin
│   ├── lib/python-contract.js    解释器解析顺序、子进程环境策略、wrapper 文本生成
│   ├── lib/reference-rules.js    引用前缀约定（技能内 vs 载荷根）
│   └── lib/model-profile.js      DeepSeek Flash 能力与提示词片段
├── 解析层
│   ├── lib/frontmatter.js        零依赖 YAML 子集解析器
│   ├── lib/inventory.js          5 技能 / 16 命令 / 4 agent 角色的唯一清单
│   └── lib/reference-policy.js   约定 + 载荷布局的绑定
├── 适配层
│   ├── lib/adapt.js              16 步正则改写 + 兼容性前言
│   ├── lib/intake.js             读→解析→适配→lint 的统一管道
│   └── lib/registration.js       注册报告收集器 + effect 归属
├── 注册层
│   ├── lib/skills.js / agents.js / commands.js / announce.js
│   ├── lib/guard.js              写入守卫（上游 evaluate_decision 的移植）
│   ├── lib/env.js                受管 venv（uv → venv+pip 回退，带锁）
│   ├── lib/status.js             ars_status 载荷
│   └── lib/tools.js              ars_status / ars_script / ars_env_setup
├── bin/ars-python                POSIX sh 包装器（由 python-contract 生成，字节级校验）
├── tools/                        构建与校验工具（3,874 行）
├── payload/                      1,199 文件 / 24.1 MB（含 471 个 .py、412 个 .md）
└── test/                         214 用例 / 4,971 行
```

**技术栈**

| 层 | 选型 | 说明 |
|---|---|---|
| 运行时 | Node ≥ 22（CI 用 24），纯 ESM | 零 npm 依赖，仅 `node:*` 内建模块 |
| 宿主 | Cordis 插件模型（`ctx.skills/commands/tools/systemPrompt`、`ctx.effect`） | 不导入 `@deepseek-ai/*`，避免 linked bundle 解析失败 |
| 解释器 | Python ≥ 3.11，`uv` 优先、`venv`+`pip` 回退，8 个精确 pin | venv 在 `~/.cache/ars-dsh/venv` |
| Shell | POSIX `sh`（`set -eu`，无 eval） | Windows 明确不支持（`package.json` 的 `os` 与运行期告警一致） |
| 测试 | `node:test` + `assert/strict` | 无框架依赖 |
| 发布 | npm（主）+ GitHub Packages（镜像） | 8.1 MB tarball / 24.8 MB 解包 |

**依赖方向**：`契约层 → 解析层 → 适配层 → 注册层 → 组合根`，无循环依赖。扇入最高的是 `payload-contract`（6 处）与 `inventory`（7 处），符合"契约在上、消费者在下"的预期。

## 3. 核心模块职责与依赖

| 模块 | 行数 | 职责 | 依赖 | 风险点 |
|---|---:|---|---|---|
| `adapt.js` | 652 | 注册期文本改写、兼容性前言、残留学 lint | inventory, reference-policy, model-profile | 正则链脆弱；2 个死函数 |
| `guard.js` | 608 | 写入决策（纯函数）、glob/repath 移植、钩子注册 | 无（仅 fs） | 阶段栅栏恒不可用；`ars_script` 不在检查面 |
| `env.js` | 528 | venv 生命周期、依赖探测、锁 | python-contract | 锁无陈旧回收；状态文件全局单例 |
| `tools.js` | 442 | 三个模型可见工具、输出截断、进程组终止 | status | 解释器选择绕过 `pythonPath` |
| `status.js` | 431 | 状态快照 + 输出 JSON Schema | inventory, guard, model-profile, payload-contract | 全树遍历；`tools.get` 未 await |
| `frontmatter.js` | 364 | YAML 子集解析 | 无 | 结构严格，符合语料 |
| `payload-contract.js` | 352 | 唯一 pin 源 | 无 | 与构建期常量部分重复 |
| `inventory.js` | 275 | 唯一清单源（含 agent 镜像字节比对） | frontmatter, payload-contract | `localeCompare` 破坏确定性 |
| `python-contract.js` | 226 | 解释器策略 + wrapper 文本 | 无 | 与 `config.pythonPath` 未打通 |
| `commands.js` | 128 | 16 条命令注册与派发 | inventory, intake, registration | 未把 adapter 传给派发器 |
| `intake.js` | 102 | 统一解析/适配/lint 管道 | 无（注入 adapter） | — |
| `skills.js` / `agents.js` | 60 / 69 | 技能与角色注册 | inventory, intake, registration | 与 commands 三份重复样板 |
| `reference-rules.js` / `reference-policy.js` | 88 / 83 | 引用约定 + 绑定 | 互相 | 构建期另有一份副本 |
| `registration.js` | 66 | 报告收集 + effect | 无 | `collectLint` 无人调用 |
| `config.js` | 61 | 行配置归一化 | python-contract | 数值项无上限 |
| `paths.js` | 47 | 路径解析 | 无 | 3 个访问器被绕过 |

## 4. 四条关键运行路径

1. **挂载**：`apply()` → `createInventory`（读 25 个 Markdown + 4 个 agent 镜像比对）→ 建 policy/adapter/intake/env → 写运行时状态 → 注册 guard/announce/skills/agents/commands/tools → 汇总 `report.snapshot()` 并打日志。失败降级为 `strict:false`，逐条记入报告，不中断挂载。
2. **命令派发**：`/ars-*` → `dispatchCommand` → `adaptCommandBody(rawInput)` → `agent.followup(createUserMessage(text))`。命令输出留在命令面，不进模型请求。
3. **脚本执行**：`ars_script` → `resolveInside`（realpath + 前缀校验，拒绝穿越与软链逃逸）→ 扩展名白名单（`.py`/`.sh`）→ `spawn(shell:false)`，独立进程组，超时 `SIGTERM` → 2 s → `SIGKILL`，每流字节上限，UTF-8 截断不切码点。
4. **写入拦截**：`ctx.tools.guard` → `evaluateDecision`（先基础设施保护，再工作区逃逸，最后 Bucket A glob）→ 拒绝返回原因字符串，异常时 **fail closed**。

这四条路径的设计意图清晰，边界职责明确，是本项目最扎实的部分。

## 5. 代码质量：优点

1. **单一真源做得实**：载荷 pin、解释器策略、引用约定、清单各自集中，`REFACTOR-PLAN.md` 记录的 7 项收敛有据可查。
2. **失败模式偏保守**：guard 内部异常一律拒绝；schema 漂移（`file_path` 缺失）拒绝而非放行；载荷缺失时 `ars_status` 降级而非抛错。
3. **构建可重现**：`SOURCE_DATE_EPOCH` / 提交日期派生时间戳，复制后逐文件 SHA-256 与 mode 复核，二次运行幂等，`prunePayload` 拒绝越界删除。
4. **解释器一致性有工程手段**：wrapper 由契约生成、字节级比对、自定位，且禁写 `__pycache__` 保护载荷不可变性。
5. **测试与实现同量级**，且包含与上游 Python `evaluate_decision` 的 29/29 决策对拍——这类"跨语言黄金用例"比自测自更有价值。
6. **合规处理克制**：4 个第三方页面镜像不随包分发，`PROVENANCE.json` 保留 URL/Wayback/SHA-256，NOTICE 写明双重授权要求。

## 6. 缺陷清单

### P1 — 应在下一个补丁版本修复

| # | 缺陷 | 证据 | 影响 | 修复 |
|---|---|---|---|---|
| P1-1 | `ars_script` 忽略 `config.pythonPath` | `lib/tools.js:174-176` 对 `.py` 一律用 wrapper；wrapper（`lib/python-contract.js:151-226`）只认 `ARS_DSH_VENV`/状态文件/默认 venv/`python3` | 文档称 `pythonPath` 用于"运行脚本"（README 配置表），但未建 venv 时实际用 PATH 的 `python3`；系统 Python < 3.11 时表现为 `status.ready=true` 而脚本失败 | 让 `runtime-state` 同时记录解释器路径，wrapper 增加第 2.5 优先级的 `ARS_PYTHON`；或 system 模式直接 `spawn(env.pythonExecutable())`。补一条"`pythonPath` 生效于 `ars_script`"的用例 |
| P1-2 | `ars_script` 在写入守卫检查面之外 | `lib/guard.js:39-52` 只映射 `write/edit/multi_edit/bash` | `payload/scripts` 中 195/462 个脚本会写文件、40 个接受 `--out*`；被 guard 拒绝 `bash` 的调用方仍可经 `ars_script` 写任意路径。安全承诺与实现不一致 | 把 `ars_script` 纳入 `evaluateDecision`（解析 `args` 中的绝对路径与 `--out/--output/--dir`），或明确降级表述："guard 只约束结构化写入工具，不是沙箱"，并写入 README 与 threat model |
| P1-3 | venv 锁无陈旧回收 | `lib/env.js:362-378`（`open(...,'wx')` + 120 s 轮询），`380-391` 仅在正常路径 `unlink` | 进程被 `SIGKILL`/断电后 `.lock` 残留，此后每次 `ars_env_setup` 固定等 120 s 再失败，只能手工删除 | 锁文件写入 `pid` + `startedAt`；超阈值（如 10 min）视为陈旧并接管；失败信息给出锁文件路径与删除指引 |
| P1-4 | 工具 schema 校验在 CI 恒跳过 | `test/e2e.test.mjs:284,457` 以 `@deepseek-ai/dsh-tools` 不可达为 skip 条件；`.github/workflows/ci.yml` 只装 Python 依赖 | 手工编写的 3 个 `output.schema` 与 `parameters` 若超出 DSH 支持的 JSON Schema 子集，CI 全绿，故障推迟到用户安装后 | CI 增一个安装 `dsh-tools` 的 job 跑这两例；或把 skip 改为 `process.env.CI` 下 fail |
| P1-5 | README 验证数字与实测不符；发布包内链接失效 | README:207-208 写 "214 tests, all pass" / "46 PASS, 0 FAIL, 3 WARN, 1 SKIP"；实测 214 用例 212 通过 2 跳过、`verify-install` 44/0/4/2。`package.json:32` 只发布 `docs/compat-report.md`，README:216 链接的 `docs/verification.md` 在 npm 包内 404 | 使用者按 README 复现会得到不同结论；削弱"契约化"可信度 | README 不写死计数，改为"见 `docs/verification.md`（含日期与命令）"；CI 落地 `verify-install` 并把输出归档；`files` 补 `docs/verification.md`，或改链接指向仓库 URL |

### P2 — 一个迭代内处理

| # | 缺陷 | 证据 | 影响 | 修复 |
|---|---|---|---|---|
| P2-1 | `webSearch.toolAvailable` 未 await（**前提经复核为误判，见 §13**） | `lib/status.js:249-251`；同文件 `registrationState` 对 `ctx.skills.get` 明确 `await`（`116-131`）；`test/support/host.mjs` 未实现 `tools.get`。复核：`@deepseek-ai/dsh-tools@0.2.1-rc.3` 的 `get(name, scope)` 是同步的（`lib/types/index.js:624`），不存在 Promise 恒真 | 真实缺口是 fixture 缺该 API，`toolAvailable` 永远为 false、从未被覆盖；`await` 对同步/异步实现都安全，仍应保留 | `await` 后再 `Boolean`；host fixture 补 `get`，并加"工具不存在为 false / 注册后为 true"的用例 |
| P2-2 | 运行时状态文件是全局单例 | `lib/env.js:223,278-286` 固定写 `~/.cache/ars-dsh/runtime-state` | 同机多 profile/多 `envDir` 互相覆盖；后挂载者胜出，wrapper 可能选到别人的 venv | 状态文件按 `sha256(pluginRoot)` 分片，或记录 `(pluginRoot, envDir, pythonPath)` 三元组并在 wrapper 内校验 |
| P2-3 | `payload.contract.matches` 只比计数 | `lib/status.js:227-233` | 同尺寸内容篡改仍报 `matches:true`，字段名暗示完整性校验 | 改名 `countsMatch`，或加"抽样/缓存摘要"说明；完整性交给 `check-payload` |
| P2-4 | `inject` 与内部降级逻辑矛盾 | `index.js:40` 声明四个必需服务；`101-133` 用 `hostCapabilities` 逐项降级。复核：`@deepseek-ai/cordis@4.0.5` 的 `Inject` 只有"服务数组"与"服务→intercept 配置对象"两种形态，**没有 required/optional 之分**；代理对未声明服务抛 `cannot get property ... without inject` | 缺任一服务 `apply` 不会执行，`report.fail(...)` 对"整服务缺失"永不触发；降级只对"服务存在但能力不全"有效 | 文档化 + 拆分 `tools`/`toolGuard`（已做）；**不改 `inject`**——原建议"其余改可选注入"在该版本不存在对应 API |
| P2-5 | 命令/技能排序用 `localeCompare` | `lib/inventory.js:121`、`lib/commands.js:33`；其余全项目用 `Buffer.compare` 字节序 | 注册顺序与报告顺序随 locale 变化，破坏"确定性"承诺（构建期工具恰恰严格用字节序） | 统一 `compareBytes`，与 `tools/build-payload.mjs:145` 共用 |
| P2-6 | 校验器硬编码作者家目录 | `tools/check-payload.mjs:58` `'/Users/max'` | 换机器后该检查变成空检查，仍输出"free of build-machine paths"；同时把他人的用户名写进随包发布的工具 | 由 `os.homedir()` 派生；CI 与本地一致 |
| P2-7 | 发布链路的两类风险 | 三个 workflow 均以 `@v7` tag 引用 actions，`publish-github-package.yml` 持 `packages: write`；`upstream-check.yml` 把 `${{ inputs.ref }}` 直接插入 `run:` 两处（`REF=` 与 `git fetch`） | tag 可被上游移动 → 供应链风险；表达式注入面（虽限于有写权限者触发） | actions 固定到 commit SHA；ref 走 `env:` 并校验 `^[A-Za-z0-9._/-]+$` |
| P2-8 | token 落盘权限 | `tools/publish-github-package.mjs` `writeFileSync(npmrc, ...)` 继承 umask（通常 0644），异常退出时 `/tmp` 下残留 | 同机其他用户可读 `GITHUB_TOKEN` | `{ mode: 0o600 }` + `process.on('exit')`/`try/finally` 双保险 |
| P2-9 | 死代码与死参数 6 处 | `lib/adapt.js:441,575`；`lib/paths.js:45`；`lib/inventory.js:273`；`lib/registration.js:62`；`lib/reference-rules.js:86`；`registerTools` 的 `warnings`/`policy`、`registerGuard` 的 `policy`/`logger`、`dispatchCommand` 的 `adapter` 分支均无调用方 | "单一真源"的承诺被削弱；读者需自行判断哪份实现有效；`INTERFACES.md` 仍把它们列为接口 | 删除或在文档中标注 deprecated 并在下个小版本移除；`docs/INTERFACES.md` 同步。**复核补充**：`collectLint` 的处置与重复 #1 的"复活"建议冲突，最终由 `intake` 独占 lint 并删除该函数 |
| P2-10 | 配置项无边界或无障碍 | `lib/config.js:40-41` 对 `scriptTimeoutMs`/`maxScriptOutputBytes` 只设下限；`modelProfile` 仅用于日志与状态标签，不改变任何提示词（`lib/model-profile.js` 全静态） | `scriptTimeoutMs > 2^31-1` 会被 Node 截为 1 ms，导致所有脚本秒超时；`maxScriptOutputBytes` 无上限可致内存膨胀；`modelProfile` 形同虚设 | 归一化时钳制上限（`2^31-1`、如 8 MB）；`modelProfile` 要么驱动 guidance，要么在 README 标注"仅标签" |

### P3 — 清理项

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P3-1 | `\bClaude\b` → "the session model" 会误伤人名 | `lib/adapt.js:62-63,272` | 当前语料唯一命中是 "Claude Code"（已先被 `replaceAll` 处理）；若上游新增 "Claude Shannon" 类引用会被改写。建议改为 "Claude Code" 与 "Claude API/CLI" 的枚举替换 |
| P3-2 | 用户输入参与 lint，产生假警告 | `lib/commands.js:113-116` | 用户请求里出现 "Claude Code" 会记一条残留告警；`intake.js:87-88` 已意识到该问题但对派发路径未处理 |
| P3-3 | 无意义构造 | `lib/status.js:194` `agentRoleNames.map((name) => ({ name }))` 再解构 | 直接遍历字符串数组即可 |
| P3-4 | 字段名误导 | `lib/tools.js:210` 返回 `python: <wrapper 路径>` | 调用方按"解释器"理解会误判；改名 `interpreter` 或在 schema 描述中说明 |
| P3-5 | 上游单体脚本与未解析引用 | `payload/scripts/check_audit_artifact_consistency.py`（2,313 行）；`REFERENCE-INDEX` 80 条未解析引用（72 个目标） | 属上游继承债，`check-payload` 已按 warning 处理；建议在 `docs/verification.md` 固定该基线，避免数字漂移 |
| P3-6 | 发布包包含测试与工具链 | `package.json:33-34` | 24.8 MB 解包 / 8.1 MB tarball，其中 `test` 210 KB、`tools` 163 KB；若不需要"用户侧自检"，可用 `.npmignore` 或独立 `files` 裁剪，并用 `npm pack --dry-run` 做体积门禁 |

## 7. 坏味道与重复逻辑

| # | 重复/坏味道 | 位置 A | 位置 B | 建议 |
|---|---|---|---|---|
| 1 | 三个注册器的 warn/fail 样板逐字重复 | `lib/skills.js:35-39,43-46,54-56` | `lib/agents.js:44-48,52-55,63-65`；`lib/commands.js:62-66,70-73,90-92` | 抽 `reportSurface({report, logger, warnings, label})`，把 3×12 行降为 3×3 行；`registration.js:62` 的 `collectLint` 正好可以复活承担 lint 部分 |
| 2 | 脚本路径解析两份，其中一份是死代码 | `lib/reference-rules.js:78-83` | `lib/adapt.js:441-448`（未被调用） | 删除 adapt 内副本，只留 policy |
| 3 | 技能目录拼接四份 | `lib/paths.js:38-39,45` | `lib/inventory.js:273`；`lib/reference-policy.js:29`；`lib/adapt.js:575` | 全项目统一走 `paths.skillDirectory()`；`status.js`/`adapt.js` 中直接 `join(payloadRoot, skill)` 的地方一并替换 |
| 4 | 引用前缀常量两份（构建期 vs 运行期） | `tools/build-payload.mjs:94-106` | `lib/reference-rules.js:13-19` | `build-payload` 改为 import；两份一旦分叉，REFERENCE-INDEX 与运行时前言会给出不同约定 |
| 5 | 目录遍历实现四份（**复核修正：实为两份同构 + 两个不同用途**） | `build-payload.collectPayloadInventory` / `digestTree` | `check-payload.payloadInventory`；`build-payload.listMarkdownFiles`（递归）；`check-payload.listMarkdown`（单目录，**不是重复**） | `payloadInventory` 与 `collectPayloadInventory` 合并（已做，加 `onFile` 回调）；`digestTree` 保留（需目录/软链条目）；两个 `listMarkdown*` 语义不同，不合并 |
| 6 | 摘要工具重复 | `payload-contract.js:319`（`formatBytes`） | `build-payload.mjs:161` 私有副本；`compareBytes` 在 `build-payload:145` 与 `check-payload:107` 各一份；`sha256*` 在 `build-payload:149-155` 与 `check-payload:111` 各一份 | 全部收敛到 `payload-contract`（它已是零 I/O 的纯函数模块，适合放这些） |
| 7 | 契约比较逻辑两套 | `build-payload.verifyContractSnapshot` | `check-payload` 的 `compareNumber/String/Array/Objects` + `check-upstream.compareContract` | 抽一个 `compareContractValues(actual, expected)`，返回 failures 数组，三处共用 |
| 8 | 文档数字与工具输出两套真源 | `README.md:207-208` | `tools/verify-install.mjs` 的实际输出 | 数字只在 `docs/verification.md` 出现一次，README 引用之 |

## 8. 性能实测

| 场景 | 实测 | 说明 |
|---|---|---|
| `createInventory`（挂载时一次） | 114–124 ms | 其中读取约 30 个文件；本机 `readFileSync` 单次约 2.9 ms（16 个命令文件读+解析 46 ms），属本机 FS 延迟异常，非代码热点 |
| `buildStatus`（`ars_status`，stub 掉进程探测） | 27.5 ms | 遍历 1,199 文件 `statSync` + 151 目录 + 递归统计 642 脚本 |
| 真实 `ars_status` 额外开销 | 2 次子进程 | `uv --version`（`lib/env.js:308`）+ Python 探针（`314-317`），各约 20–80 ms |
| `ars_script` | 1 次 spawn | 独立进程组、每流 200 KB 上限、超时先 `SIGTERM` 后 `SIGKILL`；实现正确 |
| guard 每次写入决策 | 亚毫秒 | 2×(realpath 端口 + `canonicalCase`)，按路径深度做 `lstat`；网络盘上需重新评估 |
| 打包 | 1,255 文件 / 24.8 MB 解包 / 8.1 MB tarball | 载荷占 24.2 MB |

结论：**当前没有性能瓶颈**。可优化项按性价比排序：

1. `ars_status` 的 `summarizePayload` 改用 `PROVENANCE.json` 的 totals（省 1,400 次 syscall），仅在 `full: true` 时现算；
2. `env.status()` 的 `uv --version` 探测按进程生命周期缓存（`ars_status` 可被连续调用）；
3. `createInventory` 结果在 `apply` 内已复用，无需进一步缓存；但要避免 `ars_status` 在未传 inventory 时重建（`lib/status.js:148`）。

## 9. 安全与合规评估

**威胁模型**：载荷内的 Markdown 会被模型读取并作为指令执行；载荷内的脚本会被执行；模型可调用 3 个工具与 16 条命令。因此"载荷内容"应按**不可信输入**对待，"脚本执行"是**明示的代码执行能力**。

做对的部分：

- 子进程一律 `shell: false` + argv 数组，路径用 `shellPath()` 在含空格/元字符时加双引号并转义 `" \ $ \``；
- `resolveInside()` 用 `realpath` + `relative` 前缀判定，拒绝穿越与软链逃逸，且要求目标是常规文件；
- guard 先判基础设施、再判工作区逃逸、异常时 fail closed；`INFRA_PROTECTED_GLOBS` 覆盖 `index.js`/`lib/**`/`bin/**`/`cordis.patch.yml`/`package.json` 及上游 enforcement 文件；
- Python 侧无 `shell=True` 的实际调用（仅 2 处检查器把该字符串当作禁止项）；依赖全部精确 pin；
- **（2026-10-27 复核修正）载荷并非"无网络"**：`payload/scripts` 有 11 个文件具备出网能力（导入 `urllib.request` / `http.client`），其中 `arxiv_client.py`、`openalex_client.py`、`crossref_client.py`、`semantic_scholar_client.py`、`chinese_literature_client.py` 是真实客户端；另有 18 个文件只用 `urllib.parse`（纯解析，不出网）。原文"无 `requests`/`urllib` 调用（全量 grep 确认）"错误，已记入 §13；
- `PYTHONDONTWRITEBYTECODE=1` 双路径设置，防止脚本写入 `__pycache__` 破坏载荷摘要。

风险与缺口：

1. **`ars_script` 是 guard 的旁路，也是出网通道**（P1-2）。这不是实现 bug，而是能力边界未声明：一个被拒绝 `bash` 的调用方仍能通过 195 个可写脚本之一落盘；同一批脚本中有 11 个具备出网能力（含 arXiv、OpenAlex、Crossref、Semantic Scholar 等真实客户端）。P1-2 的修复只检查"声明的输出路径"，不检查网络。
2. **阶段栅栏不可用**（`lib/guard.js:62-66`，README 已诚实披露）。因此 guard 实际只剩"基础设施保护 + schema 漂移拒绝"，不应被宣传为写入沙箱。
3. **`runtime-state` 是可变信任源**：任意能写 `~/.cache/ars-dsh/runtime-state` 或设 `ARS_DSH_VENV` 的进程可让插件执行任意 venv 中的 Python。与"插件本来就执行脚本"同信任级，但值得在威胁模型里写明。
4. **CI 供应链**：tag 引用 + `packages: write` + 表达式注入（P2-7）；建议发布 job 增加 `npm pack` 产物摘要与 provenance（`--provenance`）。
5. **许可证**：CC-BY-NC-4.0 覆盖上游与适配器（NOTICE 明确要求双重授权）。这是法律上的正确选择，但其非 OSI 属性会让 npm 使用者误判为可商用；建议在 README 首屏与 `package.json` 的 `description` 之外的显著位置再声明一次，并给出商用联系路径。

## 10. 测试与 CI

覆盖良好的部分：

- 与上游 Python guard 的 29/29 决策对拍（含 advisory flags），是最高价值的回归网；
- 真实载荷的 e2e 挂载：5 技能 + 4 角色 + 16 命令注册、announce 文本、命令派发消息形状；
- 输出截断的 UTF-8 边界、超时、并发 `ensure()` 的锁串行化、`force` 重建、Python < 3.11 拒建；
- 载荷构建的幂等、模式保留、软链拒绝、摘要比对。

缺口（按风险排序）：

1. 工具 schema 的真实校验器在 CI 缺席（P1-4）；
2. `status` 的 `tools.get` 分支无覆盖（P2-1），`toolAvailable` 从未在测试中为 true；
3. `pythonPath` 只在 env 层测过，没有"`ars_script` 用它执行"的用例（P1-1）；
4. macOS 专属分支（大小写不敏感路径、APFS `realpath`）只在开发者机器上跑，CI 仅 ubuntu；
5. 锁的**陈旧**路径无测试（只有并发路径）；
6. 无覆盖率统计、无 lint/格式化门禁、无 `node --check` 级别的语法门禁（对 4,875 行 JS 而言尚可接受，但补上成本极低）。

## 11. 改进路线

### 第一批（半天，P1）

1. `ars_script` 解释器一致性（P1-1）：改 `runtime-state` 为 `key=value` 两行（`envDir`、`python`），wrapper 读两行；`lib/tools.js` 保持单一路径。**验收**：`pythonPath=/usr/bin/false` 时 `ars_script` 失败且 `ars_status.python.executable` 与之一致；新增 1 条用例。
2. 守卫边界（P1-2）：`ars_script` 纳入 `evaluateDecision` 的 `args` 扫描（识别绝对路径与 `--out*`），或明确降级文案。**验收**：Bucket A 场景下 `ars_script --out /tmp/x` 被拒；README 的安全章节与实现一致。
3. 锁回收（P1-3）：写 `pid/startedAt`，超 10 min 接管。**验收**：预置陈旧锁文件后 `ensure()` 在 1 s 内完成而非 120 s 超时；新增用例。
4. CI 补 schema 校验（P1-4）：加 `dsh-tools` job 或 `CI=1` 下不 skip。**验收**：故意破坏 `STATUS_OUTPUT_SCHEMA`（例如改用 `anyOf`）时 CI 变红。
5. 文档数字（P1-5）：README 去数字、`files` 补 `docs/verification.md`、CI 跑 `verify-install` 归档。**验收**：`npm pack` 后解包，README 内所有相对链接可解析。

### 第二批（一天，P2）

6. `status` 的 `await` 与 host fixture 补齐（P2-1）。
7. 状态文件分片（P2-2）→ 修 `inject` 语义（P2-4）→ `contract.matches` 改名（P2-3）。三者都在状态/配置面，一起改可复用同一批测试。
8. 排序统一 `compareBytes`（P2-5）；`check-payload` 家目录派生（P2-6）。
9. 发布链路加固（P2-7、P2-8）：SHA 固定、`env` 传参、`.npmrc` 0600。
10. 清理死代码与死参数（P2-9）、配置上限（P2-10）。

### 第三批（半天，P3 + 重复逻辑）

11. 抽 `reportSurface()`，合并三个注册器样板（重复 #1）；删除 6 处死代码（P2-9 的代码面）。
12. 构建期 import 运行期常量（重复 #4），合并遍历与摘要工具（#5、#6、#7）。
13. 收窄 `\bClaude\b` 替换范围（P3-1），派发路径不做 lint（P3-2）。

**不建议现在做的事**：把 `payload` 压缩/分卷、给 guard 加角色注册表（DSH 无 `agent_type`，会把"诚实不可用"变成"假装可用"）、为 `adapt.js` 引入完整 Markdown AST（当前正则链有 lint 兜底，收益不足以抵消重写风险）。

## 12. 下次复审应对齐的指标

| 指标 | 当前 | 目标 |
|---|---|---|
| 测试 | 214 用例 / 212 通过 / 2 跳过 | 0 跳过（CI 内） |
| `verify-install` | 44 PASS / 4 WARN / 2 SKIP | README 与实跑一致，WARN 有归属 |
| 死代码/死参数 | 6 处 + 4 个死参数 | 0 |
| 已知重复实现 | 8 组 | ≤ 3 组（仅保留构建期/运行期必要的隔离） |
| 未 await 的宿主调用 | 1 处（`tools.get`） | 0 |
| README 硬编码计数 | 2 处 | 0 |

## 13. 审核修订记录（2026-10-27 12:45）

本轮对本文档做了事实核查（以已安装的依赖源码与全量 grep 为依据），发现 4 处错误、2 处口径问题，均已在对应段落就地标注：

| 位置 | 原文 | 核查结论 | 依据 |
|---|---|---|---|
| §9「做对的部分」 | "无 `requests`/`urllib` 调用（全量 grep 确认）" | **错误**。11 个脚本具备出网能力（`urllib.request`/`http.client`），5 个是真实客户端；另有 18 个只用 `urllib.parse`。`ars_script` 因此也是网络出口，风险等级应上调 | `grep -rlE "^(import\|from) (urllib\.request\|http\.client\|requests\|httpx\|aiohttp)" payload --include=*.py` |
| §7 #5 | `listMarkdown` 与 `listMarkdownFiles` 重复 | **错误**。前者单目录、后者递归，语义不同；真正的重复是两个 payload 游走器 | 两函数源码 |
| §6 P2-1 | "若 `tools.get` 返回 Promise 则恒真" | **前提不成立**。`@deepseek-ai/dsh-tools@0.2.1-rc.3` 的 `get(name, scope)` 同步返回；真实缺口是 fake host 没有该 API，字段从未被覆盖 | `lib/types/index.js:624`：`get(name, scope) { return this.view(scope).visible.get(name) }` |
| §6 P2-4 | "其余改可选注入" | **不可实现**。Cordis 4.0.5 的 `Inject` 只有服务数组与 intercept-config 对象两种形态，无 required/optional 之分；未声明服务的访问会抛错 | `@deepseek-ai/cordis@4.0.5` `lib/types/registry.d.ts:12`、`lib/index.js:676` |
| 执行状态 | "P2 九项" | 口径错误：P2 共十项，P2-4 为部分落地 | §6 表 |
| §6 P2-9 / §7 #1 | 一边列 `collectLint` 为死代码，一边建议"复活" | 建议冲突。最终由 `intake` 独占 lint 并删除 `collectLint` | 实施结果 |

另补一条计划与实现的差异：P1-1 与 P2-2 合并实施——运行时状态文件改为**按 pluginRoot 分行的三列 TSV**（`<root>\t<envDir>\t<python>`），而非 §11 原写的"两行 key=value"；这样同时解决了多 profile 覆盖与 `pythonPath` 传递两个问题。

发布状态：上述改动以 **2.0.0** 发布（破坏性变更：`ars_status.payload.contract.matches` → `countsMatch`，另含守卫作用域扩大）。版本号同时写入 `package.json` 与 `CITATION.cff`，`verify-install` 交叉校验两者一致；`test/e2e` 从 `package.json` 读取版本，发布不再需要改测试。

复核**未推翻**的结论：P1-1～P1-5 全部成立；`ars_script` 可写脚本 195/462、接受 `--out*` 的 40 个；载荷 1,199 文件 / 24,118,122 B / 151 目录；guard 与上游 Python 对拍 29/29；`REFERENCE-INDEX` 80 条未解析引用（72 个目标）。
