"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/auth/roles";

function isActive(pathname: string, href: string, all: readonly NavItem[]): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  // Prefer the longest matching item, so /approvals/scorecard does not also light up /approvals.
  return !all.some((other) => other.href.length > href.length && (pathname === other.href || pathname.startsWith(`${other.href}/`)));
}

export function TopNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto">
      {items.map((item) => {
        const active = isActive(pathname, item.href, items);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center whitespace-nowrap px-3 text-[0.93rem] font-medium transition-colors ${
              active ? "text-white" : "text-chrome-ink hover:text-white"
            }`}
          >
            {item.label}
            <span aria-hidden className={`absolute inset-x-3 bottom-0 h-0.5 ${active ? "bg-[#4fd1c5]" : "bg-transparent"}`} />
          </Link>
        );
      })}
    </nav>
  );
}
