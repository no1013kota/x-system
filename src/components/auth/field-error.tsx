/**
 * Shared auth-form UI primitives: the standard text-input class string and the
 * field-error message. Extracted from the per-form duplicates so styling changes
 * apply to every auth form (signup / login / password-reset / reset-password).
 */
export const authInputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20";

/** Renders the first field-error message with consistent styling. */
export function FieldError({ errors }: { errors: string[] | undefined }) {
  if (!errors?.length) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {errors[0]}
    </p>
  );
}
