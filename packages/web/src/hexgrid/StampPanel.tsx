import { useMemo } from "preact/hooks";
import type { GridSettings } from "./settings";
import { libraryToJson, parseLibrary, stampThumbnail, type StoredStamp } from "./stamp";

/**
 * The collapsible stamp palette: thumbnails in the document's colours, inline
 * rename, place/duplicate/delete and library export/import.
 */
export function StampPanel({
  stamps,
  settings,
  placingId,
  onRename,
  onPlace,
  onEdit,
  onTile,
  onDuplicate,
  onDelete,
  onImport,
  onError,
}: {
  stamps: StoredStamp[];
  settings: GridSettings;
  placingId: string | null;
  onRename: (id: string, name: string) => void;
  onPlace: (stamp: StoredStamp) => void;
  onEdit: ((stamp: StoredStamp) => void) | null;
  onTile: ((stamp: StoredStamp) => void) | null;
  onDuplicate: (stamp: StoredStamp) => void;
  onDelete: (id: string) => void;
  onImport: (stamps: StoredStamp[]) => void;
  onError: (message: string) => void;
}) {
  function exportLibrary() {
    const url = URL.createObjectURL(new Blob([libraryToJson(stamps)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "hex-grid-stamps.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importLibrary(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    file
      .text()
      .then((text) => onImport(parseLibrary(text)))
      .catch((err: unknown) => onError(`Could not import: ${err instanceof Error ? err.message : String(err)}`));
  }

  const sorted = [...stamps].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div class="card stamp-panel">
      <h2>Stamps</h2>
      {sorted.length === 0 && <p class="hint">Select cells and “Save stamp” to fill this palette.</p>}
      {sorted.map((stamp) => (
        <StampCard
          key={stamp.id}
          stamp={stamp}
          settings={settings}
          placing={stamp.id === placingId}
          onRename={onRename}
          onPlace={onPlace}
          onEdit={onEdit}
          onTile={onTile}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}
      <div class="actions">
        <button type="button" onClick={exportLibrary} disabled={stamps.length === 0}>
          Export
        </button>
        <label class="file-button">
          Import
          <input type="file" accept=".json,application/json" onChange={importLibrary} />
        </label>
      </div>
    </div>
  );
}

function StampCard({
  stamp,
  settings,
  placing,
  onRename,
  onPlace,
  onEdit,
  onTile,
  onDuplicate,
  onDelete,
}: {
  stamp: StoredStamp;
  settings: GridSettings;
  placing: boolean;
  onRename: (id: string, name: string) => void;
  onPlace: (stamp: StoredStamp) => void;
  onEdit: ((stamp: StoredStamp) => void) | null;
  onTile: ((stamp: StoredStamp) => void) | null;
  onDuplicate: (stamp: StoredStamp) => void;
  onDelete: (id: string) => void;
}) {
  const thumbnail = useMemo(() => stampThumbnail(stamp.stamp, settings), [stamp.stamp, settings]);
  return (
    <div class={placing ? "stamp-card placing" : "stamp-card"}>
      {/* the SVG string comes from our own generator with escaped attributes */}
      <div class="stamp-thumb" dangerouslySetInnerHTML={{ __html: thumbnail }} />
      <input
        value={stamp.name}
        aria-label="Stamp name"
        onChange={(event) => onRename(stamp.id, event.currentTarget.value)}
      />
      <div class="actions">
        <button type="button" class={placing ? "active" : ""} onClick={() => onPlace(stamp)}>
          {placing ? "Placing…" : "Place"}
        </button>
        {onEdit !== null && (
          <button type="button" onClick={() => onEdit(stamp)}>
            Edit
          </button>
        )}
        {onTile !== null && (
          <button type="button" onClick={() => onTile(stamp)}>
            Tile
          </button>
        )}
        <button type="button" onClick={() => onDuplicate(stamp)}>
          Duplicate
        </button>
        <button type="button" onClick={() => onDelete(stamp.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
