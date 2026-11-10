import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const accent = "#5E6AD2";
const wash = "rgba(94,106,210,0.12)";
export const focusRing = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#5E6AD2]";
const focus = focusRing;
const motion = "motion-safe:duration-150 motion-safe:transition-[color,background-color,border-color,box-shadow,opacity]";
const turn = "motion-safe:duration-150 motion-safe:transition-[rotate]";
const hint = "motion-safe:placeholder:duration-150 motion-safe:placeholder:transition-opacity";
const lift = "color-mix(in oklch, var(--foreground) 28%, var(--border))";
export const stroke = "color-mix(in oklch, var(--foreground) 14%, var(--border))";
export const appear = "motion-safe:duration-150 motion-safe:transition-opacity motion-safe:starting:opacity-0";
const seatTones = ["#4338ca", "#0f766e", "#6d28d9"];
const knownSeatTones: Record<string, string> = {
  "head-agent-ops": "#4338ca",
  "head-operations": "#4338ca",
  "head-records": "#4338ca",
  "head-delivery": "#0f766e",
  "head-engineering": "#6d28d9",
};

function textMask(above: boolean, more: boolean, top: number, bottom: number): string | undefined {
  if (!above && !more) return undefined;
  const topCover = above ? Math.max(8, top) : 0;
  const bottomCover = more ? Math.max(8, bottom) : 0;
  const topClear = topCover > 8 ? topCover - 2 : 0;
  const bottomClear = bottomCover > 8 ? bottomCover - 2 : 0;
  return `linear-gradient(to bottom, transparent 0, transparent ${topClear}px, black ${topCover}px, black calc(100% - ${bottomCover}px), transparent calc(100% - ${bottomClear}px), transparent 100%)`;
}

function edgeCover(node: HTMLElement, edge: "top" | "bottom"): number {
  const style = getComputedStyle(node);
  const line = parseFloat(style.lineHeight);
  if (!Number.isFinite(line) || line <= 0) return 8;
  const first = parseFloat(style.paddingTop) - node.scrollTop;
  if (edge === "bottom") {
    const into = ((node.clientHeight - first) % line + line) % line;
    return into < 1 ? 8 : Math.max(line, into + 8);
  }
  const hidden = first < 0 ? (-first) % line : 0;
  const visible = hidden === 0 ? 0 : line - hidden;
  return visible < 1 ? 8 : Math.max(line, visible + 8);
}

function LineFade({ edge, cover, tone = "muted", offset = 0, soft = false, gutter = 0 }: { edge: "top" | "bottom"; cover: number; tone?: "muted" | "background"; offset?: number; soft?: boolean; gutter?: number }) {
  const solid = soft ? 0 : Math.max(0, cover - 8);
  const place = edge === "bottom" ? "bottom-0" : offset ? "" : "top-0";
  const blend = edge === "bottom" ? "top-0 bg-gradient-to-t" : "bottom-0 bg-gradient-to-b";
  const fill = tone === "background" ? "bg-background" : "bg-muted";
  const from = tone === "background" ? "from-background" : "from-muted";
  const dir = edge === "bottom" ? "top" : "bottom";
  const ink = tone === "background" ? "var(--background)" : "var(--muted)";
  const softFade = cover <= 8
    ? `linear-gradient(to ${dir}, ${ink}, transparent)`
    : `linear-gradient(to ${dir}, ${ink} 0px, ${ink} 8px, transparent 100%)`;
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 z-10 ${place}`} style={{ height: cover, top: offset || undefined, right: gutter || undefined }}>
      {solid > 0 ? <div className={`absolute inset-x-0 ${place} ${fill}`} style={{ height: solid }} /> : null}
      <div className={`absolute inset-x-0 ${soft ? "" : `h-2 ${blend} ${from} to-transparent`}`} style={soft ? { height: cover, backgroundImage: softFade } : undefined} />
    </div>
  );
}

export function seatTone(id: string): string {
  const known = knownSeatTones[id];
  if (known) return known;
  let sum = 0;
  for (const character of id) sum += character.codePointAt(0) ?? 0;
  return seatTones[sum % seatTones.length] ?? seatTones[0];
}

export function Page({ title, lede, children }: { title?: string; lede?: string; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 pb-5">
      {title || lede ? (
        <header className="flex max-w-2xl flex-col gap-1">
          {title ? <h1 className="text-sm font-medium text-foreground">{title}</h1> : null}
          {lede ? <p className="text-sm text-muted-foreground">{lede}</p> : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

export function Panel({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {lede ? <p className="text-sm text-muted-foreground">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border py-2.5 first:border-t-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

const caret = "caret-[#5E6AD2] selection:bg-[#5E6AD2]/30";
const searchField = `h-8 w-full rounded-md border border-x-transparent border-t-transparent border-b-border bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:bg-muted focus:bg-muted ${focus} ${caret} ${motion}`;

export function SearchField({ hint, style, onFocus, onBlur, onKeyDown, ...props }: InputHTMLAttributes<HTMLInputElement> & { hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const hot = over || focused;
  const filled = String(props.value ?? "").length > 0;
  return (
    <div className="relative shrink-0" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <input ref={ref} {...props} type="text" onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); onBlur?.(event); }} onKeyDown={(event) => { if (event.key === "Escape" && !filled) { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } onKeyDown?.(event); }} className={`${searchField} pr-8 ${hint} ${focused && !filled ? "placeholder:opacity-60" : ""}`} style={{ ...style, paddingLeft: "2rem", backgroundColor: "var(--background)", borderColor: hot ? accent : stroke }} />
      <button
        type="button"
        aria-label="Clear search"
        title="Clear"
        tabIndex={filled ? 0 : -1}
        aria-hidden={filled ? undefined : true}
        className={`absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-sm motion-safe:duration-150 motion-safe:transition-[color,background-color,border-color,box-shadow,opacity] ${focus} ${filled ? "cursor-pointer text-foreground" : "pointer-events-none text-muted-foreground opacity-0"}`}
        onMouseEnter={(event) => { event.currentTarget.style.color = accent; }}
        onMouseLeave={(event) => { if (event.currentTarget !== document.activeElement) event.currentTarget.style.color = ""; }}
        onFocus={(event) => { event.currentTarget.style.color = accent; }}
        onBlur={(event) => { event.currentTarget.style.color = ""; }}
        onClick={() => {
          const node = ref.current;
          if (!node) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(node, "");
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.focus();
        }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }}
      >
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 translate-x-0.5">
          <path d="M3 3 9 9M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      </button>
      {hint ? <kbd aria-hidden className={`pointer-events-none absolute top-1/2 right-1.5 flex h-4 -translate-y-1/2 items-center rounded border border-border bg-background px-1 text-2xs text-muted-foreground motion-safe:duration-150 motion-safe:transition-opacity ${filled ? "opacity-0" : focused ? "opacity-60" : ""}`} style={{ borderColor: stroke }}>{hint}</kbd> : null}
    </div>
  );
}

export function TextField({ style, placeholder, onFocus, onBlur, onMouseEnter, onMouseLeave, onKeyDown, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const hot = over || focused;
  const filled = String(props.value ?? "").length > 0;
  return <input {...props} placeholder={placeholder} onMouseEnter={(event) => { setOver(true); onMouseEnter?.(event); }} onMouseLeave={(event) => { setOver(false); onMouseLeave?.(event); }} onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); onBlur?.(event); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } onKeyDown?.(event); }} className={`${searchField} font-mono placeholder:italic ${hint} ${!hot && !filled ? "placeholder:opacity-60" : ""}`} style={{ borderBottomColor: stroke, ...style, ...(hot ? { borderBottomColor: accent } : {}) }} />;
}

export function Area({ className, filled = false, lined = false, inset = false, boxed = false, mono = false, dirty = false, value, style, placeholder, resetKey, onFocus, onBlur, onMouseEnter, onMouseLeave, onKeyDown, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { filled?: boolean; lined?: boolean; inset?: boolean; boxed?: boolean; mono?: boolean; dirty?: boolean; resetKey?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [more, setMore] = useState(false);
  const [above, setAbove] = useState(false);
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const hot = over || focused;
  const [bottomCover, setBottomCover] = useState(8);
  const [topCover, setTopCover] = useState(8);
  const surface = filled
    ? mono
      ? "border-transparent bg-transparent"
      : "border-border bg-muted"
    : boxed
      ? "border-border bg-background"
      : lined
      ? "border-x-transparent border-t-transparent border-b-border bg-transparent hover:bg-muted focus:bg-muted"
      : "border-transparent bg-transparent hover:bg-muted focus:bg-muted";
  const pad = mono ? "h-0 w-full flex-1 px-6 pt-6 pb-6" : boxed ? "h-8 w-full px-3 py-[5px]" : lined && inset ? "w-full min-h-8 px-3 py-[5px]" : lined ? "w-full min-h-8 px-0 py-[5px]" : "w-full px-3 py-2";
  const type = mono ? "relative z-0 resize-none overflow-auto overscroll-contain scroll-pt-6 scroll-pb-6 whitespace-pre-wrap break-words font-mono text-sm leading-6 [tab-size:2]" : `resize-none text-sm ${filled ? "leading-6" : ""}`;
  useEffect(() => {
    const node = ref.current;
    if (!node || mono || boxed) return;
    node.style.height = "auto";
    node.style.height = `${lined ? Math.max(32, node.scrollHeight) : node.scrollHeight}px`;
  }, [boxed, inset, lined, mono, value]);
  useEffect(() => {
    const node = ref.current;
    if (!node || !mono) return;
    const measure = () => {
      const nextMore = node.scrollTop + node.clientHeight < node.scrollHeight - 4;
      const nextAbove = node.scrollTop > 4;
      const nextBottom = edgeCover(node, "bottom");
      const nextTop = edgeCover(node, "top");
      const line = parseFloat(getComputedStyle(node).lineHeight) || 24;
      setMore(nextMore);
      setAbove(nextAbove);
      setBottomCover(nextBottom);
      setTopCover(nextTop);
      node.style.scrollPaddingTop = nextAbove ? `${Math.max(line, nextTop)}px` : "0px";
      node.style.scrollPaddingBottom = nextMore ? `${Math.max(line, nextBottom)}px` : "0px";
    };
    measure();
    node.addEventListener("scroll", measure);
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, [mono, value]);
  const field = (
    <textarea
      {...props}
      key={resetKey}
      ref={ref}
      rows={lined || boxed ? 1 : props.rows}
      value={value}
      placeholder={!hot && !String(value ?? "") && !filled && !inset ? "" : placeholder}
      wrap="soft"
      tabSize={mono ? 2 : props.tabSize}
      spellCheck={mono ? false : props.spellCheck}
      autoCorrect={mono ? "off" : props.autoCorrect}
      autoCapitalize={mono ? "off" : props.autoCapitalize}
      onMouseEnter={(event) => { setOver(true); onMouseEnter?.(event); }}
      onMouseLeave={(event) => { setOver(false); onMouseLeave?.(event); }}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } onKeyDown?.(event); }}
      className={`block ${pad} rounded-md border text-foreground outline-none placeholder:text-muted-foreground placeholder:italic ${mono || filled ? "" : focus} ${caret} ${motion} ${hint} ${!hot && !String(value ?? "") ? (filled || inset ? "placeholder:opacity-60" : "placeholder:opacity-0") : ""} ${type} ${surface} ${mono ? "" : className ?? "min-h-40"}`}
      style={{
        ...style,
        ...(lined && !boxed && !mono && !(dirty || hot) ? { borderBottomColor: stroke } : null),
        ...((dirty || (hot && lined)) && !boxed && !mono ? { borderBottomColor: accent } : null),
        ...(boxed ? { borderColor: dirty || hot ? accent : stroke, height: 32 } : null),
        ...(filled && !mono ? { borderColor: over && !focused ? lift : stroke } : null),
        ...(mono ? { maskImage: textMask(above, more, topCover, bottomCover), WebkitMaskImage: textMask(above, more, topCover, bottomCover) } : null),
      }}
    />
  );
  if (!mono) return filled ? <div className={`flex w-full min-w-0 rounded-md focus-within:ring-1 focus-within:ring-[#5E6AD2] ${motion}`} onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>{field}</div> : field;
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col rounded-md focus-within:ring-1 focus-within:ring-[#5E6AD2] ${motion} ${className ?? ""}`} onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
    <div className={`relative flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-background ${motion}`} style={dirty ? { borderColor: accent } : { borderColor: over && !focused ? lift : stroke }}>
      {field}
    </div>
    </div>
  );
}

export function Choice({ style, onFocus, onBlur, onKeyDown, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const hot = over || focused;
  return (
    <div className="relative" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <select {...props} onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); onBlur?.(event); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } onKeyDown?.(event); }} className={`${searchField} cursor-pointer appearance-none pr-8`} style={{ borderBottomColor: stroke, ...style, ...(hot ? { borderBottomColor: accent } : {}) }} />
      <span className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground ${motion}`} style={hot ? { color: accent } : undefined}><Chevron className="rotate-90" /></span>
    </div>
  );
}

export function Primary({ style, disabled, onMouseEnter, onMouseLeave, onFocus, onBlur, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const hot = over || focused;
  return <button {...props} type="button" disabled={disabled} onMouseEnter={(event) => { setOver(true); onMouseEnter?.(event); }} onMouseLeave={(event) => { setOver(false); setPressed(false); onMouseLeave?.(event); }} onPointerDown={() => { if (!disabled) setPressed(true); }} onPointerUp={() => setPressed(false)} onPointerCancel={() => setPressed(false)} onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); setPressed(false); onBlur?.(event); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }} className={`inline-flex h-8 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-3 text-sm text-white disabled:cursor-default disabled:opacity-40 ${focus} ${motion}`} style={{ ...style, backgroundColor: hot && !disabled && !pressed ? "#707bd8" : accent }} />;
}

export function Quiet({ style, disabled, onMouseEnter, onMouseLeave, onFocus, onBlur, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const hot = (over || focused) && !disabled;
  return <button {...props} type="button" disabled={disabled} onMouseEnter={(event) => { setOver(true); onMouseEnter?.(event); }} onMouseLeave={(event) => { setOver(false); onMouseLeave?.(event); }} onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); onBlur?.(event); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }} className={`inline-flex h-8 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-3 text-sm text-foreground hover:bg-state-hover active:bg-state-active disabled:cursor-default disabled:hover:bg-transparent disabled:active:bg-transparent ${focus} ${motion}`} style={{ ...style, color: disabled ? "color-mix(in oklch, var(--foreground) 60%, transparent)" : hot ? accent : undefined }} />;
}

export function Note({ children }: { children: ReactNode }) {
  return <p role="status" className={`border-l-2 px-3 py-1 text-sm text-foreground ${appear}`} style={{ borderColor: accent }}>{children}</p>;
}

export function ScrollFade({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const [cover, setCover] = useState(8);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      setMore(node.scrollTop + node.clientHeight < node.scrollHeight - 4);
      const box = node.getBoundingClientRect();
      const rows = [...node.querySelectorAll<HTMLElement>("[data-seat], [data-file], button[aria-expanded]")];
      const cut = rows.find((row) => {
        const rowBox = row.getBoundingClientRect();
        return rowBox.top < box.bottom - 1 && rowBox.bottom > box.bottom + 1;
      });
      if (!cut) setCover(8);
      else {
        const visible = box.bottom - cut.getBoundingClientRect().top;
        setCover(visible < 1 ? 8 : visible + 8);
      }
      const edge = box.top + 32;
      const peek = rows.find((row) => {
        const rowBox = row.getBoundingClientRect();
        return rowBox.top > box.top + 1 && rowBox.top < edge - 1 && rowBox.bottom > edge + 1;
      });
      if (!peek) setTop(0);
      else {
        const visible = peek.getBoundingClientRect().bottom - edge;
        setTop(visible < 1 ? 0 : visible + 8);
      }
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    const mutation = new MutationObserver(measure);
    mutation.observe(node, { childList: true, subtree: true });
    node.addEventListener("scroll", measure);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, []);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <nav ref={ref} aria-label={label} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        {children}
      </nav>
      {top > 0 ? <LineFade edge="top" cover={top} tone="muted" offset={32} /> : null}
      {more ? <LineFade edge="bottom" cover={cover} tone="muted" /> : null}
    </div>
  );
}

export function listPage(selector: string) {
  const row = document.querySelector(selector);
  const nav = row?.closest("nav");
  if (!(row instanceof HTMLElement) || !(nav instanceof HTMLElement)) return 1;
  const height = row.getBoundingClientRect().height;
  if (height < 1) return 1;
  return Math.max(1, Math.floor((nav.clientHeight - 32) / height));
}

export function scrollRowIntoList(selector: string) {
  const row = document.querySelector(selector);
  const nav = row?.closest("nav");
  if (!(row instanceof HTMLElement) || !(nav instanceof HTMLElement)) return;
  const rowBox = row.getBoundingClientRect();
  const navBox = nav.getBoundingClientRect();
  const top = navBox.top + 32;
  const bottomFade = [...nav.parentElement?.querySelectorAll(":scope > [aria-hidden]") ?? []].find((node) => node instanceof HTMLElement && node.getBoundingClientRect().width > 40 && node.getBoundingClientRect().bottom >= navBox.bottom - 1);
  const fade = bottomFade instanceof HTMLElement ? bottomFade.getBoundingClientRect().height : 8;
  const floor = navBox.bottom - Math.max(40, fade + 8);
  if (rowBox.top < top - 1) nav.scrollTop += rowBox.top - top;
  else if (rowBox.bottom > floor + 1) nav.scrollTop += rowBox.bottom - floor;
}

export function Chevron({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={`size-3 shrink-0 ${className ?? ""}`}>
      <path d="M4.5 2.5 8 6 4.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GroupHeading({
  open,
  count,
  onToggle,
  tone,
  fade = false,
  children,
}: {
  open: boolean;
  count: number;
  onToggle: () => void;
  tone?: string;
  fade?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tip, setTip] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const hot = over || focused;
  useEffect(() => {
    ref.current?.querySelectorAll("mark").forEach((part) => {
      if (part instanceof HTMLElement) part.style.color = hot ? accent : "";
    });
  });
  return (
    <div className="sticky top-0 z-20 min-w-0 bg-muted">
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      title={tip || undefined}
      onClick={onToggle}
      onMouseEnter={(event) => {
        setOver(true);
        const name = event.currentTarget.querySelector("span.truncate");
        setTip(name instanceof HTMLElement && name.scrollWidth > name.clientWidth + 1 ? (name.textContent ?? "") : "");
      }}
      onMouseLeave={() => setOver(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }}
      className={`flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 px-2 text-left text-xs font-medium text-muted-foreground hover:bg-state-hover active:bg-state-active ${focus} ${motion}`}
    >
      <span className={`inline-flex size-4 shrink-0 items-center justify-center ${open ? "text-foreground" : ""} ${motion}`} style={over || focused ? { color: accent } : open && tone ? { color: tone } : undefined}>
        <Chevron className={`${open ? "rotate-90" : ""} -translate-x-0.5 ${turn}`} />
      </span>
      <span className={`min-w-0 truncate ${open ? `text-foreground ${motion}` : motion} ${over || focused ? "[&_mark]:text-[#5E6AD2]" : ""}`} style={over || focused ? { color: accent } : undefined}>{children}</span>
      <span key={count} className={`ml-auto shrink-0 font-normal tabular-nums text-muted-foreground ${motion} ${fade ? "motion-safe:starting:opacity-0" : ""}`} style={over || focused ? { color: accent } : undefined}>{count}</span>
    </button>
    </div>
  );
}

export function Fold({ title, count, dirty = false, className, compact = false, rule = true, children }: { title: string; count?: number; dirty?: boolean; className?: string; compact?: boolean; rule?: boolean; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tip, setTip] = useState("");
  return (
    <details className={`group min-w-0 ${compact ? "pt-1" : "pt-4"} ${rule ? "border-t border-border" : ""} ${className ?? ""}`} style={rule ? { borderTopColor: stroke } : undefined}>
      <summary title={tip || undefined} onMouseEnter={(event) => { setOver(true); const name = event.currentTarget.querySelector("span.truncate"); setTip(name instanceof HTMLElement && name.scrollWidth > name.clientWidth + 1 ? (name.textContent ?? "") : ""); }} onMouseLeave={() => setOver(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }} className={`flex h-8 cursor-pointer list-none items-center gap-2 rounded-md text-xs font-medium text-muted-foreground hover:bg-state-hover active:bg-state-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#5E6AD2] ${motion} [&::-webkit-details-marker]:hidden ${compact ? "min-w-0 -ml-6 w-[calc(100%+1.5rem)] px-0" : "min-w-0 w-full px-2"}`}>
        <span className={`inline-flex size-4 shrink-0 items-center justify-center group-open:text-foreground ${motion}`} style={over || focused ? { color: accent } : undefined}>
          <Chevron className={`group-open:rotate-90 -translate-x-0.5 ${turn}`} />
        </span>
        <span className={`min-w-0 truncate group-open:text-foreground ${motion}`} style={over || focused ? { color: accent } : undefined}>{title}</span>
        {count != null ? <span className="ml-auto shrink-0 font-normal tabular-nums text-muted-foreground">{count}</span> : null}
        {dirty ? <span aria-label="Unsaved" className={`size-1.5 shrink-0 rounded-full ${appear}`} style={{ background: accent }} /> : null}
      </summary>
      <div className={`@container flex max-w-xl flex-col gap-3 pt-3 ${compact ? "" : "pl-8 pr-2"}`}>{children}</div>
    </details>
  );
}

export const fieldControl = "@[20rem]:ml-[calc(9rem+0.75rem)]";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const hot = over || focused;
  return (
    <label className="grid gap-1 @[20rem]:grid-cols-[9rem_minmax(0,1fr)] @[20rem]:gap-3" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <span className={`text-xs text-muted-foreground @[20rem]:pt-2 @[20rem]:whitespace-nowrap ${motion}`} style={hot ? { color: accent } : undefined}>{label}</span>
      {children}
    </label>
  );
}

export function Hit({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(target);
  if (index < 0) return text;
  while (index >= 0) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark key={index} className="rounded-sm bg-[rgba(94,106,210,0.28)] text-foreground motion-safe:duration-150 motion-safe:transition-[color,background-color] motion-safe:starting:bg-transparent">{text.slice(index, index + target.length)}</mark>);
    cursor = index + target.length;
    index = lower.indexOf(target, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function SeatMark({ id, name }: { id: string; name: string }) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-2xs font-medium leading-none text-white"
      style={{ backgroundColor: seatTone(id) }}
    >
      {letter}
    </span>
  );
}

export function Read({ className, children, resetKey }: { className: string; children: ReactNode; resetKey?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [more, setMore] = useState(false);
  const [above, setAbove] = useState(false);
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [cover, setCover] = useState(8);
  const [topCover, setTopCover] = useState(8);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const nextMore = node.scrollTop + node.clientHeight < node.scrollHeight - 4;
      const nextAbove = node.scrollTop > 4;
      const nextBottom = edgeCover(node, "bottom");
      const nextTop = edgeCover(node, "top");
      const line = parseFloat(getComputedStyle(node).lineHeight) || 24;
      setMore(nextMore);
      setAbove(nextAbove);
      setCover(nextBottom);
      setTopCover(nextTop);
      node.style.scrollPaddingTop = nextAbove ? `${Math.max(line, nextTop)}px` : "0px";
      node.style.scrollPaddingBottom = nextMore ? `${Math.max(line, nextBottom)}px` : "0px";
    };
    measure();
    node.addEventListener("scroll", measure);
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, [children]);
  return (
    <div className={`rounded-md focus-within:ring-1 focus-within:ring-[#5E6AD2] ${motion}`} onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
    <div className={`relative overflow-hidden rounded-md border border-border bg-background ${motion}`} style={{ borderColor: over && !focused ? lift : stroke }}>
      <pre key={resetKey} ref={ref} tabIndex={0} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }} className={`relative z-0 overscroll-contain scroll-pt-6 scroll-pb-6 outline-none ${className}`} style={{ maskImage: textMask(above, more, topCover, cover), WebkitMaskImage: textMask(above, more, topCover, cover) }}>{children}</pre>
    </div>
    </div>
  );
}

export function Pick({
  current = false,
  dirty = false,
  pointed = false,
  mark,
  meta,
  aside,
  title,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { current?: boolean; dirty?: boolean; pointed?: boolean; mark?: ReactNode; meta?: ReactNode; aside?: ReactNode }) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [tip, setTip] = useState("");
  const warm = over || focused;
  const hot = warm || pointed;
  const fill = pressed ? "rgba(94,106,210,0.2)" : warm ? "rgba(94,106,210,0.12)" : "var(--background)";
  const rail = current ? "inset 2px 0 0 #5E6AD2" : "";
  const ring = pointed ? "inset 0 0 0 1px #5E6AD2" : "";
  const boxShadow = [rail, ring].filter(Boolean).join(", ");
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll("mark").forEach((part) => {
      if (part instanceof HTMLElement) part.style.color = warm ? accent : "";
    });
  });
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      aria-pressed={current}
      title={title ?? (tip || undefined)}
      onMouseEnter={(event) => {
        setOver(true);
        const name = event.currentTarget.querySelector("span.truncate");
        setTip(name instanceof HTMLElement && name.scrollWidth > name.clientWidth + 1 ? (name.textContent ?? "") : "");
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => { setOver(false); setPressed(false); props.onMouseLeave?.(event); }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); setPressed(false); props.onBlur?.(event); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } props.onKeyDown?.(event); }}
      className={`flex h-8 w-full cursor-pointer scroll-mt-8 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-state-hover active:bg-state-active ${warm && !current ? "bg-state-hover" : ""} ${focus} ${motion}`}
      style={{
        ...(current ? { backgroundColor: fill } : null),
        ...(boxShadow ? { boxShadow } : null),
      }}
    >
      {mark}
      {meta ? <span className="w-28 shrink-0 truncate text-xs tabular-nums text-muted-foreground">{meta}</span> : null}
      <span className={`flex min-w-0 flex-1 items-baseline ${warm ? "[&_mark]:text-[#5E6AD2]" : ""}`}>
        <span className={`min-w-0 flex-1 truncate ${current ? "font-medium" : ""} ${current || hot ? "text-foreground" : "text-muted-foreground"} ${motion}`}>{children}</span>
        {aside}
      </span>
      {dirty ? <span aria-label="Unsaved" className={`size-1.5 shrink-0 rounded-full ${appear}`} style={{ background: accent }} /> : null}
    </button>
  );
}
