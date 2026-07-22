import { EmptyState } from "./page-state";

export function FeaturePlaceholder({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8 lg:py-10">
      <header className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      </header>
      <EmptyState description={description} title={`${title}は準備中です`} />
    </main>
  );
}
