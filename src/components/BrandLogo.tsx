import { resolveService } from '../data/logos';
import type { Plan } from '../features/api';

export default function BrandLogo({
  product,
  size = 52,
}: {
  product: Pick<Plan, 'brand_key' | 'name' | 'color_start' | 'color_end' | 'initial'>;
  size?: number;
}) {
  const service = resolveService(product.brand_key, product.name);
  const path = service?.icon?.path;
  const colors = !product.brand_key.trim() && service ? service : product;
  return (
    <span
      className="brand-tile"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        background: `linear-gradient(135deg, ${colors.color_start}, ${colors.color_end})`,
      }}
      title={product.name}
    >
      {path ? (
        <svg
          viewBox="0 0 24 24"
          width={size * 0.55}
          height={size * 0.55}
          fill={service?.logoColor ?? '#fff'}
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
