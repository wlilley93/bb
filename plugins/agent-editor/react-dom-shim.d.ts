declare module "react-dom" {
  export function flushSync(callback: () => void): void;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element): Root;
}
