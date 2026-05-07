/**
 * Inline spinner — sits next to button text, status badges, etc. Tiny by
 * default; the size scales via the `size` prop. `currentColor` border so
 * it inherits the parent's text color (works in any palette / light/dark).
 */
export default function InlineSpinner({
  size = 12,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
