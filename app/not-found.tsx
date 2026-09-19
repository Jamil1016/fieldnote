import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nothing at this address</h1>
        <p className="mt-2 text-ink-2">The page may have moved, or the record was removed by the nightly demo reset.</p>
        <Link href="/" className="mt-4 inline-block font-semibold text-accent underline underline-offset-2">
          Back to Fieldnote
        </Link>
      </div>
    </main>
  );
}
