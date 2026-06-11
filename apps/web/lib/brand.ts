/**
 * 全站品牌 + 文案中心。修改文案只在这一处，所有页面 / API / SEO 自动跟随。
 *
 * 设计原则：
 * - 中英两语对照，结构完全一致
 * - 任何要展示给用户的字符串都走 t(key, lang) 这一个入口
 * - 不引入 i18n 包（react-i18next / next-intl 都太重）
 *   ——MVP 双语只需要一份字典 + 一个上下文 hook
 */

export const BRAND = {
  cn: "灯境",
  en: "Lampstage",
  domain: "lampstage.com",
  email: "hello@lampstage.com",
} as const;

export type Lang = "zh" | "en";

export const SUPPORTED_LANGS: Lang[] = ["zh", "en"];

export const DEFAULT_LANG: Lang = "zh";

/**
 * 把浏览器 navigator.language（如 "zh-CN" / "en-US" / "ja-JP"）映射到我们的两语之一。
 * 中文系（zh-*）→ "zh"；其他全部 → "en"。
 */
export function detectLangFromBrowser(navLang: string | undefined): Lang {
  if (!navLang) return DEFAULT_LANG;
  return navLang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * 字典：左侧 key 为代码用的稳定 ID，右侧两语为展示文案。
 * 所有页面只用 key + t(lang, key)。
 */
type Dict = Record<Lang, string>;

const D = {
  // SEO / 元数据
  meta_title: {
    zh: "灯境 · 一张灯具图，生成可直接上架的家居场景图",
    en: "Lampstage · Turn one lamp photo into shelf-ready scene shots.",
  },
  meta_desc: {
    zh: "为灯具卖家快速生成适用于淘宝、天猫、1688、Shopify 和独立站的专业场景图，减少拍摄成本，加快上新速度。",
    en: "AI home-scene photography for lamp sellers on Shopify, Amazon and Tmall. Cut studio costs, ship listings faster.",
  },

  // Nav
  nav_showcase: { zh: "案例", en: "Showcase" },
  nav_product: { zh: "产品", en: "Product" },
  nav_styles: { zh: "风格", en: "Styles" },
  nav_pricing: { zh: "价格", en: "Pricing" },
  nav_login: { zh: "登录", en: "Sign in" },
  nav_my_works: { zh: "我的作品", en: "My works" },
  nav_credits: { zh: "额度", en: "Credits" },
  nav_help: { zh: "帮助", en: "Help" },
  nav_generate: { zh: "生成场景图", en: "Generate scenes" },

  // Hero
  hero_badge: { zh: "AI 灯具电商图工作台", en: "AI scene-photo studio for lamp sellers" },
  hero_title: {
    zh: "一张灯具图，生成可直接上架的家居场景图。",
    en: "Turn one lamp photo into shelf-ready scene shots.",
  },
  hero_subtitle: {
    zh: "为灯具卖家快速生成适用于淘宝、天猫、1688、Shopify 和独立站的专业场景图，减少拍摄成本，加快上新速度。",
    en: "Built for lamp sellers on Shopify, Amazon, Tmall and 1688. Cut studio costs, ship listings faster.",
  },
  hero_cta_primary: { zh: "开始生成场景图", en: "Start generating" },
  hero_cta_secondary: { zh: "查看案例", en: "See examples" },
  hero_meta_speed: { zh: "30–60 秒出图", en: "30–60s per image" },
  hero_meta_count: { zh: "一次 3 张", en: "3 shots per run" },
  hero_meta_styles: { zh: "国内电商 / 独立站双版本", en: "Marketplace + brand-site styles" },

  // Stats
  stat_speed_value: { zh: "30–60s", en: "30–60s" },
  stat_speed_label: { zh: "出图速度", en: "Output speed" },
  stat_count_value: { zh: "3 张", en: "3 shots" },
  stat_count_label: { zh: "一次预览", en: "Per generation" },
  stat_credits_value: { zh: "20 次", en: "20 free" },
  stat_credits_label: { zh: "新用户免费额度", en: "New-user credits" },

  // Showcase strip
  showcase_eyebrow: { zh: "真实生成示例", en: "Real generations" },
  showcase_title: { zh: "上传灯具图，得到这种效果", en: "Upload your lamp, get scenes like these" },
  showcase_cta: { zh: "立即生成自己的 →", en: "Generate yours →" },
  showcase_tag_domestic: { zh: "国内电商版", en: "Marketplace" },
  showcase_tag_brand: { zh: "独立站品牌版", en: "Brand site" },

  // 4 showcase items
  showcase_item_1: { zh: "餐厅长桌吊灯", en: "Dining-room pendant" },
  showcase_item_2: { zh: "卧室床头壁灯", en: "Bedroom wall sconce" },
  showcase_item_3: { zh: "沙发旁落地灯", en: "Living-room floor lamp" },
  showcase_item_4: { zh: "酒店大堂吊灯", en: "Hotel-lobby chandelier" },

  // How it works
  how_title: { zh: "三步生成专业灯具电商图", en: "Three steps to a sellable lamp scene" },
  how_step1_tag: { zh: "01 上传", en: "01 UPLOAD" },
  how_step1_title: { zh: "上传灯具图", en: "Upload the lamp" },
  how_step1_desc: {
    zh: "支持白底图、透明 PNG、普通商品图。",
    en: "White-background, transparent PNG or plain product shot — all welcome.",
  },
  how_step2_tag: { zh: "02 模板", en: "02 TEMPLATE" },
  how_step2_title: { zh: "选择家居模板", en: "Pick a room template" },
  how_step2_desc: {
    zh: "客厅、餐厅、卧室、酒店、展厅。",
    en: "Living, dining, bedroom, hotel and showroom.",
  },
  how_step3_tag: { zh: "03 导出", en: "03 EXPORT" },
  how_step3_title: { zh: "下载电商图", en: "Download & ship" },
  how_step3_desc: {
    zh: "生成 1:1、4:5、16:9 多比例图片。",
    en: "1:1, 4:5 and 16:9 — sized for every storefront.",
  },

  // Styles section
  styles_domestic_title: { zh: "国内电商风格", en: "Marketplace style" },
  styles_domestic_desc: {
    zh: "画面更明亮，产品更突出，适合淘宝、天猫、1688 主图和详情场景。",
    en: "Brighter, sharper, product-forward — built for Tmall, 1688 and Taobao listings.",
  },
  styles_brand_title: { zh: "独立站品牌风格", en: "Brand-site style" },
  styles_brand_desc: {
    zh: "更自然、更高级、更生活方式化，适合 Shopify 和外贸官网展示。",
    en: "Natural, premium and lifestyle — built for Shopify and DTC brand sites.",
  },

  // Footer
  footer_tagline: { zh: "为灯具卖家生成专业电商场景图", en: "AI scene photography for lamp sellers" },

  // Workspace
  ws_title: { zh: "把灯具商品图变成专业家居场景图", en: "Turn your lamp shots into pro home scenes" },
  ws_subtitle: {
    zh: "上传图片，选择空间模板，生成适合淘宝 / 天猫 / 1688 与独立站的电商视觉。",
    en: "Upload, pick a room, render visuals ready for Tmall, 1688, Shopify and beyond.",
  },
  ws_mode_chip: { zh: "国内电商版 / 独立站版", en: "Marketplace / Brand-site" },
  ws_panel_settings: { zh: "生成设置", en: "Settings" },
  ws_panel_preview: { zh: "实时预览", en: "Live preview" },
  ws_step_upload: { zh: "上传灯具商品图", en: "Upload your lamp" },
  ws_upload_hint: { zh: "支持白底图、透明 PNG、普通商品图", en: "White-background, transparent PNG or product shot" },
  ws_upload_max: { zh: "最大 5MB · JPG / PNG / WEBP", en: "Up to 5 MB · JPG / PNG / WEBP" },
  ws_upload_remove: { zh: "移除", en: "Remove" },
  ws_upload_warn: {
    zh: "提示：背景复杂的工厂实拍图效果可能不稳定，建议使用清晰白底图或透明 PNG。",
    en: "Tip: cluttered factory shots may render unstably. White-background or transparent PNG works best.",
  },
  ws_err_format: { zh: "当前仅支持 JPG、PNG、WEBP 图片。", en: "Only JPG, PNG and WEBP are supported." },
  ws_err_size: { zh: "图片超过 5MB 上限，请压缩后再上传。", en: "Image exceeds the 5 MB limit. Please compress and retry." },
  ws_err_template: { zh: "模板加载失败：", en: "Template load failed:" },
  ws_err_loading: { zh: "加载模板中…", en: "Loading templates…" },

  ws_step_template: { zh: "选择家居场景", en: "Pick a room" },
  ws_step_platform: { zh: "选择平台风格", en: "Pick a style" },
  ws_step_aspect: { zh: "选择图片比例", en: "Pick a ratio" },
  ws_platform_domestic: { zh: "国内电商", en: "Marketplace" },
  ws_platform_brand: { zh: "独立站品牌", en: "Brand-site" },
  ws_aspect_1_1: { zh: "1:1 主图", en: "1:1 Square" },
  ws_aspect_4_5: { zh: "4:5 详情", en: "4:5 Portrait" },
  ws_aspect_16_9: { zh: "16:9 横图", en: "16:9 Wide" },

  ws_btn_generate: { zh: "生成 3 张预览图", en: "Generate 3 previews" },
  ws_btn_generate_loginfirst: { zh: "登录后生成 3 张预览图", en: "Sign in to generate 3 previews" },
  ws_btn_generating: { zh: "生成中…", en: "Generating…" },
  ws_cost_hint: { zh: "一次生成 3 张图，消耗 3 次额度", en: "Each run uses 3 credits and outputs 3 images" },

  ws_credits_title_signed: { zh: "本月剩余额度", en: "Credits this month" },
  ws_credits_title_unsigned: { zh: "免费额度（登录后可用）", en: "Free credits (sign in to use)" },
  ws_credits_hint_signed: { zh: "每生成 1 张消耗 1 次", en: "1 credit per image" },
  ws_credits_hint_unsigned: { zh: "登录领取 20 次新人额度", en: "Sign in to claim 20 free credits" },

  ws_preview_disclaimer: {
    zh: "预览仅为示意，真实生成由 Nano Banana 在 Task 8 接入后产出。",
    en: "Preview is illustrative; real generations come online when the model API is wired up.",
  },
  ws_btn_regenerate: { zh: "重新生成", en: "Regenerate" },
  ws_btn_download: { zh: "下载高清图", en: "Download HD" },
  ws_progress_placeholder: { zh: "正在准备生成…", en: "Preparing…" },
  ws_progress_subtext: {
    zh: "Task 8 接入后将显示阶段性进度",
    en: "Stage-by-stage progress lights up when the model API is live",
  },

  ws_alert_dryrun: {
    zh: "已记录生成参数（Task 8 接入 nano banana 后会真正出 4 张图）：",
    en: "Generation params captured (real renders go live once the model API is wired up):",
  },
  ws_welcome_new: {
    zh: "欢迎，已为你发放 {n} 次免费额度",
    en: "Welcome — {n} free credits have been added.",
  },
  ws_welcome_back: {
    zh: "已登录,剩余额度 {n} 次",
    en: "Signed in. {n} credits remaining.",
  },

  // Generation pipeline
  ws_stage_analyzing: { zh: "正在分析灯具结构…", en: "Analyzing lamp structure…" },
  ws_stage_matching: { zh: "正在匹配家居场景…", en: "Matching the room…" },
  ws_stage_generating: { zh: "正在生成家居场景图…", en: "Generating scene shots…" },
  ws_stage_lighting: { zh: "正在优化光影效果…", en: "Refining the lighting…" },
  ws_stage_finalizing: { zh: "正在准备预览图…", en: "Preparing previews…" },
  ws_eta: { zh: "预计 30–60 秒完成", en: "Usually 30–60s" },

  ws_uploading: { zh: "正在上传…", en: "Uploading…" },
  ws_idle_hint: { zh: "等待上传", en: "Waiting for upload" },
  ws_idle_sub: { zh: "上传灯具图，舞台灯光即将为它点亮", en: "Upload a lamp — the stage lights are ready" },
  ws_idle_hint_uploaded: { zh: "已就绪 · 选好场景后点生成", en: "Ready · pick a scene and generate" },
  ws_err_upload_failed: { zh: "上传失败", en: "Upload failed" },
  ws_err_insufficient: {
    zh: "额度不足。一次生成 3 张需 3 次额度。",
    en: "Not enough credits. Each run uses 3.",
  },
  ws_err_generic: { zh: "请求失败", en: "Request failed" },
  ws_failure_label: { zh: "生成失败：", en: "Generation failed: " },
  ws_failure_refunded: { zh: "已退回 4 次额度", en: "4 credits refunded" },

  // Mismatch warning
  ws_mismatch_title: { zh: "灯具类型与模板不匹配", en: "Lamp type mismatch" },
  ws_mismatch_body: {
    zh: "该模板更适合「{template}」，当前上传图看起来是「{detected}」。继续生成可能在比例和安装方式上不稳定。",
    en: "This template was made for {template}, but the uploaded image looks like a {detected}. Generations may be inconsistent.",
  },
  ws_mismatch_continue: { zh: "仍要使用该模板", en: "Use this template anyway" },
  ws_mismatch_change: { zh: "返回换模板", en: "Pick another template" },

  // Login modal
  login_title: { zh: "登录或注册", en: "Sign in or sign up" },
  login_title_signin: { zh: "欢迎回来", en: "Welcome back" },
  login_title_register: { zh: "创建账号", en: "Create your account" },
  login_title_forgot: { zh: "通过邮箱验证码登录", en: "Sign in with email code" },
  login_signin_for: { zh: "登录账号：", en: "Signing in as" },
  login_register_for: { zh: "新账号：", en: "Creating account for" },
  login_desc: {
    zh: "新用户首次登录即送 20 次生成额度，足够生成 5 组场景图。",
    en: "New users get 20 free credits on first sign-in — enough for 5 scene runs.",
  },
  login_label_id: { zh: "邮箱", en: "Email" },
  login_placeholder_id: { zh: "you@example.com", en: "you@example.com" },
  login_btn_continue: { zh: "下一步", en: "Continue" },
  login_btn_checking: { zh: "检查中…", en: "Checking…" },
  login_hint_smart: {
    zh: "新邮箱将引导你创建账号，已注册邮箱直接登录。",
    en: "New emails go to signup, existing ones to sign-in.",
  },

  // Sign in (existing user with password)
  login_label_password: { zh: "密码", en: "Password" },
  login_placeholder_password: { zh: "你的密码", en: "Your password" },
  login_btn_sign_in: { zh: "登录", en: "Sign in" },
  login_btn_signing_in: { zh: "登录中…", en: "Signing in…" },
  login_back_email: { zh: "← 换个邮箱", en: "← Use a different email" },
  login_forgot_password: { zh: "忘记密码？", en: "Forgot password?" },
  login_err_no_password: { zh: "请输入密码", en: "Enter your password." },
  login_err_wrong_password: { zh: "密码错误", en: "Wrong password." },
  login_err_no_account: {
    zh: "该邮箱尚未注册",
    en: "This email isn't registered yet.",
  },

  // Register (new user setting password)
  login_label_set_password: { zh: "设置密码", en: "Set a password" },
  login_placeholder_set_password: {
    zh: "至少 6 位",
    en: "At least 6 characters",
  },
  login_hint_password: {
    zh: "下次登录时使用此密码。",
    en: "You'll use this password to sign in next time.",
  },
  login_btn_send: { zh: "发送验证码", en: "Send code" },
  login_btn_sending: { zh: "发送中…", en: "Sending…" },
  login_btn_register: { zh: "完成注册", en: "Complete sign-up" },
  login_btn_registering: { zh: "注册中…", en: "Creating…" },
  login_err_weak_password: {
    zh: "密码至少 6 位",
    en: "Password must be at least 6 characters.",
  },
  login_err_already_registered: {
    zh: "该邮箱已注册，请直接登录",
    en: "This email is already registered. Sign in instead.",
  },

  // Verification code
  login_label_code: { zh: "6 位验证码", en: "6-digit code" },
  login_sent_to: {
    zh: "已向 {id} 发送验证码，请到邮箱查收（含垃圾邮件）。",
    en: "Code sent to {id}. Check your inbox (and spam).",
  },
  login_dev_code: { zh: "开发环境验证码：", en: "Dev code:" },
  login_btn_verify: { zh: "验证并登录", en: "Verify & sign in" },
  login_btn_verifying: { zh: "验证中…", en: "Verifying…" },
  login_back: { zh: "← 上一步", en: "← Back" },
  login_resend: { zh: "重新发送", en: "Resend" },
  login_resend_in: { zh: "{s}s 后可重发", en: "Resend in {s}s" },

  // Errors (shared)
  login_err_no_id: { zh: "请输入邮箱", en: "Enter an email." },
  login_err_invalid_id: {
    zh: "请输入有效的邮箱地址",
    en: "Enter a valid email address.",
  },
  login_err_rate: {
    zh: "发送过于频繁，请稍后再试",
    en: "Too many requests. Try again in a minute.",
  },
  login_err_send_generic: { zh: "发送失败：", en: "Send failed: " },
  login_err_code_format: {
    zh: "请输入 6 位验证码",
    en: "Enter the 6-digit code.",
  },
  login_err_wrong: { zh: "验证码错误", en: "Wrong code." },
  login_err_expired: {
    zh: "验证码已过期，请重新发送",
    en: "Code expired — request a new one.",
  },
  login_err_no_code: { zh: "尚未发送验证码", en: "Send a code first." },
  login_err_verify_generic: { zh: "验证失败：", en: "Verification failed: " },
  login_err_network: { zh: "网络错误：", en: "Network error: " },
  login_close: { zh: "关闭", en: "Close" },
  login_dev_hint: {
    zh: "开发环境：验证码会输出到服务器控制台和返回体里，方便联调。",
    en: "Dev mode: codes print to the server log and response body for testing.",
  },

  // Cases page
  cases_title: { zh: "案例", en: "Cases" },
  cases_body: {
    zh: "正在筛选优质案例。MVP 阶段的真实灯具场景图样片将在测试用户验证后陆续公开。",
    en: "Curating real generations from beta users. Public showcase coming soon.",
  },
  cases_back: { zh: "返回首页", en: "Back to home" },

  // My works
  my_title: { zh: "我的作品", en: "My works" },
  my_empty: {
    zh: "还没有生成记录。返回工作台上传一张灯具图试试。",
    en: "No generations yet. Head back to the workspace to create your first scene.",
  },
  my_back: { zh: "返回工作台", en: "Back to workspace" },
  my_status_completed: { zh: "已完成", en: "Done" },
  my_status_generating: { zh: "生成中", en: "Generating" },
  my_status_failed: { zh: "失败", en: "Failed" },
  my_btn_download: { zh: "下载", en: "Download" },
  my_input_label: { zh: "原图", en: "Source" },

  // Lang toggle
  lang_toggle_to_en: { zh: "EN", en: "EN" },
  lang_toggle_to_zh: { zh: "中", en: "中" },

  // Credits page
  credits_title: { zh: "额度与套餐", en: "Credits & plans" },
  credits_balance_label: { zh: "当前剩余额度", en: "Credits remaining" },
  credits_balance_unit: { zh: "次", en: "credits" },
  credits_history_title: { zh: "交易记录", en: "History" },
  credits_history_empty: { zh: "暂无交易记录", en: "No transactions yet" },
  credits_tx_grant: { zh: "新用户赠送", en: "New-user grant" },
  credits_tx_consume: { zh: "生成消耗", en: "Generation" },
  credits_tx_refund: { zh: "失败退款", en: "Refund" },
  credits_tx_manual: { zh: "运营调整", en: "Manual adjustment" },

  plans_title: { zh: "联系开通额度包", en: "Contact us for credit packs" },
  plans_subtitle: {
    zh: "MVP 阶段尚未开通在线支付，添加微信或联系客服可立即开通额度。",
    en: "Online payments are coming soon. Reach out and we'll top up your credits within minutes.",
  },
  plan_free_name: { zh: "免费体验", en: "Free trial" },
  plan_free_quota: { zh: "20 次", en: "20 credits" },
  plan_free_desc: {
    zh: "新用户首次登录即送，无需联系。",
    en: "Auto-granted on signup. No contact required.",
  },
  plan_basic_name: { zh: "基础包", en: "Basic" },
  plan_basic_quota: { zh: "100 次", en: "100 credits" },
  plan_basic_desc: {
    zh: "适合个人卖家少量上新。",
    en: "For individual sellers shipping a few SKUs.",
  },
  plan_business_name: { zh: "商业包", en: "Business" },
  plan_business_quota: { zh: "500 次", en: "500 credits" },
  plan_business_desc: {
    zh: "适合店群和小型代运营团队。",
    en: "For multi-store sellers and small agency teams.",
  },
  plan_factory_name: { zh: "工厂定制", en: "Factory custom" },
  plan_factory_quota: { zh: "联系定制", en: "Custom quote" },
  plan_factory_desc: {
    zh: "工厂或代运营批量出图，支持定制 SKU 流水线。",
    en: "Factory-scale batch generation with custom SKU pipelines.",
  },
  plan_btn_contact: { zh: "添加微信开通", en: "Contact via WeChat" },
  plan_btn_active: { zh: "已激活", en: "Active" },

  // Lead capture modal
  lead_title: { zh: "联系开通额度", en: "Contact to top up" },
  lead_subtitle: {
    zh: "留下你的微信或手机号，运营会在 24 小时内主动联系你。",
    en: "Leave your WeChat or phone — we'll reach out within 24 hours.",
  },
  lead_label_name: { zh: "称呼（可选）", en: "Name (optional)" },
  lead_label_wechat: { zh: "微信号", en: "WeChat" },
  lead_label_phone: { zh: "手机号", en: "Phone" },
  lead_label_message: { zh: "需求描述（可选）", en: "Message (optional)" },
  lead_placeholder_message: {
    zh: "例如：我有 50 个灯具 SKU 想批量出图。",
    en: "E.g. I have 50 lamp SKUs and need batch generation.",
  },
  lead_btn_submit: { zh: "提交", en: "Submit" },
  lead_btn_submitting: { zh: "提交中…", en: "Submitting…" },
  lead_err_need_contact: {
    zh: "请至少填写微信号或手机号",
    en: "Please enter WeChat or phone.",
  },
  lead_err_generic: { zh: "提交失败：", en: "Submit failed: " },
  lead_success_title: { zh: "已收到，运营会主动联系你", en: "Got it. We'll reach out shortly." },
  lead_success_body: {
    zh: "你也可以直接添加微信：lampstage（占位，运营请替换）",
    en: "You can also add our WeChat: lampstage (placeholder).",
  },
  lead_success_close: { zh: "好的", en: "OK" },

  // Quota exhausted modal (workspace -> 409)
  quota_title: { zh: "免费额度已用完", en: "Free credits used up" },
  quota_subtitle: {
    zh: "继续生成需要开通额度包。基础包 100 次，商业包 500 次，工厂卖家可定制批量出图。",
    en: "To keep generating, top up. Basic 100 / Business 500 / Factory custom batch.",
  },
  quota_btn_topup: { zh: "去额度页查看套餐", en: "View plans" },
  quota_btn_close: { zh: "稍后再说", en: "Maybe later" },

  // Scene selector tabs
  ws_step_scene: { zh: "选择场景方案", en: "Pick a scene" },
  ws_tab_recommended: { zh: "✨ 智能推荐", en: "✨ Smart picks" },
  ws_tab_template: { zh: "📂 快捷模板", en: "📂 Templates" },
  ws_tab_custom: { zh: "✍️ 自由描述", en: "✍️ Describe" },

  ws_recommend_need_upload: {
    zh: "先上传一张灯具图，系统会针对它推荐 4 个最合适的场景。",
    en: "Upload a lamp first — we'll suggest 4 scenes tailored to it.",
  },
  ws_recommend_uploading: {
    zh: "正在准备上传…",
    en: "Preparing upload…",
  },
  ws_recommend_thinking: {
    zh: "AI 正在分析这盏灯，给出场景建议",
    en: "AI is analyzing your lamp and crafting scene suggestions",
  },
  ws_recommend_thinking_hint: {
    zh: "通常 15–25 秒",
    en: "Usually 15–25 seconds",
  },
  ws_recommend_error: {
    zh: "推荐失败",
    en: "Suggestions failed",
  },
  ws_recommend_retry: { zh: "重试", en: "Retry" },
  ws_recommend_empty: {
    zh: "暂无推荐结果",
    en: "No suggestions yet",
  },

  ws_custom_placeholder: {
    zh: "用一两句话描述你想要的场景。例如：温馨北欧客厅，浅色沙发，落地窗，傍晚柔光。",
    en: "Describe the scene in 1–2 sentences. e.g. Cozy Nordic living room, light sofa, large window, soft evening light.",
  },
  ws_custom_tags_hint: {
    zh: "点击下方标签快速插入风格关键词：",
    en: "Tap a tag to insert it:",
  },

  ws_recommend_thumb_hover: { zh: "悬停预览", en: "Hover to preview" },
  ws_recommend_thumb_loading: { zh: "渲染中…", en: "Rendering…" },

  ws_err_pick_scene: {
    zh: "请先选择一个推荐场景",
    en: "Pick a recommended scene first.",
  },
  ws_err_pick_template: {
    zh: "请先选择一个模板",
    en: "Pick a template first.",
  },
  ws_err_need_prompt: {
    zh: "请先描述你想要的场景",
    en: "Describe the scene first.",
  },
} satisfies Record<string, Dict>;

export type DictKey = keyof typeof D;

export function t(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  const raw = D[key][lang] ?? D[key][DEFAULT_LANG] ?? key;
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    raw,
  );
}
