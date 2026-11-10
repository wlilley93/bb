import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const field = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function Page({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
      <header className="flex max-w-2xl flex-col gap-1.5">
        <h1 className="text-lg font-medium tracking-tight text-foreground">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{lede}</p>
      </header>
      {children}
    </div>
  );
}

export function Panel({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {lede ? <p className="text-sm leading-relaxed text-muted-foreground">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function TextField(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={field} />;
}

export function Area({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full rounded-md border border-input bg-transparent p-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className ?? "min-h-40"}`} />;
}

export function Choice(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={field} />;
}

export function Primary(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90" />;
}

export function Quiet(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted" />;
}

export function Note({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">{children}</p>;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>;
}
