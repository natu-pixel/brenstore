import type { OptionCode, Plan } from '../features/contracts';

export const streamingOptions = ['1 user', 'On mail'] as const;
export type StreamingOption = typeof streamingOptions[number];
export const optionLabels: Record<OptionCode, StreamingOption> = { single_user: '1 user', on_mail: 'On mail' };
export type PlanGroup = { id: string; name: string; serviceId?: string; plans: Plan[] };
export type PlanChoice = { key: string; label: string; plans: Plan[] };

export function optionSummary(plan: Pick<Plan, 'option_code' | 'users_included'>): string {
  if (!plan.option_code) return '';
  const included = plan.users_included;
  return `${optionLabels[plan.option_code]}${included ? ` · ${included} ${included === 1 ? 'user' : 'users'} per purchase` : ''}`;
}

export function optionChanged(previous: Plan, current: Plan): boolean {
  return (previous.option_code ?? null) !== (current.option_code ?? null)
    || (previous.users_included ?? null) !== (current.users_included ?? null);
}

export function groupPlans(plans: Plan[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const plan of plans) {
    const serviceId = plan.kind === 'seat' && plan.service_id && plan.service_name ? plan.service_id : undefined;
    const id = serviceId ? `service:${serviceId}` : `plan:${plan.id}`;
    const existing = groups.get(id);
    if (existing) existing.plans.push(plan);
    else groups.set(id, { id, name: serviceId ? plan.service_name! : plan.name, serviceId, plans: [plan] });
  }
  return [...groups.values()];
}

export function planChoices(group: PlanGroup): PlanChoice[] {
  if (!group.serviceId) return [];
  const choices: PlanChoice[] = streamingOptions.map(option => ({
    key: option, label: option,
    plans: group.plans.filter(plan => plan.option_code && optionLabels[plan.option_code] === option)
      .sort((a, b) => a.billing_days - b.billing_days || a.id.localeCompare(b.id)),
  }));
  for (const plan of group.plans) {
    if (!plan.option_code) {
      choices.push({ key: plan.id, label: plan.name === group.name ? 'Current plan' : plan.name, plans: [plan] });
    }
  }
  return choices;
}
