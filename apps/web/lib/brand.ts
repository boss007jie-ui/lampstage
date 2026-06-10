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
  hero_meta_count: { zh: "一次 4 张", en: "4 shots per run" },
  hero_meta_styles: { zh: "国内电商 / 独立站双版本", en: "Marketplace + brand-site styles" },

  // Stats
  stat_speed_value: { zh: "30–60s", en: "30–60s" },
  stat_speed_label: { zh: "出图速度", en: "Output speed" },
  stat_count_value: { zh: "4 张", en: "4 shots" },
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

  ws_btn_generate: { zh: "生成 4 张预览图", en: "Generate 4 previews" },
  ws_btn_generate_loginfirst: { zh: "登录后生成 4 张预览图", en: "Sign in to generate 4 previews" },
  ws_btn_generating: { zh: "生成中…", en: "Generating…" },
  ws_cost_hint: { zh: "一次生成 4 张图，消耗 4 次额度", en: "Each run uses 4 credits and outputs 4 images" },

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
    zh: "已登录，剩余额度 {n} 次",
    en: "Signed in. {n} credits remaining.",
  },

  // Login modal
  login_title: { zh: "登录领取 20 次免费额度", en: "Sign in for 20 free credits" },
  login_desc: {
    zh: "新用户首次登录即送 20 次生成额度，足够生成 5 组场景图。",
    en: "New users get 20 free credits on first sign-in — enough for 5 scene runs.",
  },
  login_label_id: { zh: "手机号或邮箱", en: "Phone or email" },
  login_placeholder_id: { zh: "138xxxxxxxx 或 you@example.com", en: "you@example.com or +86 138-xxxx-xxxx" },
  login_btn_send: { zh: "发送验证码", en: "Send code" },
  login_btn_sending: { zh: "发送中…", en: "Sending…" },
  login_dev_hint: {
    zh: "开发环境：验证码会输出到服务器控制台和返回体里，方便联调。",
    en: "Dev mode: codes print to the server log and response body for testing.",
  },
  login_label_code: { zh: "6 位验证码", en: "6-digit code" },
  login_sent_to: { zh: "已向 {id} 发送验证码。", en: "Code sent to {id}." },
  login_dev_code: { zh: "开发环境验证码：", en: "Dev code:" },
  login_btn_verify: { zh: "验证并登录", en: "Verify & sign in" },
  login_btn_verifying: { zh: "验证中…", en: "Verifying…" },
  login_back: { zh: "← 修改手机号/邮箱", en: "← Change identifier" },
  login_resend: { zh: "重新发送", en: "Resend" },
  login_resend_in: { zh: "{s}s 后可重发", en: "Resend in {s}s" },
  login_err_no_id: { zh: "请输入手机号或邮箱", en: "Enter a phone or email." },
  login_err_invalid_id: { zh: "请输入有效的手机号（11 位）或邮箱", en: "Enter a valid email or 11-digit Chinese phone." },
  login_err_rate: { zh: "发送过于频繁，请稍后再试", en: "Too many requests. Try again in a minute." },
  login_err_send_generic: { zh: "发送失败：", en: "Send failed: " },
  login_err_code_format: { zh: "请输入 6 位验证码", en: "Enter the 6-digit code." },
  login_err_wrong: { zh: "验证码错误", en: "Wrong code." },
  login_err_expired: { zh: "验证码已过期，请重新发送", en: "Code expired — request a new one." },
  login_err_no_code: { zh: "尚未发送验证码", en: "Send a code first." },
  login_err_verify_generic: { zh: "验证失败：", en: "Verification failed: " },
  login_err_network: { zh: "网络错误：", en: "Network error: " },
  login_close: { zh: "关闭", en: "Close" },

  // Cases page
  cases_title: { zh: "案例", en: "Cases" },
  cases_body: {
    zh: "正在筛选优质案例。MVP 阶段的真实灯具场景图样片将在测试用户验证后陆续公开。",
    en: "Curating real generations from beta users. Public showcase coming soon.",
  },
  cases_back: { zh: "返回首页", en: "Back to home" },

  // Lang toggle
  lang_toggle_to_en: { zh: "EN", en: "EN" },
  lang_toggle_to_zh: { zh: "中", en: "中" },
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
