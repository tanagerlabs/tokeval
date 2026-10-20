import { useEffect, useId, useRef, useState } from "react";
import { PROVIDER_CATALOG } from "../lib/catalog";
import type { TokenizerProfile } from "../lib/tokenizer";
import { ProviderLogo } from "./ProviderLogo";

interface ModelPickerProps {
  profiles: readonly TokenizerProfile[];
  activeModelIds: ReadonlySet<string>;
  onAdd: (modelIds: string[]) => void;
}

export function ModelPicker({
  profiles,
  activeModelIds,
  onAdd,
}: ModelPickerProps) {
  const panelId = useId();
  const headingId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const groupedProfiles = PROVIDER_CATALOG.map((provider) => ({
    ...provider,
    profiles: profiles.filter((profile) => profile.provider === provider.id),
  })).filter((provider) => provider.profiles.length > 0);
  const addableCount = profiles.filter((profile) =>
    !activeModelIds.has(profile.id)
  ).length;

  useEffect(() => {
    setSelectedIds((current) => new Set(
      Array.from(current).filter((id) => !activeModelIds.has(id)),
    ));
  }, [activeModelIds]);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointer(event: globalThis.PointerEvent): void {
      if (
        event.target instanceof Node &&
        !pickerRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function toggleSelection(modelId: string): void {
    if (activeModelIds.has(modelId)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }

  function addSelectedModels(): void {
    const orderedIds = groupedProfiles
      .flatMap((provider) => provider.profiles)
      .filter((profile) => selectedIds.has(profile.id))
      .map((profile) => profile.id);
    if (orderedIds.length === 0) return;
    onAdd(orderedIds);
    setSelectedIds(new Set());
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="model-picker" ref={pickerRef}>
      <button
        className="model-picker__trigger"
        type="button"
        ref={triggerRef}
        aria-controls={panelId}
        aria-expanded={isOpen}
        disabled={addableCount === 0}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span aria-hidden="true">+</span>
        {addableCount === 0 ? "All models added" : "Add models / providers"}
      </button>

      <section
        className="model-catalog"
        id={panelId}
        role="dialog"
        aria-modal="false"
        aria-labelledby={headingId}
        hidden={!isOpen}
      >
        <header className="model-catalog__header">
          <div>
            <h2 id={headingId}>Add models and tokenizers</h2>
            <p>Select any number of models, then add them together.</p>
          </div>
          <button
            className="model-catalog__close"
            type="button"
            aria-label="Close model catalog"
            title="Close"
            onClick={() => setIsOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7.5 7.5 9 9m0-9-9 9" />
            </svg>
          </button>
        </header>

        <div className="model-catalog__grid">
          {groupedProfiles.map((provider) => (
            <section className="model-catalog__provider" key={provider.id}>
              <header>
                <ProviderLogo provider={provider.id} />
                <h3>{provider.name}</h3>
              </header>
              <div className="model-catalog__models">
                {provider.profiles.map((profile) => {
                  const isActive = activeModelIds.has(profile.id);
                  const isSelected = selectedIds.has(profile.id);
                  const isServerDisabled = profile.kind === "hosted" &&
                    "enabled" in profile && profile.enabled === false;
                  const downloadLabel = profile.artifactSizeBytes
                    ? ` · ${(profile.artifactSizeBytes / 1_000_000).toFixed(1)} MB download`
                    : "";
                  return (
                    <label
                      className={`model-catalog__model ${isSelected ? "model-catalog__model--selected" : ""} ${isActive ? "model-catalog__model--active" : ""}`.trim()}
                      key={profile.id}
                    >
                      <input
                        type="checkbox"
                        checked={isActive || isSelected}
                        disabled={isActive}
                        onChange={() => toggleSelection(profile.id)}
                      />
                      <span className="model-catalog__model-copy">
                        <strong>{profile.modelExamples}</strong>
                        <span>
                          {isActive
                            ? "On dashboard"
                            : profile.kind === "hosted"
                              ? isServerDisabled
                                ? "Provider API · server disabled"
                                : "Provider API"
                              : profile.tokenizerId && profile.tokenizerId !== profile.id
                                ? `Shared local tokenizer${downloadLabel}`
                                : `Local tokenizer${downloadLabel}`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className="model-catalog__footer">
          <span aria-live="polite">
            {selectedIds.size === 0
              ? "No new models selected"
              : `${selectedIds.size} ${selectedIds.size === 1 ? "model" : "models"} selected`}
          </span>
          <div>
            <button
              className="model-catalog__clear"
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </button>
            <button
              className="model-catalog__add"
              type="button"
              disabled={selectedIds.size === 0}
              onClick={addSelectedModels}
            >
              Add {selectedIds.size > 0 ? selectedIds.size : "selected"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
