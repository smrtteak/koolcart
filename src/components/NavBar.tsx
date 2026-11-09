"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CartButton } from "./Cart";
import { PayPalModeBadge, usePayPalConfig } from "./PayPalCheckout";

const LINKS = [
  { href: "/", label: "Shop" },
  { href: "/returns", label: "Returns" },
  { href: "/seller", label: "Sell" },
];

/** Thin announcement strip above the nav. */
export function TopBar() {
  const config = usePayPalConfig();
  return (
    <div className="border-b border-line bg-[#0c0b0a] text-muted">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs tracking-wide sm:text-[13px]">
        <span className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Checkout with
          <span className="font-bold italic text-foreground">
            Pay<span className="text-[#3a9bdc]">Pal</span>
          </span>
        </span>
        <span className="hidden opacity-50 sm:inline">✳</span>
        <span className="hidden sm:inline">Free returns for 30 days</span>
        <span className="hidden opacity-50 md:inline">✳</span>
        <span className="hidden md:inline">Offers welcome</span>
        {config?.testCard && (
          <>
            <span className="opacity-50">✳</span>
            <span className="text-brand">Demo shop: pay with the test card at checkout, no account needed</span>
          </>
        )}
      </div>
    </div>
  );
}

export function NavBar() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line-strong bg-background/95 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        <Link href="/" className="group flex items-center gap-2">
          <span className="sticker flex h-9 w-9 -rotate-6 items-center justify-center rounded-xl bg-accent font-display text-xl italic transition group-hover:rotate-3">
            k
          </span>
          <span className="font-display text-2xl tracking-tight sm:text-3xl">Koolcart</span>
        </Link>
        <div className="ml-2 hidden gap-1 sm:flex">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  active ? "bg-ink text-paper" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <PayPalModeBadge />
          <CartButton />
        </div>
      </nav>
      <div className="flex gap-1 border-t border-line px-4 py-1.5 sm:hidden">
        {LINKS.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex-1 rounded-full py-1 text-center text-sm ${active ? "bg-ink text-paper" : "text-muted"}`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
