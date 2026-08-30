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
    <div role="group" aria-label="Reasoning effort" style={{ display: "flex", gap: 2 }}>
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
            style={{
              minHeight: 32,
              minWidth: 24,
              padding: "4px 8px",
              fontSize: 12,
              textTransform: "capitalize",
              color: selected ? "var(--law-color-on-accent)" : "var(--law-color-text)",
              background: selected ? "var(--law-color-accent)" : "var(--law-color-bg-input)",
              border: `1px solid ${selected ? "var(--law-color-accent)" : "var(--law-color-border)"}`,
              borderRadius: 5,
              cursor: enabled ? "pointer" : "not-allowed",
              opacity: enabled ? 1 : 0.45,
              textDecoration: enabled ? "none" : "line-through",
            }}
          >
            {level}
          </button>
        );
      })}
    </div>
  );
}
