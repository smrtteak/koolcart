import type { Metadata } from "next";
import Link from "next/link";
import { Caveat, Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { CartProvider } from "@/components/Cart";
import { NavBar, TopBar } from "@/components/NavBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const hand = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Koolcart",
  description: "A small online shop where you can chat with the shopkeeper, make an offer and pay in seconds.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${hand.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="grain" aria-hidden />
        <CartProvider>
          <TopBar />
          <NavBar />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-14 pt-6 sm:px-6">{children}</main>
          <footer className="border-t border-line py-8 text-center text-sm text-muted">
            <span className="font-hand text-xl text-ink">Koolcart</span> · made with care · payments by KoolUPI (demo) ·{" "}
            <Link href="/returns" className="underline decoration-dotted underline-offset-4 hover:text-ink">
              returns &amp; exchanges
            </Link>
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
