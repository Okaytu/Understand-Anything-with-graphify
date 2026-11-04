import { useDashboardStore } from "../store";
import { HEADER_BUTTON } from "./header-styles";
import { useI18n } from "../contexts/I18nContext";

export default function DiffToggle() {
  const diffMode = useDashboardStore((s) => s.diffMode);
  const toggleDiffMode = useDashboardStore((s) => s.toggleDiffMode);
  const changedNodeIds = useDashboardStore((s) => s.changedNodeIds);
  const affectedNodeIds = useDashboardStore((s) => s.affectedNodeIds);
  const { t } = useI18n();

  const hasDiff = changedNodeIds.size > 0;
  // nothing to compare against: hide the switch instead of showing a dead "Diff OFF"
  if (!hasDiff) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleDiffMode}
        disabled={!hasDiff}
        className={`${HEADER_BUTTON} ${
          diffMode && hasDiff
            ? "bg-[var(--color-diff-changed-dim)] text-[var(--color-diff-changed)]"
            : hasDiff
              ? "bg-elevated text-text-secondary hover:bg-surface"
              : "bg-elevated text-text-muted cursor-not-allowed"
        }`}
        title={
          hasDiff
            ? diffMode
              ? t.diffToggle.hideOverlay
              : t.diffToggle.showOverlay
            : t.diffToggle.noData
        }
      >
        Diff {diffMode && hasDiff ? "ON" : "OFF"}
      </button>

      {diffMode && hasDiff && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-diff-changed)" }}
            />
            <span className="text-text-secondary text-[11px]">
              {t.diffToggle.changed}
              <span className="text-text-muted ml-0.5">
                ({changedNodeIds.size})
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-diff-affected)" }}
            />
            <span className="text-text-secondary text-[11px]">
              {t.diffToggle.affected}
              <span className="text-text-muted ml-0.5">
                ({affectedNodeIds.size})
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
