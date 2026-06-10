/**
 * Lampstage 品牌 logo — B3 Stage spotlight。
 *
 * 设计：顶部一个亮点（光源） + 向下展开的暖色光锥（聚光灯）。
 * 双关：lamp 灯具 + stage 舞台聚光，呼应"灯境/Lampstage"。
 *
 * 在浅色 / 深色 navbar 都成立：暖橙光锥渐变 + 浅色背景上加细描边可读，
 * 深色背景上自然发光。
 */
type Props = {
  /** 边长 px。默认 28。 */
  size?: number;
  /** 是否浅色背景上展示（影响光源 dot 颜色）。默认 false（深色 navbar）。 */
  onLight?: boolean;
  /** 自定义 className（用于额外阴影 / 边距）。 */
  className?: string;
};

export function BrandMark({ size = 28, onLight = false, className }: Props) {
  // 给每个尺寸生成唯一渐变 id，避免多个 logo 同页 id 冲突
  const id = `lampstage-spot-${size}-${onLight ? "l" : "d"}`;
  const dotColor = onLight ? "#0e1626" : "#fff5b8";
  const coneTop = onLight ? "#f3a93b" : "#fff5b8";
  const coneOpacityTop = onLight ? 0.95 : 0.85;
  const coneOpacityBot = 0.05;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0"
            stopColor={coneTop}
            stopOpacity={coneOpacityTop}
          />
          <stop offset="1" stopColor="#f3a93b" stopOpacity={coneOpacityBot} />
        </linearGradient>
      </defs>
      {/* spotlight cone */}
      <path
        d="M14 8 L7 28 L25 28 L18 8 Z"
        fill={`url(#${id})`}
      />
      {/* light source dot */}
      <circle cx="16" cy="6" r="2.4" fill={dotColor} />
    </svg>
  );
}
