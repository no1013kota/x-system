/**
 * Shared auth-form UI primitives: the standard text-input class string and the
 * field-error message. Extracted from the per-form duplicates so styling changes
 * apply to every auth form (signup / login / password-reset / reset-password).
 */
export const authInputClassName =
  "h-11 w-full rounded-card border border-hairline bg-surface px-3 text-sm outline-none transition-colors duration-150 focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/15";

/** Renders the first field-error message with consistent styling. */
export function FieldError({ errors }: { errors: string[] | undefined }) {
  if (!errors?.length) return null;
  return (
    <p className="text-body text-danger-fg" role="alert">
      {errors[0]}
    </p>
  );
}
