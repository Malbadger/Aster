import React from "react";
import { EFFORT_LEVELS, type EffortLevel } from "@law/contracts";

/**
 * Provider-neutral effort control (DEC-D-006, REQ-D-007, RULE-D-002).
 * Separate from the model selector. Unsupported levels are visibly DISABLED
 * with an explanation — never silently ignored. Status is carried by text and
 * the disabled/pressed state, not color alone (accessibility).
 */
export interface EffortControlProps {
  value: EffortLevel;
  supported: EffortLevel[];
  onChange: (level: EffortLevel) => void;
}

export function EffortControl(props: EffortControlProps): React.JSX.Element {
  const supportedSet = new Set(props.supported);
  return (
    <div className="effort-slider" role="group" aria-label="Reasoning effort">
      <span className="effort-track" aria-hidden />
      {EFFORT_LEVELS.map((level) => {
        const enabled = supportedSet.has(level);
        const selected = props.value === level;
        return (
          <button
            key={level}
            type="button"
            aria-pressed={selected}
            aria-disabled={!enabled}
            disabled={!enabled}
            title={enabled ? `Effort: ${level}` : `"${level}" is not supported by this model (refused, not ignored)`}
            onClick={() => enabled && props.onChange(level)}
            className={`${selected ? "selected " : ""}${enabled ? "enabled" : "unsupported"}`}
          >
            <span aria-hidden />
            <small>{level}</small>
          </button>
        );
      })}
    </div>
  );
}
