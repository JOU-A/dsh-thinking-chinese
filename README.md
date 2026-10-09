# dsh-thinking-chinese

强制 **DeepSeek Harness（DSH）中所有模型的思考链统一使用简体中文**，而不是英文。

DSH 没有 provider 层面的「思考语言」参数，模型收到什么语言的指令就倾向用什么语言推理，
所以本插件走官方扩展点 `dsh-system-prompt`，把一条中英双语的硬性约束注入每次请求：

| 层 | 注册方式 | 作用 |
|---|---|---|
| 系统提示词 section | `ctx.systemPrompt.section(...)` | 主约束：每个 agent、每个子代理、每个 scope 的每次模型请求都会重新装配并发送 |
| 运行时上下文快照 context | `ctx.systemPrompt.context(...)` | 二次提醒：贴近对话位置，提高对强推理模型的约束力（可用 `reinforce: false` 关闭） |

约束内容只管**思考过程**，不改写最终回答语言（回答语言仍由用户决定），
也只新增提示词内容、不改写任何请求对象，因此不影响会话日志可重建性与 KV cache 复用。

## 安装

**方式一 · GitHub（推荐，需能访问 github.com）：**

```powershell
dsh plugin --profile web add github:JOU-A/dsh-thinking-chinese
# 或固定版本（推荐，仓库打过 tag 之后）
dsh plugin --profile web add github:JOU-A/dsh-thinking-chinese#v1.0.0
```

**方式二 · 本地 tgz 安装包：**

```powershell
dsh plugin --profile web add C:\路径\dsh-thinking-chinese-1.0.0.tgz
```

**方式三 · 本地文件夹（注意：该文件夹此后不可移动/删除）：**

```powershell
dsh plugin --profile web add C:\路径\dsh-thinking-chinese
```

命令会把包装进 profile 的 `node_modules`、写入 `pnpm-lock.yaml`，
并自动把 `dsh-thinking-chinese` 追加到 `dsh.profile.bundles`；
`patchReload: live` 的 profile 会在安装后立即重组生效，无需重启。
本插件零依赖、无构建脚本、未声明 DSH peer，安装不会触发构建批准或版本豁免流程。

## 卸载

```powershell
dsh plugin --profile web remove dsh-thinking-chinese
```

## 配置

安装后自动挂载这一行（`cordis.patch.yml`），可在 profile 的 `cordis.patch.yml`
里按 id 覆盖：

```yaml
- id: thinking-chinese
  config:
    enabled: true              # false = 完全不注册任何约束
    language: 简体中文（Simplified Chinese）   # 约束的思考语言
    reinforce: true            # 是否额外注册贴近对话的上下文提醒
    sectionOrder: 100          # 系统提示词里的位置（人格前缀 0，计划策略 500）
    contextOrder: 100          # 上下文快照里的位置（沙箱 110，审批 115）
    sectionText: 自定义正文     # 覆盖默认正文，%LANGUAGE% 会被替换成 language
    contextText: 自定义提醒
```

停用（不卸载）：

```yaml
- id: thinking-chinese
  disabled: true
```

## 自检

```powershell
node .\selftest.mjs
```

不连模型、不起服务，直接加载插件并模拟一次注册，校验默认文案、语言替换、
`enabled: false` 跳过与未知配置项报错；全部字段应为通过状态。

## 生效验证

```powershell
# 组合后的配置树里应出现 thinking-chinese 行
dsh --profile web --dump-config
```

会话里任意发一句，观察思考面板的语言即可；也可在 Web 侧边栏
**Trajectory → 系统提示词** 中看到 `强制思考语言 / Mandatory Reasoning Language` 一节。

## 已知边界

- 不经过 agent 循环的一次性调用（会话标题、上下文压缩摘要、视觉理解等
  `purpose` 调用）不消费系统提示词装配，本插件覆盖不到；这些调用的思考过程
  用户不可见，也不改变产物语言。
- 提示词约束对绝大多数模型是强引导而非协议级强制：极少数完全忽略系统指令的
  模型仍可能用英文思考，只能改用其上游支持的思考语言参数（若有）。

## License

MIT
