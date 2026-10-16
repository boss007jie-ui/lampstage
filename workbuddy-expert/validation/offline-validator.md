# 离线发布包校验器

`../validate_expert_release.py` 是实际取证入口：读取明确指定的本地 ZIP、源码和 manifest，再执行已逐字节匹配的包内备用桥握手。它不安装、不修改输入文件、不解包复制到其他目录、不连接线上服务，也不申请或改变权限。

当前受阻的 WorkBuddy 操作不能用本工具重试或换工具绕过。只有目标路径和执行环境已获准时才可运行；任何拒绝立即停止，保留失败状态，由原生安全审计定位规则或通信故障。另一个环境中的成功不证明 WorkBuddy 可以读取或安装。

## 实际入口与纯判定器

| 文件 | 能确认什么 |
| --- | --- |
| [validate_expert_release.py](../validate_expert_release.py) | 在此次实际执行中完成文件取证、比较及本地桥握手，所有必需步骤通过才返回 `verified`。 |
| [fail_closed_evidence.py](fail_closed_evidence.py) | 仅评估调用者交来的合成／结构化证据；不能证明命令执行过。用于隔离回归，不是安装凭证。 |

实际入口依赖同目录树中的 `validation/fail_closed_evidence.py` 获取固定工具名称集合。不要只复制一个入口脚本便声称它可独立运行，也不要改用任意输入 JSON 作为实际验证结果。

## 获准环境中的用法

在本项目仓库根目录运行，Python 需支持当前脚本语法，Node.js 用于本地 stdin 握手。预期摘要来自独立发布记录，不能让命令用刚读出的实际摘要自动填充预期摘要。

```text
python -B workbuddy-expert/validate_expert_release.py --archive workbuddy-expert/releases/lampstage-creative-expert-0.10.1.zip --source workbuddy-expert/lampstage-creative-expert --manifest workbuddy-expert/releases/lampstage-creative-expert-0.10.1.manifest.json --expected-sha256 3622DDB41B55E44F2B26391141E29E6D726F920F2F39B598C536038F50BD85EF --expected-version 0.10.1
```

可用 `--node` 指定已获准的 Node 可执行文件绝对路径；未指定时仅查询现有 PATH。此选项不用于绕过命令拒绝。校验器针对 0.10.1 的冻结连接器及 28 个工具合同；未来版本应先审阅并更新合同，而不是修改预期值把失败变成通过。

成功返回退出码 0 和安全 JSON，其中 `status=verified`、`entry_count=22`、`tool_count=28`。`installed`、`online_verified`、`workbuddy_import_verified` 仍是 false。本地桥不是原生 HTTPS 连接器，不代表线上服务或凭据认证已通过。

失败返回非零退出码和固定原因码，不回显原始异常、命令输出或秘密。没有 stdout、没有标准退出码、进程异常或工具层拒绝都没有成功证据；不能将它们当成空字符串相等、空集合相等或“文件已变化”。外部调用者也必须先检查工具是否成功返回，再检查退出码和完整结果；不能只查看复合命令最后的退出码。

## 校验内容

- 预期和实际 SHA-256 都为 64 位十六进制；ZIP、独立预期值及 manifest 摘要相同。
- manifest 成员数量为明确正整数；实际 ZIP 与全部源码文件集合精确相同，成员路径安全且不重复。源码中的额外缓存或文件也会失败，不静默忽略。
- 每个成员的 CRC、长度、SHA-256 及源码字节相同；损坏、缺失、重复或越界立即失败。
- 原生 `.mcp.json` 与冻结声明摘要相同；manifest 版本、Agent／技能注册路径存在。
- 仅发送 initialize 和 tools/list 两条本地 RPC；无真实凭据环境，版本为 0.10.1，名称集合精确等于 28 个已知工具。UTF-8 解码失败也返回失败。

校验器不执行安装。宿主实际导入、运行与线上能力分别确认；代码、哈希和离线握手均不证明真实视频画面合格。
