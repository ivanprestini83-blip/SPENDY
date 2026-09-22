// Single source of truth for the app's official identity — Header and
// SpendyCoach both read from here instead of hardcoding the strings
// twice, so there is only ever one place that could introduce a second,
// inconsistent name.
export const APP_NAME = 'SPENDY'
export const APP_TAGLINE = 'Know Your Money'
export const MASCOT_NAME = 'Spendy'
