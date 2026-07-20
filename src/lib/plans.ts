import { DB_ENUMS } from "./db/enums";

/**
 * Plan definitions (要件03 §2, PRD §6). Prices are 税込 JPY; Stripe Price IDs
 * live in env (要件01 §3.3), not here. Only premium has app-side monthly usage
 * limits (要件03 §7); standard/md run on the user's own API billing.
 * The all-plan daily post safety cap is env-driven (X_DAILY_POST_LIMIT).
 * PlanId is derived from the plan_type DB enum so code and DB never drift.
 */
export type PlanId = (typeof DB_ENUMS.plan_type)[number];

export interface PremiumUsageLimits {
  normalPosts: number;
  urlPosts: number;
  generations: number;
  images: number;
}

export interface PlanDefinition {
  id: PlanId;
  monthlyPriceJpy: number;
  xAccountLimit: number;
  /** null = no app-side monthly limits (BYOK plans). */
  usageLimits: PremiumUsageLimits | null;
  /** md/premium can edit base_md and prompt templates (要件02 §3.5, PRD §5.7). */
  canEditMdAndPrompts: boolean;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  standard: {
    id: "standard",
    monthlyPriceJpy: 500,
    xAccountLimit: 1,
    usageLimits: null,
    canEditMdAndPrompts: false,
  },
  md: {
    id: "md",
    monthlyPriceJpy: 1000,
    xAccountLimit: 3,
    usageLimits: null,
    canEditMdAndPrompts: true,
  },
  premium: {
    id: "premium",
    monthlyPriceJpy: 2980,
    xAccountLimit: 3,
    usageLimits: {
      normalPosts: 200,
      urlPosts: 20,
      generations: 100,
      images: 20,
    },
    canEditMdAndPrompts: true,
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
