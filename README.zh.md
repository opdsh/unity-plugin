[English](README.md) | 中文

# DeepSeek Harness 的 Unity 插件

**用 AI agent 开发 Unity 游戏。** 本插件把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 接入 [Unity 游戏引擎](https://unity.com/)：你用自然语言描述想要的效果，agent 直接在 Unity 编辑器里完成工作——创建工程、搭建场景、编写并挂载 C# 脚本、导入你在 Asset Store 购买的资源、运行测试、打出可发布的构建。

插件通过 Unity 官方的 [`unity` 命令行工具](https://docs.unity3d.com/hub/manual/CLI.html)与编辑器通信，所以所有操作都发生在真实运行的编辑器里，与你屏幕上看到的内容始终一致。

## 你可以做什么

- **从零开始做一个游戏。** 说一句「用 URP 模板新建一个叫 SpaceRunner 的 3D 工程」，agent 会挑选模板、创建工程并打开编辑器。
- **动口不动手搭场景。** 添加 GameObject、摆放位置、挂载组件、连接预制体。场景命令在一秒内往返完成，无需重新编译。
- **编写玩法代码。** agent 会创建 C# 脚本、等待重新编译完成，再把脚本挂到正确的对象上。对于没有专用命令的操作，它还能直接在编辑器内执行 C#。
- **让你的 Asset Store 资源库派上用场。** agent 可以搜索你在 Unity Asset Store 拥有的资源（「My Assets」），下载并直接导入当前打开的工程。详见[使用你的 Asset Store 资源](#使用你的-asset-store-资源)。
- **看到并测试结果。** 截取 Scene 视图截图、进入和退出 Play 模式、运行 EditMode 和 PlayMode 测试。
- **发布游戏。** 为目标平台启动玩家构建。
- **遵循 Unity 官方最佳实践。** 插件内置 Unity 官方的 agent 技能集（UI、物理、性能优化、多人联机、包管理等），agent 按 Unity 的推荐做法工作，而不是靠猜。

## 前置条件

安装前请确认你已具备：

1. **DeepSeek Harness 0.1.2-alpha.5 或更新版本。** 更早的版本不受支持。
2. **`unity` 命令行工具**，已安装、已登录且许可证已激活。可用以下命令检查：

   ```sh
   unity auth status
   unity license status
   ```

3. **Unity 6.0 或更新版本**，通过 Unity Hub 安装。实时控制编辑器需要 Unity 6。
4. **Python 3.9 或更新版本**（仅 Asset Store 功能需要；无需安装任何第三方包）。

每个希望由 agent 操作的工程都需要 `com.unity.pipeline` 包。你不必手动添加：agent 可以替你安装，你也可以自己执行一次：

```sh
unity pipeline install --project-path /path/to/MyGame
```

## 安装

把插件加入你使用的 DeepSeek Harness profile：

```sh
dsh plugin --profile <name> add @opdsh/unity-plugin
dsh --profile <name>
```

就这样。启动 harness，然后让 agent 帮你做一个 Unity 游戏吧。

<details>
<summary>其他安装来源（GitHub 或本地检出）</summary>

```sh
dsh plugin --profile <name> add github:opdsh/unity-plugin  # 从 GitHub
dsh plugin --profile <name> add /path/to/unity-plugin      # 本地检出
```

从 GitHub 安装时会在安装过程中构建该包，而 pnpm 在包被加入白名单前会阻止这一行为。若首次尝试以 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 失败，在 profile 的 `pnpm-workspace.yaml` 中加入以下内容后重新执行：

```yaml
onlyBuiltDependencies:
  - "@opdsh/unity-plugin"
```

本地检出以链接方式安装，无需白名单条目，但需要先执行 `pnpm install && pnpm build` 自行构建。

要确认插件已加载，运行 `dsh --profile <name> --dump-config` 并查找 `# == unity-plugin` 段落。
</details>

## 第一次使用

1. 打开你的工程编辑器，或者让 agent 新建一个。
2. 提一个具体的要求，例如：

   > 打开 C:\Games\SpaceRunner 这个工程，在原点添加一个带 Rigidbody 的 Player 胶囊体，并写一个用 WASD 控制它移动的脚本。

3. agent 会检查正在运行的编辑器、发现编辑器提供的命令、完成修改并保存场景。

小贴士：

- agent 启动编辑器时会带上 `-automated` 参数，避免弹窗阻塞。你自己打开编辑器也没问题，agent 会找到它。
- 新工程第一次打开时 Unity 需要导入资源，可能耗时几分钟。agent 会等到编辑器报告「ready」再继续。
- 任何时候想看看场景的样子，让 agent 截一张图即可。

## 使用你的 Asset Store 资源

你在 [Unity Asset Store](https://assetstore.unity.com/) 购买或领取过的所有资源，agent 都可以使用。它使用 `unity` CLI 和 Unity Hub 已经登录的同一个 Unity 账号，无需任何额外设置。

按名称或描述提出需求即可：

> 把 2D Game Kit 加到这个工程里。

> 在我的资源里找一个低多边形自然场景包并导入。

agent 会依次：

1. 搜索你的「My Assets」资源库，选出匹配的包。
2. 检查该包是否支持你工程的 Unity 版本，不匹配时提醒你。
3. 从 Unity 服务器下载 `.unitypackage`。
4. 静默导入当前打开的工程，不弹出导入对话框。
5. 等待可能触发的重新编译完成，并告诉你文件落在 `Assets/` 下的哪个文件夹。

只有你已经拥有的资源才能这样使用。想用新资源时，在浏览器里于 Asset Store 购买或领取，它会立刻出现在你的资源库中。若 Unity 登录已过期，agent 会请你执行 `unity auth login` 或通过 Unity Hub 登录，然后继续。

Asset Store 功能支持 Windows 和 macOS，需要 Python 3.9 或更新版本。

## 配置

大多数人不需要改任何东西。如果确实需要：

**在 Web 界面中：** 打开 **设置 → 插件 → 插件配置**，找到 **Unity Plugin** 卡片。在这里可以调整两个超时时间和输出大小上限。修改即时生效，无需重启；留空的字段沿用默认值。

**在 profile 中：** 其余配置（默认工程路径、`unity` 可执行文件路径、CI 凭据等）请编辑 profile 的 `cordis.patch.yml`。一个补丁会替换插件的整个 `config` 块，因此需要写全所有你想保留的键：

```yaml
- insert:
    - id: unity
      name: '@opdsh/unity-plugin'
      config:
        unityBin: unity                    # unity CLI 不在 PATH 中时填写其路径
        projectPath: /abs/path/to/MyGame   # 编辑器命令的默认工程
        commandTimeoutMs: 120000           # 单条编辑器命令的超时；必须大于 0
        cliTimeoutMs: 600000               # 构建、测试等 CLI 调用的超时；必须大于 0
        graceMs: 5000
        outputMaxBytes: 512000             # 必须大于 0
        env: {}                            # 例如 CI 用的 UNITY_SERVICE_ACCOUNT_ID / SECRET
        warmShell: true                    # 保持一个 `unity shell` 常驻，加速编辑器命令
        shellIdleMs: 300000                # 空闲多久后关闭常驻 shell
        unitySkillsRepo: https://github.com/Unity-Technologies/skills  # 置空则关闭下载
        unitySkillsRef: 87fac23d66a1f44f5e06c2935eccce0b40b9715a       # 也可填分支，如 main
```

`unitySkillsRef` 固定了 Unity 官方技能的版本。默认是一个经过测试的提交；设为 `main` 可跟随最新内容。每个 ref 只下载一次，存放在 `<dshHome>/cache/unity-plugin/unity-skills`；若下载失败，已有缓存继续生效。

## 故障排查

| 现象 | 处理方法 |
| --- | --- |
| agent 报告找不到编辑器实例（`STATUS_NO_INSTANCES`） | 用 Unity 6 打开该工程，并确认已为它执行过 `unity pipeline install`。 |
| CLI 调用以退出码 3 失败 | 用 `unity auth login` 重新登录。 |
| CLI 调用以退出码 4 失败 | 没有可用的许可证。检查 `unity license status`。注意：打开着的编辑器会一直占用一个许可证席位，直到它关闭。 |
| Asset Store 搜索报 `AUTH_EXPIRED` 或 `AUTH_NOT_FOUND` | 用 `unity auth login` 或通过 Unity Hub 登录，然后让 agent 重试。 |
| 在 Linux 上使用 Asset Store | 暂不支持；目前只能在 Windows 和 macOS 上读取登录令牌。 |
| 其他问题 | 让 agent 运行 `unity doctor`，或查看编辑器日志（`unity logs`）。 |

## 包含的内容

**Agent 工具**

| 工具 | 用途 |
| --- | --- |
| `unity_status` | 列出插件可以通信的正在运行的编辑器。 |
| `unity_list_commands` | 发现已连接编辑器的命令及其参数。 |
| `unity_command` | 执行一条实时编辑器命令，如 `create_gameobject`、`get_scene_hierarchy`、`save_scene`。 |
| `unity_eval` | 在编辑器内执行 C#，可完整访问 `UnityEngine` 和 `UnityEditor`。 |
| `unity_cli` | CLI 提供的其余全部能力：`projects create`、`open`、`pipeline install`、`templates list`、`editors`、`test`、`build`、`auth`、`license`、`logs`。 |

**技能**

- **Unity 官方技能集**，从 [Unity-Technologies/skills](https://github.com/Unity-Technologies/skills) 下载：unity-cli、new-unity-project、build-live-game、UI 系列、包管理、物理、性能优化、多人联机等。
- **unity-workflow**：如何用上述工具安全地驱动编辑器（先检查状态、引导工程、场景循环、测试与构建）。
- **unity-asset-store**：搜索、下载并导入你在 Unity Asset Store 拥有的资源。

同名的项目级或用户级技能会覆盖内置技能。

## 面向贡献者

<details>
<summary>从源码构建与运行</summary>

```sh
pnpm install
pnpm typecheck
pnpm build
```

构建产出 `lib/index.mjs`（dsh Loader 导入的 Node 端）与 `lib/client.js`（浏览器端，通过 package.json 中的 `dsh.client` 声明，由 Web 界面在 `/plugins/@opdsh/unity-plugin/client.js` 提供）。浏览器端只有在插件按包名安装进 profile 时才会加载；使用绝对路径的 `--patch` 覆盖层只加载 Node 端。

若要在不安装的情况下针对一个 deepseek-harness 检出从源码加载，请编写一个指向本检出入口文件的补丁覆盖层（必须是绝对路径，且需先在此处执行过 `pnpm install`）：

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
</details>

<details>
<summary>设计说明</summary>

- 工具通过 harness 的 `subprocess` 服务启动 CLI：只用 `argv`，绝不经过 shell 解释；采集的输出有上限；按进程树终止；转发中止信号，因此工具超时会杀死整个进程树。
- 四个实时编辑器工具（`unity_status`、`unity_list_commands`、`unity_command`、`unity_eval`）按工作目录共享一个常驻的 `unity shell --protocol ndjson` 会话，把每次调用的延迟从约 600 毫秒的 CLI 启动降到个位数毫秒。同一会话内的请求串行执行；请求进行中发生超时或取消会杀死该会话，下次调用重新拉起；空闲会话在 `shellIdleMs` 后释放。设置 `warmShell: false` 可退回到每次调用一个进程。`unity_cli` 始终按调用启动进程，因为构建与测试耗时长，需要原始输出流。
- 每次调用都带 `--non-interactive`，因此需要交互输入的命令会显式失败，而不会挂起 agent。
- subprocess 服务会从子进程中清除形似凭据的环境变量；CI 的服务账号凭据必须通过 `env` 配置字段显式传入。
- `commandTimeoutMs`、`cliTimeoutMs`、`outputMaxBytes` 必须大于 0。设置卡片会拒绝保存非法值；已存储的非法值会让该命名空间保留上一个有效值。
- 实时编辑器工具以结构化输出返回 CLI 统一的 JSON 信封（`{ success, command, data, errors, warnings }`），因此能与 Code Mode 配合。
- 另一种集成方式：CLI 自带一个 MCP stdio 服务（`unity mcp`）。把 `@deepseek-ai/dsh-mcp-client` 接到它上面无需写代码即可工作，但会失去渲染卡片、配置校验与精心编写的工具描述。本插件正是为提供这些而存在。
- 上游 Unity 技能的拉取与补丁机制见 [assets/UNITY-SKILLS-UPSTREAM.md](assets/UNITY-SKILLS-UPSTREAM.md)。
</details>

## 已知限制

- 编辑器命令集是运行时发现的；本插件不固定也不校验各命令的参数结构。
- `unity_cli` 按设计每次调用都启动一个 CLI 进程；只有四个实时编辑器工具使用常驻会话。
- Asset Store 功能仅支持 Windows 和 macOS。

## 许可证

[MIT](LICENSE)
