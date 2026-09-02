import React from "react";
import type { ModelDescriptor } from "@law/contracts";

/**
 * Flat, searchable model selector beside chat (DEC-D-005, REQ-D-006).
 * One flat list — NO provider-grouped navigation. Display name is primary;
 * provider, locality, availability are secondary metadata. Favorites are a
 * local convenience and do not change run identity.
 */
export interface FlatModelSelectorProps {
  models: ModelDescriptor[];
  selectedId?: string;
  favorites: string[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  providerDefaults?: Record<string, string>;
  onSetProviderDefault?: (provider: string, modelId: string) => void;
}

const availabilityLabel: Record<ModelDescriptor["availability"], string> = {
  available: "available",
  unavailable: "unavailable",
  "auth-needed": "sign-in required",
  unknown: "status unknown",
};

export function FlatModelSelector(props: FlatModelSelectorProps): React.JSX.Element {
  const favSet = new Set(props.favorites);
  return (
    <div className="law-model-selector" style={{ display: "flex", flexDirection: "column", minWidth: 260 }}>
      <input
        type="search"
        aria-label="Search models"
        placeholder="Search models…"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
        style={{
          padding: "6px 8px",
          background: "var(--law-color-bg-input)",
          color: "var(--law-color-text)",
          border: "1px solid var(--law-color-border)",
          borderRadius: 5,
          minHeight: 32,
        }}
      />
      <ul role="listbox" aria-label="Models" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, maxHeight: 320, overflowY: "auto" }}>
        {props.models.length === 0 && (
          <li style={{ color: "var(--law-color-text-muted)", padding: "8px" }}>
            No models match. Connect a provider or start a local endpoint in Settings.
          </li>
        )}
        {props.models.map((m) => {
          const selected = m.id === props.selectedId;
          const isFav = favSet.has(m.id);
          const disabled = m.availability === "unavailable";
          const isDefault = props.providerDefaults?.[m.provider] === m.id;
          return (
            <li
              key={m.id}
              role="option"
              aria-selected={selected}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              onClick={() => !disabled && props.onSelect(m.id)}
              onKeyDown={(e) => {
                if (!disabled && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  props.onSelect(m.id);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 5,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                background: selected ? "var(--law-color-bg-elevated)" : "transparent",
                border: selected ? "1px solid var(--law-color-accent)" : "1px solid transparent",
              }}
            >
              <button
                type="button"
                aria-label={isFav ? `Unfavorite ${m.displayName}` : `Favorite ${m.displayName}`}
                aria-pressed={isFav}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onToggleFavorite(m.id, !isFav);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: isFav ? "var(--law-color-accent-strong)" : "var(--law-color-text-faint)",
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                {isFav ? "★" : "☆"}
              </button>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: "var(--law-color-text)" }}>{m.displayName}</span>
                <span style={{ fontSize: 11, color: "var(--law-color-text-muted)" }}>
                  {m.provider} · {m.locality} · {availabilityLabel[m.availability]}
                  {m.secondaryLabel ? ` · ${m.secondaryLabel}` : ""}
                </span>
              </span>
              {props.onSetProviderDefault && <button type="button" className={isDefault ? "model-default active" : "model-default"}
                aria-label={isDefault ? `${m.displayName} is the ${m.provider} default` : `Set ${m.displayName} as ${m.provider} default`}
                disabled={disabled || isDefault} onClick={(event) => { event.stopPropagation(); props.onSetProviderDefault?.(m.provider, m.id); }}>
                {isDefault ? "Default" : "Set default"}
              </button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
