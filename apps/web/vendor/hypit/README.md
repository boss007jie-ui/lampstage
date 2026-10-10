# Website H3 provider root

This directory contains only the generic RunningHub three-image + one-video adapter.
The unchanged source was copied from the user's existing Hypit provider package.
AI App: `2102538614549868545`; submission workflow: `2102537586127491074`.
Its supported request is 4 or 5 seconds, 768P (1.0 MP), portrait 9:16.

The `@hypit/minimax-h3@1` author declaration is supplied by the installed
`@hypit/hypit` 0.2.17 distribution, together with its artifact, markup and media dependencies.
Do not copy credentials, source assets or runtime databases into this directory.

From `apps/web`, run the configuration script with the local tsx executable:

```
npx tsx ../../scripts/configure-video-runtime.ts --path .video-runtime/account01.env.json --env
```

The script is at repository-root `scripts/configure-video-runtime.ts`. It writes a new
profile and a nonsecret `.account.json` companion; it refuses to overwrite existing files.
The alternative locker mode needs an explicitly confirmed account 01 key reference:
`--store platform --key <account01-reference>`, with optional `--service <locker-service>`.
These flags describe references only; never pass a secret value.

Set `VIDEO_HYPIT_RUNTIME` to the generated profile. Environment-store deployments additionally
provide `RUNNINGHUB_API_KEY_01` through their secret manager to the video worker only. Windows locker deployments run as the user who owns that locker.
`VIDEO_HYPIT_PACKAGE_ROOT` overrides this vendored package root when deployed elsewhere.
`VIDEO_HYPIT_CLI` overrides the installed `@hypit/hypit/bin/hypit.mjs` launcher. Otherwise
the runner checks common npm global installation paths for the current operating system/user.

Every job writes its own Source, Run and runtime profile in its assigned workspace. The shared
configuration is a template; execution data lives in the job's `.hypit/execution` directory.
The CLI does check and plan before one detached build. An unknown submission must be reconciled
using `recoverH3Submission(workspace)` or the durable receipt before any operator retry.
No configuration or readiness command submits generation.

After the worker/host restarts, call `resumeH3Worker({ workspace, buildId })` when reconciling
an established unfinished job. Passive status queries do not restart Hypit's execution process.
The helper requires the existing ledger, the isolated profile, and a durable upstream receipt;
it uses `runtime up` only for that existing runtime. Without a checkpointed receipt it returns
`ready: false` for manual reconciliation, because restarting an uncertain submission could replay it.
An already running worker is left running; the helper never invokes `build`.
