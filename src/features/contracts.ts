import { z } from 'zod';
import type { Json } from '../types/database';
export type { Json } from '../types/database';

export const roleSchema = z.enum(['owner', 'manager', 'support']);
export type Role = z.infer<typeof roleSchema>;
export const currencySchema = z.enum(['USD', 'ETB']);
export type Currency = z.infer<typeof currencySchema>;
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const categorySchema = z.object({
  id: z.string(), name: z.string(), slug: z.string(),
  sort_order: z.number().int(), archived: z.boolean(),
});
export const planKindSchema = z.enum(['seat', 'topup']);
export type PlanKind = z.infer<typeof planKindSchema>;
export const planSchema = z.object({
  id: z.string(), name: z.string(), slug: z.string(), description: z.string(),
  category_id: z.string().nullable(), category_name: z.string().nullable(),
  brand_key: z.string(), initial: z.string(), color_start: z.string(), color_end: z.string(),
  usd_minor: money.nullable(), etb_minor: money.nullable(),
  usd_compare_minor: money.nullable(), etb_compare_minor: money.nullable(),
  capacity: z.number().int(), allocated: z.number().int(), available: z.number().int().nullable(),
  low_stock_threshold: z.number().int(), billing_days: z.number().int(),
  status: z.enum(['draft', 'active', 'archived']), featured: z.boolean(), updated_at: z.string(),
  kind: planKindSchema,
  // Staff-only; the public catalog response omits the key entirely.
  provider_package_id: z.string().nullable().optional(),
});
export const customerSchema = z.object({
  id: z.string(), name: z.string(), email: z.string(), phone: z.string(),
  telegram: z.string(), created_at: z.string(),
});
export const orderSchema = z.object({
  id: z.string(), reference: z.string(), customer_id: z.string(), customer_name: z.string(),
  phone: z.string(), telegram: z.string(), currency: currencySchema, total_minor: money,
  status: z.enum(['pending', 'paid', 'fulfilled', 'cancelled']),
  payment_status: z.enum(['pending', 'confirmed']), created_at: z.string(), updated_at: z.string(),
});
const eventSchema = z.object({
  id: z.string(), actor_id: z.string().nullable(), action: z.string(), note: z.string(), created_at: z.string(),
});
const itemSchema = z.object({
  id: z.string(), plan_id: z.string(), name: z.string(), description: z.string(),
  qty: z.number().int().positive(), unit_minor: money, billing_days: z.number().int(),
  player_id: z.string().nullable(),
});
export const deliveryStatusSchema = z.enum(['queued', 'processing', 'delivered', 'failed']);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export const deliverySchema = z.object({
  id: z.string(), order_item_id: z.string(), unit_index: z.number().int(),
  player_id: z.string(), package_name: z.string(), status: deliveryStatusSchema,
  delivered_at: z.string().nullable(),
  // Staff-only fields; customers receive the object without these keys.
  package_id: z.string().optional(), provider_order_id: z.string().nullable().optional(),
  attempts: z.number().int().optional(), last_error: z.string().optional(),
});
export type TopupDelivery = z.infer<typeof deliverySchema>;
export const orderDetailSchema = z.object({
  order: orderSchema, items: z.array(itemSchema), events: z.array(eventSchema),
  payment: z.object({
    reference: z.string(), amount_minor: money, currency: currencySchema,
    confirmed_by: z.string(), confirmed_at: z.string(),
  }).nullable(),
  deliveries: z.array(deliverySchema),
});
export const topupPackageSchema = z.object({
  id: z.string(), name: z.string(), cost_points: z.number().nonnegative(),
});
export type TopupPackage = z.infer<typeof topupPackageSchema>;
export const topupProcessSchema = z.object({
  message: z.string(), order_status: z.string(),
  delivered: z.number().int(), failed: z.number().int(), open: z.number().int(),
});
export type TopupProcessResult = z.infer<typeof topupProcessSchema>;
export const allocationSchema = z.object({
  id: z.string(), order_id: z.string(), order_reference: z.string(),
  plan_id: z.string(), plan_name: z.string(), customer_name: z.string(), qty: z.number().int(),
  started_at: z.string(), ends_at: z.string(), released_at: z.string().nullable(),
  release_reason: z.string().nullable(),
});
export const movementSchema = z.object({
  id: z.string(), plan_id: z.string(), plan_name: z.string(), delta: z.number().int(),
  reason: z.string(), created_at: z.string(),
});
export const staffSchema = z.object({
  id: z.string(), name: z.string(), email: z.string(), role: roleSchema,
  active: z.boolean(), invited_at: z.string().nullable(),
});
export const settingsSchema = z.object({
  store_name: z.string(), telegram_url: z.string(), manual_payment_instructions: z.string(),
});
export const activitySchema = z.object({
  id: z.string(), action: z.string(), actor_id: z.string().nullable(),
  entity_id: z.string().nullable(), summary: z.string(), created_at: z.string(),
});
const paginated = <T extends z.ZodType>(row: T) => z.object({
  rows: z.array(row), total: z.number().int(), page: z.number().int(), page_size: z.number().int(),
});
export const resourceSchemas = {
  catalog: z.array(planSchema),
  public_categories: z.array(categorySchema),
  categories: paginated(categorySchema),
  plans: paginated(planSchema),
  inventory: paginated(planSchema),
  orders: paginated(orderSchema),
  my_orders: paginated(orderSchema),
  order: orderDetailSchema,
  customers: paginated(customerSchema),
  customer: z.object({ customer: customerSchema, orders: z.array(orderSchema), notes: z.array(eventSchema) }),
  profile: customerSchema,
  team: paginated(staffSchema),
  allocations: paginated(allocationSchema),
  movements: paginated(movementSchema),
  activity: paginated(activitySchema),
  settings: settingsSchema,
  public_settings: settingsSchema.pick({ store_name: true, telegram_url: true }),
  payment_instructions: settingsSchema.pick({ telegram_url: true, manual_payment_instructions: true }),
  dashboard: z.object({
    pending_orders: z.number().int(), active_plans: z.number().int(),
    available_seats: z.number().int(), low_stock: z.number().int(),
    confirmed_usd_minor: money.nullable(), confirmed_etb_minor: money.nullable(),
    recent_orders: z.array(orderSchema),
  }),
};
export type Resource = keyof typeof resourceSchemas;
export type ResourceData = { [R in Resource]: z.infer<(typeof resourceSchemas)[R]> };
export type Plan = z.infer<typeof planSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Order = z.infer<typeof orderSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type Input = { [key: string]: Json | undefined };
export type Action =
  | 'save_category' | 'save_plan' | 'adjust_capacity' | 'release_allocation'
  | 'create_order' | 'confirm_payment' | 'fulfill_order' | 'cancel_order'
  | 'add_order_note' | 'add_customer_note' | 'save_profile' | 'update_staff' | 'save_settings';

export class DatabaseError extends Error {
  readonly code: string;
  readonly definitive: boolean;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.definitive = code === '23514';
  }
}
