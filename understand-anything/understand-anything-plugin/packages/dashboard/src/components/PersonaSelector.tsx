import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import type { Persona } from "../store";
import { SEGMENT_GROUP, segment } from "./header-styles";

export default function PersonaSelector() {
  const persona = useDashboardStore((s) => s.persona);
  const setPersona = useDashboardStore((s) => s.setPersona);
  const hasTour = useDashboardStore((s) => (s.graph?.tour.length ?? 0) > 0);
  const startTour = useDashboardStore((s) => s.startTour);
  const { t } = useI18n();

  const personas: { id: Persona; label: string; description: string }[] = [
    {
      id: "non-technical",
      label: t.personaSelector.overview,
      description: t.personaSelector.overviewDesc,
    },
    {
      id: "junior",
      label: t.personaSelector.learn,
      description: t.personaSelector.learnDesc,
    },
    {
      id: "experienced",
      label: t.personaSelector.deepDive,
      description: t.personaSelector.deepDiveDesc,
    },
  ];

  return (
    <div className={SEGMENT_GROUP}>
      {personas.map((p) => (
        <button
          key={p.id}
          onClick={() => {
            setPersona(p.id);
            // "Guided" means the guided tour: start it in the sidebar
            if (p.id === "junior" && hasTour) startTour();
          }}
          title={p.description}
          className={segment(persona === p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
