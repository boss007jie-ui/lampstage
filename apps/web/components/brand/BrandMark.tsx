/**
 * Lampstage 品牌 logo — B3 Stage spotlight。
 *
 * 设计：顶部一个亮点（光源） + 向下展开的暖色光锥（聚光灯）。
 * 双关：lamp 灯具 + stage 舞台聚光，呼应"灯境/Lampstage"。
 *
 * 在浅色 / 深色 navbar 都成立。浅色背景上把光锥做得更结实（不透明度高）+
 * 光源用深色，避免变成"一个小黑点"。
 */
type Props = {
  /** 边长 px。默认 28。 */
  size?: number;
  /** 是否浅色背景上展示。默认 false（深色 navbar）。 */
  onLight?: boolean;
  /** 自定义 className。 */
  className?: string;
};

export function BrandMark({ size = 28, onLight = false, className }: Props) {
  // 给每个尺寸生成唯一渐变 id，避免多个 logo 同页 id 冲突
  const id = `lampstage-spot-${size}-${onLight ? "l" : "d"}`;
  const dotColor = onLight ? "#0e1626" : "#fff5b8";

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
          {onLight ? (
            <>
              <stop offset="0" stopColor="#f3a93b" stopOpacity="1" />
              <stop offset="0.6" stopColor="#f3a93b" stopOpacity="0.55" />
              <stop offset="1" stopColor="#f3a93b" stopOpacity="0.18" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#fff5b8" stopOpacity="0.95" />
              <stop offset="0.6" stopColor="#f3a93b" stopOpacity="0.55" />
              <stop offset="1" stopColor="#f3a93b" stopOpacity="0.05" />
            </>
          )}
        </linearGradient>
      </defs>
      {/* spotlight cone */}
      <path d="M14 8 L7 28 L25 28 L18 8 Z" fill={`url(#${id})`} />
      {/* 浅色背景下加一条细线勾边，避免淡渐变在白底上看不见 */}
      {onLight && (
        <path
          d="M14 8 L7 28 L25 28 L18 8 Z"
          fill="none"
          stroke="#c9852a"
          strokeWidth="0.6"
          strokeOpacity="0.4"
        />
      )}
      {/* light source dot */}
      <circle cx="16" cy="6" r="2.6" fill={dotColor} />
      {/* 浅色背景下额外画一个发光点 */}
      {onLight && (
        <circle cx="16" cy="6" r="3.6" fill="#f3a93b" fillOpacity="0.25" />
      )}
    </svg>
  );
}
