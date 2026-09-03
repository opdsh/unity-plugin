[English](README.md) | 中文

# unity-plugin

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，让 agent 通过官方 [`unity` CLI](https://docs.unity3d.com/hub/manual/CLI.html) 驱动 Unity 编辑器来开发 Unity 游戏：创建工程、执行实时编辑器场景命令、在编辑器内执行 C#、运行测试与构建。

## 注册了什么

| 工具 | 用途 |
| --- | --- |
| `unity_status` | 报告可通过 Pipeline 服务访问的正在运行的编辑器实例。 |
| `unity_list_commands` | 列出已连接编辑器的命令目录及其参数结构。 |
| `unity_command` | 执行一条实时编辑器命令（`create_gameobject`、`get_scene_hierarchy`、`save_scene` 等）；一秒内完成，且不触发域重载。 |
| `unity_eval` | 在编辑器进程内执行 C#，可完整访问 `UnityEngine`/`UnityEditor`。 |
| `unity_cli` | 面向其余全部 CLI 能力的原始出口：`projects create`、`open`、`pipeline install`、`templates list`、`editors`、`test`、`build`、`auth`、`license`、`logs`。 |

当 dsh 部署具备技能支持时（已组合 `skills` 服务；标准 profile 均具备），插件会通过 `@deepseek-ai/dsh-skill-filesystem` 挂载两个技能根目录：

- **Unity 官方技能集**，在插件激活时从 [Unity-Technologies/skills](https://github.com/Unity-Technologies/skills) 拉取（unity-cli、new-unity-project、build-live-game、ui 系列、包管理、物理、优化、多人联机等）到 `<dshHome>/cache/unity-plugin/unity-skills`。拉取方式是对所配置 `unitySkillsRef` 的浅克隆（默认为固定的已验证提交；也可设为 `main` 之类的分支以获取更新的内容）。同一个 ref 只拉取一次，改动 ref 会重新拉取。若拉取失败，已有缓存继续生效；若没有缓存，插件会记录一条警告并仅使用自带技能运行。机制与上游缺陷处理见 [assets/UNITY-SKILLS-UPSTREAM.md](assets/UNITY-SKILLS-UPSTREAM.md)。
- **插件自带技能**（`assets/skills/`）：`unity-workflow`，即 `unity_*` 工具的操作知识（状态优先的纪律、工程引导顺序、场景循环、构建与测试调用）；以及 `unity-asset-store`，用于搜索、下载并安装用户已购买的 Asset Store 资源。

所有挂载的技能都使用标准的 `bundled` 等级，因此同名的项目级或用户级技能会覆盖它们。

当部署具备用户设置支持时（已组合 `settings` 服务；标准 profile 均具备），插件还会注册 `unity` 设置命名空间（可由用户编辑的子集：两个超时时间与输出上限），其浏览器端会在 dsh Web 界面的「设置 → 插件 → 插件配置」下加入一张 **Unity Plugin** 卡片。在此保存的值会按用户覆盖组合配置，并标记为已覆盖，且即时生效：工具与热 shell 会以新值重新挂载，无需重启。留空的字段沿用部署配置。

实时编辑器工具以结构化输出返回 CLI 统一的 JSON 信封（`{ success, command, data, errors, warnings }`），因此能与 Code Mode 良好配合。

## 前置条件

- DeepSeek Harness 0.1.2-alpha.5 或更新版本。该版本把设置消费者 API 移到了 `settings` 服务上，并用 `dsh-client-store` 取代了 `dsh-client-runtime`；本插件已跟进，不再支持 0.1.1。
- 已安装并完成认证的 `unity` CLI（`unity auth status`），且许可证已激活。
- 用于实时控制的 Unity 6.0+ 编辑器；目标工程需要 `com.unity.pipeline` 包（`unity pipeline install --project-path <p>`；agent 也可自行通过 `unity_cli` 执行）。

## 安装

安装到 dsh profile 中（`dsh plugin add` 会把 spec 透传给 `pnpm add`，因此 pnpm 支持的任意 spec 都可用）：

```sh
dsh plugin --profile <name> add @opdsh/unity-plugin      # 从 npm
dsh plugin --profile <name> add github:opdsh/unity-plugin  # 从 GitHub
dsh plugin --profile <name> add /path/to/unity-plugin      # 本地检出
dsh --profile <name> --dump-config                         # 确认 "# == unity-plugin" 层已生效
dsh --profile <name>
```

从 GitHub（而非 npm）安装时，会经由包的 `prepare` 脚本进行构建，而 pnpm 在包被加入白名单前会阻止该行为。首次尝试会以 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 失败；在 profile 的 `pnpm-workspace.yaml` 中加入以下内容后重试：

```yaml
onlyBuiltDependencies:
  - "@opdsh/unity-plugin"
```

本地检出以链接方式安装，无需白名单条目，但你必须先自行构建（`pnpm install && pnpm build`）。

bundle 补丁会以 schema 默认值插入该插件。可在 profile 的 `cordis.patch.yml` 中覆盖配置（一个补丁会替换该行的整个 `config`，因此需要写全所有你要保留的键）：

```yaml
- insert:
    - id: unity
      name: '@opdsh/unity-plugin'
      config:
        unityBin: unity
        projectPath: /abs/path/to/MyGame   # 实时编辑器工具的默认目标工程
        commandTimeoutMs: 120000           # 必须大于 0
        cliTimeoutMs: 600000               # 必须大于 0
        graceMs: 5000
        outputMaxBytes: 512000             # 必须大于 0
        env: {}                            # 例如 CI 环境的 UNITY_SERVICE_ACCOUNT_ID/SECRET
        warmShell: true                    # 实时编辑器工具复用同一个 `unity shell` 进程
        shellIdleMs: 300000                # 空闲热会话的回收时间
        unitySkillsRepo: https://github.com/Unity-Technologies/skills  # 置空则关闭下载
        unitySkillsRef: 87fac23d66a1f44f5e06c2935eccce0b40b9715a       # 也可填分支，如 main
```

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
```

构建产出两个产物：`lib/index.mjs`（dsh Loader 导入的 Node 端）与 `lib/client.js`（浏览器端，采用 harness 的 client-bundle 形态，通过 package.json 中的 `dsh.client` 声明，并由 Web 界面在 `/plugins/@opdsh/unity-plugin/client.js` 提供）。client-modules 扫描是**按包名**从 profile 目录解析插件的，因此只有当插件被安装进 profile（`dsh plugin add`）时浏览器端才会加载；使用绝对路径的 `--patch` 开发覆盖层只会加载 Node 端。

若要在不安装的情况下，针对一个 deepseek-harness 检出从源码加载，请编写一个指向本检出入口文件的补丁覆盖层（路径必须是绝对路径，且需先在此处执行过 `pnpm install`，源码中的 import 才能解析）：

```yaml
# dev.cordis.yml
- insert:
    - id: unity
      name: '/abs/path/to/unity-plugin/src/index.ts'
```

然后在 deepseek-harness 检出中运行：

```sh
pnpm dsh web --patch /abs/path/to/dev.cordis.yml
```

## 设计说明

- 工具通过 harness 的 `subprocess` 服务启动 CLI（使用 `argv`，绝不经过 shell 解释；采集的输出有上限；按进程树终止；转发中止信号，因此工具超时会杀死整个进程树）。
- 四个实时编辑器工具（`unity_status`、`unity_list_commands`、`unity_command`、`unity_eval`）走一个热 `unity shell --protocol ndjson` 会话（每个工作目录一个长期存活的 CLI 进程；请求为 `{"id","argv"}` 行，响应为 `{"id","exitCode","envelope"}`），把每次调用的延迟从约 600 毫秒的 CLI 启动降到个位数毫秒。同一会话内的请求串行执行；请求进行中发生工具超时或取消会杀死整个会话进程树（共享进程中的单个请求无法被单独取消），下次调用会重新拉起；空闲会话在 `shellIdleMs` 后被释放。设置 `warmShell: false` 可退回到每次调用一个 CLI 进程（例如 CLI 版本不支持 `unity shell` 时）。`unity_cli` 始终按调用启动进程：构建与测试耗时长，需要原始输出流，而不是串行的 REPL 轮次。
- 每次调用都带 `--non-interactive`，因此需要交互输入的命令会显式失败，而不会挂起 agent。
- subprocess 服务会从子进程中清除形似凭据的环境变量；CI 的服务账号凭据必须通过 `env` 配置字段显式传入。
- `commandTimeoutMs`、`cliTimeoutMs`、`outputMaxBytes` 必须大于 0：小于等于 0 的超时不会被工具注册表接受，因此 schema 会直接拒绝该值，而不是让它把工具注销掉。设置卡片会把这类输入标记为非法并阻止保存；已存储的非法值则会让该命名空间保留上一个有效值。
- 另一种集成方式：该 CLI 自带一个 MCP stdio 服务（`unity mcp`），暴露同样的编辑器命令。把 `@deepseek-ai/dsh-mcp-client` 接到它上面（`command: unity`，`args: [mcp]`）无需写代码即可工作，但会失去 dsh 的渲染卡片、配置校验与精心编写的工具描述。本插件正是为提供这些而存在。

## 已知限制

- 编辑器命令集是运行时发现的；本插件不固定也不校验各命令的参数结构。
- `unity_cli` 按设计每次调用都要启动一个 CLI 进程（见设计说明）；只有四个实时编辑器工具使用热会话。
