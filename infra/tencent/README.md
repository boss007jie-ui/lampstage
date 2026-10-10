# 腾讯云最小生产部署

推荐先在腾讯云广州 `ap-guangzhou`（华南）或上海 `ap-shanghai`（华东）建立一套同地域资源：

1. 创建 VPC `10.0.0.0/16` 和私有子网；CVM、TencentDB for PostgreSQL、COS 放在同地域。
2. 创建 TencentDB for PostgreSQL 高可用实例和 `lampstage` 数据库。关闭公网访问，只允许 Web/Worker 安全组访问 5432。
3. 创建两个 COS 标准私有桶：图片桶和视频桶。图片桶若继续返回公开图片 URL，再单独设置公开读取策略；视频桶保持私有。不要复用两个桶。
4. 创建 CAM 角色/子账号，只授予图片桶必要的 `PutObject/GetObject/DeleteObject/ListBucket`，视频桶只授予 Worker 所需前缀。新 COS 桶使用虚拟主机式访问，所以 `.env.prod` 的 `*_FORCE_PATH_STYLE=false`。
5. 创建 Linux CVM，建议起步 2 vCPU/4 GB、8 GB 系统盘和 50–100 GB 数据盘；视频并发固定为 1。安全组只放行 80/443，22 仅放行你的管理 IP。
6. 在腾讯 SSM/凭据管理中保存数据库 URL、COS 临时凭证、OpenLux、RunningHub account 01 等值。优先给 CVM 绑定 CAM 实例角色，避免在镜像中放长期 SecretId/SecretKey。
7. 把仓库放到 CVM，复制 `.env.prod.example` 为 `.env.prod`，填入真实值；用 `scripts/configure-video-runtime.ts` 生成 account 01 的 Hypit runtime 文件，放进 `runtime/`。
8. 执行 `sudo bash infra/tencent/bootstrap-ubuntu.sh`。首次运行会安装 Docker 并停在模板配置阶段，配置完成后再次运行；脚本会构建 Web/Worker、执行 Prisma migrations，并启动 Caddy、Web 和 Worker。
9. 把 `lampstage.com` 和 `www.lampstage.com` 的 DNS A 记录指向 CVM 公网 IP。Caddy 会自动申请 HTTPS；证书申请前确保 80/443 已放行。

需要设置的关键变量见 [`.env.prod.example`](./.env.prod.example)。Web 和 Worker 必须使用同一个 `DATABASE_URL`、COS 视频桶和数据库迁移版本。`VIDEO_H3_SEGMENT_QUOTE_COINS` 为空时，系统会拒绝付费视频提交；这是预期的安全默认值。

腾讯官方资料：

- [TencentDB for PostgreSQL](https://cloud.tencent.com/product/postgres)
- [COS 对象存储](https://cloud.tencent.com/product/cos)
- [COS S3 兼容 API](https://cloud.tencent.com/document/product/436/37421)
- [COS 私有桶与预签名 URL](https://cloud.tencent.com/document/product/436/68284)
- [CVM Docker 部署](https://intl.cloud.tencent.com/document/product/213/37516?lang=en)
- [腾讯云凭据管理 SSM](https://cloud.tencent.com/document/product/1140/40865)
