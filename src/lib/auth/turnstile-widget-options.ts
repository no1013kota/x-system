export interface TurnstileWidgetVisibilityOptions {
  appearance?: "interaction-only";
}

/** Keeps the widget out of the layout unless Turnstile requires user interaction. */
export function turnstileWidgetVisibilityOptions(
  interactionOnly: boolean,
): TurnstileWidgetVisibilityOptions {
  return interactionOnly ? { appearance: "interaction-only" } : {};
}
