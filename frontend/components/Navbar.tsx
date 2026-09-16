"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AccountPanel } from "./AccountPanel";

function TrustPingMark({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      className={`${className} text-accent`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TrustPing logo"
    >
      <path
        d="M12 2L21 6V12C21 17.52 17.16 21.74 12 23C6.84 21.74 3 17.52 3 12V6L12 2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
      />
      <path
        d="M7 12H9L10.5 8.5L13 15.5L14.5 12H17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="px-4 md:px-6 pt-3">
        <div
          className="mx-auto max-w-7xl rounded-2xl border border-white/10 backdrop-blur-xl transition-all duration-300"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.18 0.01 0 / 0.85) 0%, oklch(0.15 0.01 0 / 0.8) 100%)",
            boxShadow: isScrolled ? "0 16px 40px 0 rgba(0,0,0,0.35)" : "none",
          }}
        >
          <div className="flex items-center justify-between px-4 md:px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <TrustPingMark className="w-7 h-7" />
              <div className="flex flex-col leading-none">
                <span className="text-lg font-bold tracking-tight">
                  Trust<span className="text-accent">Ping</span>
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  SLA escrow for agents
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <a
                href="https://explorer-studio-dev.genlayer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:inline-flex text-xs text-muted-foreground hover:text-accent transition-colors"
              >
                Explorer ↗
              </a>
              <a
                href="https://docs.genlayer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:inline-flex text-xs text-muted-foreground hover:text-accent transition-colors"
              >
                Docs ↗
              </a>
              <AccountPanel />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
