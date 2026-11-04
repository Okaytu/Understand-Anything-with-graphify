import { useCallback, useEffect, useRef, useState } from "react";
import { FOCUS_RING, HEADER_BUTTON, SEGMENT_GROUP, segment } from "./header-styles";
import { useTheme, PRESETS, presetFor } from "../themes/index.ts";
import type { HeadingFont, ThemePreset } from "../themes/index.ts";

const FAMILY_LABEL: Record<ThemePreset["family"], string> = {
  gold: "Gold",
  ocean: "Ocean",
  forest: "Forest",
  rose: "Rose",
  minimal: "Minimal",
};
import { useI18n } from "../contexts/I18nContext";

export function ThemePicker() {
  const { config, preset, setPreset, setAccent, setHeadingFont } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handlePreset = useCallback(
    (id: string) => {
      setPreset(id as Parameters<typeof setPreset>[0]);
    },
    [setPreset],
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`${HEADER_BUTTON} bg-elevated text-text-secondary hover:text-text-primary`}
        title={t.themePicker.changeTheme}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a7 7 0 0 0 0 14 4 4 0 0 1 0 8 10 10 0 0 0 0-20z" />
          <circle cx="8" cy="10" r="1.5" fill="currentColor" />
          <circle cx="12" cy="7" r="1.5" fill="currentColor" />
          <circle cx="16" cy="10" r="1.5" fill="currentColor" />
        </svg>
        <span className="hidden sm:inline">{t.common.theme}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl glass-heavy shadow-xl z-50 p-4 space-y-4">
          {/* Two modes: Night and Day. Switching keeps the style (Night Gold ↔ Day Gold). */}
          <section>
            <h3 className="mb-2 text-sm font-medium text-text-secondary">{t.themePicker.mode}</h3>
            <div className={`${SEGMENT_GROUP} w-full`}>
              {([true, false] as const).map((dark) => (
                <button
                  key={String(dark)}
                  type="button"
                  aria-pressed={preset.isDark === dark}
                  onClick={() => preset.isDark !== dark && handlePreset(presetFor(preset.family, dark).id)}
                  className={`${segment(preset.isDark === dark)} flex-1 inline-flex items-center justify-center gap-2`}
                >
                  <span aria-hidden>{dark ? "☾" : "☀"}</span>
                  {dark ? t.themePicker.night : t.themePicker.day}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-text-secondary">{t.themePicker.style}</h3>
            <div className="space-y-1">
              {PRESETS.filter((p) => p.isDark === preset.isDark).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePreset(p.id)}
                  aria-pressed={p.id === config.presetId}
                  className={`w-full h-10 flex items-center gap-3 px-3 rounded-lg text-[13px] transition-colors ${FOCUS_RING} ${
                    p.id === config.presetId
                      ? "bg-accent/15 text-accent"
                      : "text-text-secondary hover:text-text-primary hover:bg-elevated"
                  }`}
                >
                  {/* preview: page, panel and the style's accent */}
                  <span className="flex gap-1" aria-hidden>
                    <span className="w-3.5 h-3.5 rounded-full border border-border-medium" style={{ backgroundColor: p.colors.root }} />
                    <span className="w-3.5 h-3.5 rounded-full border border-border-medium" style={{ backgroundColor: p.colors.elevated }} />
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-border-medium"
                      style={{
                        backgroundColor:
                          p.accentSwatches.find((s) => s.id === p.defaultAccentId)?.accent ?? p.accentSwatches[0].accent,
                      }}
                    />
                  </span>
                  <span>{FAMILY_LABEL[p.family]}</span>
                  {p.id === config.presetId && (
                    <svg className="ml-auto w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-text-secondary">{t.themePicker.accentColor}</h3>
            <div className="grid grid-cols-8 gap-2">
              {preset.accentSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  onClick={() => setAccent(swatch.id)}
                  aria-label={swatch.name}
                  aria-pressed={swatch.id === config.accentId}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${FOCUS_RING} ${
                    swatch.id === config.accentId ? "ring-2 ring-text-primary ring-offset-2 ring-offset-root" : ""
                  }`}
                  style={{ backgroundColor: swatch.accent }}
                  title={swatch.name}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-text-secondary">{t.themePicker.headingFont}</h3>
            <div className={`${SEGMENT_GROUP} w-full`}>
              {([
                { id: "serif" as HeadingFont, label: t.themePicker.serif },
                { id: "sans" as HeadingFont, label: t.themePicker.sans },
                { id: "mono" as HeadingFont, label: t.themePicker.mono },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setHeadingFont(opt.id)}
                  aria-pressed={(config.headingFont ?? "serif") === opt.id}
                  className={`${segment((config.headingFont ?? "serif") === opt.id)} flex-1`}
                  style={{
                    fontFamily:
                      opt.id === "serif" ? "var(--font-serif)" : opt.id === "mono" ? "var(--font-mono)" : "var(--font-sans)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
