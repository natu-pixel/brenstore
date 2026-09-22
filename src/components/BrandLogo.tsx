import { LOGOS } from '../data/logos';
import type { Product } from '../data/products';

/**
 * Brand tile: real logo (white on brand gradient) when available,
 * initial letter otherwise.
 */
export default function BrandLogo({
  product,
  size = 52,
}: {
  product: Product;
  size?: number;
}) {
  const path = LOGOS[product.id];
  return (
    <span
      className="brand-tile"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        background: `linear-gradient(135deg, ${product.tile[0]}, ${product.tile[1]})`,
      }}
      title={product.name}
    >
      {path ? (
        <svg
          viewBox="0 0 24 24"
          width={size * 0.55}
          height={size * 0.55}
          fill="#fff"
          aria-hidden="true"
        >
          <path d={path} />
        </svg>
      ) : (
        product.initial
      )}
    </span>
  );
}
