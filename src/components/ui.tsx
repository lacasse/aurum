"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  useEffect,
  useId,
} from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ---------------- Card ---------------- */

export function Card({
  className,
  children,
  id,
}: {
  className?: string;
  children: ReactNode;
  /** For linking straight to a card, as the guide's sections do. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ---------------- Button ---------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "icon";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "icon" && "h-8 w-8",
        variant === "primary" &&
          "bg-brand-strong text-white hover:bg-brand dark:text-zinc-950",
        variant === "secondary" &&
          "border border-line bg-elevated text-ink hover:border-brand/50",
        variant === "ghost" && "text-ink-dim hover:bg-elevated hover:text-ink",
        variant === "danger" &&
          "bg-negative/10 text-negative hover:bg-negative/20",
        className,
      )}
      {...props}
    />
  );
}

/* ---------------- Inputs ---------------- */

export function Field({
  label,
  children,
  hint,
}: {
  label?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1.5 block text-xs font-medium text-ink-dim">
          {label}
        </span>
      ) : null}
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  "w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, "appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}

/* ---------------- Badge ---------------- */

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "positive" | "negative" | "brand";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-elevated text-ink-dim",
        tone === "positive" && "bg-positive/10 text-positive",
        tone === "negative" && "bg-negative/10 text-negative",
        tone === "brand" && "bg-brand/10 text-brand",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------- Progress ---------------- */

export function Progress({
  value,
  max,
  tone,
  className,
}: {
  value: number;
  max: number;
  tone?: "auto" | "positive" | "negative";
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color =
    tone === "positive"
      ? "bg-positive"
      : tone === "negative"
        ? "bg-negative"
        : pct >= 100
          ? "bg-negative"
          : pct >= 80
            ? "bg-amber-500"
            : "bg-brand-strong";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-elevated", className)}>
      <div
        className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * How much room the contents need. A form of stacked fields is fine at
   * `md`; a table of numbers is not, and squeezing one into a narrow dialog
   * only moves the problem into a horizontal scrollbar the reader has to find.
   */
  size?: "md" | "lg" | "xl" | "2xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "animate-fade-up w-full rounded-2xl border border-line bg-surface shadow-2xl",
          size === "2xl"
            ? "max-w-6xl"
            : size === "xl"
              ? "max-w-3xl"
              : size === "lg"
                ? "max-w-xl"
                : "max-w-md",
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Empty state ---------------- */

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon ? <div className="text-ink-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-ink-dim">{title}</p>
      {subtitle ? <p className="text-xs text-ink-faint">{subtitle}</p> : null}
    </div>
  );
}

/* ---------------- Segmented control ---------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div className="inline-flex rounded-lg border border-line bg-elevated p-0.5">
      {options.map((opt) => (
        <button
          key={`${id}-${opt.value}`}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === opt.value
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-faint hover:text-ink-dim",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
