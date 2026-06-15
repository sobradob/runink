import { useState } from 'react';

export type EditorStep = 'Theme' | 'Text' | 'Size';

const STEPS: { id: EditorStep; label: string }[] = [
  { id: 'Theme', label: 'Theme' },
  { id: 'Text', label: 'Text' },
  { id: 'Size', label: 'Size' },
];

interface EditorStepsProps {
  /** Open the matching section (and expand the sheet). */
  onStep: (step: EditorStep) => void;
}

/**
 * Always-visible, always-skippable guided rail for the mobile editor. Presents
 * the three highest-impact edits — Theme → Text → Size — as numbered chips the
 * user can tap in any order. It guides without gating: Export stays available
 * the whole time, so a user can stop after the theme (or skip straight to
 * export) whenever they like. Visited steps get a check so progress is legible.
 */
export function EditorSteps({ onStep }: EditorStepsProps) {
  const [visited, setVisited] = useState<Set<EditorStep>>(new Set());

  const handle = (step: EditorStep) => {
    setVisited((prev) => new Set(prev).add(step));
    onStep(step);
  };

  return (
    <div className="flex items-center gap-2 px-4">
      {STEPS.map((step, i) => {
        const done = visited.has(step.id);
        return (
          <button
            key={step.id}
            onClick={() => handle(step.id)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              done
                ? 'border-white/30 bg-white/10 text-white/80'
                : 'border-white/10 text-white/50 hover:text-white/80 hover:border-white/25'
            }`}
          >
            <span
              className={`flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-medium ${
                done ? 'bg-white text-black' : 'bg-white/15 text-white/60'
              }`}
            >
              {done ? '✓' : i + 1}
            </span>
            {step.label}
          </button>
        );
      })}
    </div>
  );
}
