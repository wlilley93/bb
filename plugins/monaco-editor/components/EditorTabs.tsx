import { cn } from "@/lib/utils";

export function EditorTabs({
  tabs,
  activePath,
  dirty,
  onActivate,
  onClose,
}: {
  tabs: readonly string[];
  activePath: string;
  dirty: boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-stretch overflow-x-auto bg-surface-recessed">
      {tabs.map((tab) => {
        const name = tabLabel(tab, tabs);
        const selected = tab === activePath;
        return (
          <div
            key={tab}
            className={cn(
              "flex min-w-0 max-w-52 items-center border-r border-border",
              selected
                ? "bg-surface-raised text-foreground"
                : "text-subtle-foreground",
            )}
          >
            <button
              type="button"
              title={tab}
              aria-current={selected ? "page" : undefined}
              onClick={() => onActivate(tab)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 text-left text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              {selected && dirty ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-foreground"
                  aria-hidden
                />
              ) : null}
              <span className="truncate">{name}</span>
            </button>
            {tabs.length > 1 ? (
              <button
                type="button"
                aria-label={`Close ${name}`}
                title={`Close ${name}`}
                onClick={() => onClose(tab)}
                className="mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-recessed focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              >
                <svg viewBox="0 0 24 24" fill="none" className="size-3" aria-hidden>
                  <path
                    d="M18 6L6 18M6 6l12 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function tabLabel(path: string, tabs: readonly string[]): string {
  const name = path.split(/[/\\]/).pop();
  const file = name === undefined || name === "" ? path : name;
  const shared = tabs.some(
    (other) => other !== path && other.split(/[/\\]/).pop() === file,
  );
  if (!shared) return file;
  const parts = path.split(/[/\\]/);
  const parent = parts.length > 1 ? parts[parts.length - 2] : undefined;
  return parent === undefined || parent === "" ? file : `${parent}/${file}`;
}
