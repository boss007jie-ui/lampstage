# Lampstage · WorkBuddy Expert API 平台

Lampstage 为 WorkBuddy Creative Expert 提供可复用的素材、图片、视频和电商内容工作流。网站提供注册登录、个人 API Key、账号用量与开发者接入；Expert 负责理解素材、组织任务和审阅结果；后端 API 与持久化 worker 执行任务。

- 网站：[lampstage.com](https://lampstage.com)
- 开发者接入：[/developers](https://lampstage.com/developers)
- 个人密钥：[/account](https://lampstage.com/account)
- WorkBuddy Expert：[0.10.1 安装包](workbuddy-expert/releases/lampstage-creative-expert-0.10.1.zip)、[SHA-256](workbuddy-expert/releases/lampstage-creative-expert-0.10.1.sha256)、[源码](workbuddy-expert/lampstage-creative-expert)

## 本次源码同步

包含多参考图图片任务、固定版本人物库、视频模板与交付、任务关闭和草稿生命周期、账号与充值完整性、会话同步，以及视频起态、实际候选时长和审阅错误诊断修复。Expert 0.10.1 补齐停顿与全局、分段及结束状态的冲突核对。

这是源码发布记录。视频质量修复已通过本地回归，生产部署与真实成片验收按实际环境分别确认。开发中的独立 Agent 内核留在开发工作区。

## 技术栈与目录

- Next.js 14、React、TypeScript、Tailwind CSS。
- Prisma / PostgreSQL；任务数据与视频 worker 使用持久化存储。
- 服务端图片供应商适配器、RunningHub 视频路径及独立媒体处理。
- 腾讯云 Docker Compose / Caddy 部署模板，存储通过环境配置接入。

```text
apps/web/              网站、API、自有业务逻辑、迁移与测试
infra/tencent/         无密钥的部署模板
scripts/               本地控制及相关测试
workbuddy-expert/      Expert 源码、当前发行包与离线校验器
.github/workflows/     GitHub CI
```

## 开发与检查

需要 Node.js 22 和 PostgreSQL。媒体处理需要可用的 FFmpeg。仅在自己控制的开发环境配置数据库和供应商凭据。

```bash
cd apps/web
npm ci
cp ../../.env.example .env.local
# 在本地配置字段中填写所需配置，然后生成 Prisma client。
npm run db:generate
npm run dev
```

运行相关检查：

```bash
npm run typecheck
npm run lint
npm run video:test
npm run build
```

数据库与媒体集成测试使用各自显式开关及隔离资源；默认跳过的项目不代表集成验收已通过。不要将测试指向生产数据库或在验证中自动发起付费生成。

Windows 本地启动见[本地使用说明](本地使用说明.md)。生产模板见 [infra/tencent](infra/tencent/README.md)。原生 Expert 连接器中的凭据通过宿主配置界面输入，密钥、运行配置、用户素材、数据库备份和运维日志不随本仓库分发。

## 第三方组件

第三方组件的使用方式与限制见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Hypit 运行时需单独安装，并受其自定义许可约束；其中包含多租户和商业再分发限制。源代码可取得或本地可运行，都不能替代所需授权。仓库保留现有兼容适配器与上游许可文本，不打包第三方 `node_modules`。
