import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * One illustration in its two takes: white paper on black (dark theme) and
 * white paper on light paper (`<name>-light.webp`, light theme). Both are
 * rendered; CSS shows the one matching the `.dark` class, and the hidden one
 * is lazy (display:none), so the browser only downloads what's on screen.
 */
export function ThemedArt({ name, sizes, className }: { name: string; sizes: string; className?: string }) {
  return (
    <>
      <Image src={`/art/${name}-light.webp`} alt="" fill sizes={sizes} fetchPriority="high" className={cn("kb-art-light", className)} />
      <Image src={`/art/${name}.webp`} alt="" fill sizes={sizes} fetchPriority="high" className={cn("kb-art-dark", className)} />
    </>
  );
}
