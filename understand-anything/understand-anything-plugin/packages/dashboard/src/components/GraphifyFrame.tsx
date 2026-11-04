/** graphify's own map (graph.html with the explain panel) inside the dashboard. */
import { useLayoutEffect } from "react";
import { useTheme } from "../themes/index.ts";
import { useI18n } from "../contexts/I18nContext";

export default function GraphifyFrame({ accessToken }: { accessToken: string }) {
  const { preset } = useTheme();
  const { t } = useI18n();
  const mode = preset.isDark ? "dark" : "light";
  // Follow the dashboard's Night / Day mode: graph.html reads "graphify-theme" from this
  // origin's storage before it paints, and the key remounts the frame when the mode changes.
  useLayoutEffect(() => {
    try {
      window.localStorage.setItem("graphify-theme", mode);
    } catch {
      // storage unavailable: graph.html keeps its own default
    }
  }, [mode]);
  return (
    <iframe
      key={mode}
      title={t.obsidian.graphify}
      src={`/graphify/graph.html?token=${encodeURIComponent(accessToken)}`}
      className="absolute inset-0 w-full h-full border-0 bg-root"
    />
  );
}
