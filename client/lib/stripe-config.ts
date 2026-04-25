import Stripe from "stripe"

/**
 * Centralized Stripe Configuration
 * 
 * Provides a single source of truth for Stripe SDK settings.
 * The apiVersion is cast to Stripe.StripeConfig['apiVersion'] to maintain
 * type safety while using specific API versions.
 */
export const stripeConfig: Stripe.StripeConfig = {
  apiVersion: "2025-11-17.clover" as Stripe.StripeConfig["apiVersion"],
  typescript: true,
}

/**
 * Initialize a Stripe instance with standard configuration
 */
export const getStripeInstance = (apiKey?: string) => {
  const key = apiKey || process.env.STRIPE_SECRET_KEY
  if (!key) return null
  
  return new Stripe(key, stripeConfig)
}
