import type { MenuItem } from "./xmb";
import type { PopupOption, InfoRow } from "./popups";
import type { MemoryCard, CardSave, EmulatorCards, PatchMatch, MatchedCode, ApolloSelection, BackupInfo, CommunitySave, VolumeInfo, ImportCandidate } from "./types";

/**
 * The Memory Card Utility, inside the Game column: virtual PS and PS2 cards the
 * emulators mount, the saves on them, importing and exporting.
 *
 * The column holds cards and saves only. Everything you do to a save - Apollo's
 * cheats, the community save database, the backups every edit leaves, sending a
 * copy to the phone - lives in the Y (triangle) sidebar on the save's row:
 *
 *   Memory Card → Game Save → [Y] → Edit Save → Apollo Cheats
 *
 * Cheats toggle in place in that list; the last rows are "[ Preview Changes ]"
 * and "[ Apply Selected ]".
 */

export interface UtilityDeps {
  refresh: () => void;
  enterLevel: (key: string) => void;
  resetSelection: () => void;
  showOptions: (title: string, options: PopupOption[]) => void;
  showInfo: (title: string, art: string | undefined, rows: InfoRow[]) => void;
  askText: (title: string, fields: { label: string; value?: string }[]) => Promise<string[] | null>;
  /** The centred PS3-style chooser. */
  pickScreen: (title: string, choices: { id: string; label: string; note?: string }[]) => Promise<{ id: string; label: string } | null>;
  notify: (text: string, iconUrl?: string) => void;
  volumes: () => VolumeInfo[];
  /** Sends a copy of the save to paired phones (the companion's offline copy). */
  sendToPhone: (cardId: string, save: string) => Promise<void>;
  phoneConnected: () => boolean;
}

type View = "root" | "card" | "import" | "emulators";

const ICON = {
  utility: "assets/icons/memcard-utility.webp",
  newCard: "assets/icons/memcard-new.webp",
  ps1: (slot: number) => `assets/icons/memcard-ps1-${slot}.webp`,
  ps2: (slot: number) => `assets/icons/memcard-ps2-${slot}.webp`,
  save: "assets/icons/folder.png",
};

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Settings › System › Apollo Save Tool, and the utility's own Apollo Database row. */
export function showApolloDatabaseOptions(deps: Pick<UtilityDeps, "showOptions" | "notify" | "volumes">): void {
  void window.axm.apolloStatus().then((st) => {
    const counts = Object.entries(st.patchCounts).map(([p, n]) => `${p} ${n}`).join(" · ");
    deps.showOptions("Apollo Database", [
      { label: "Update Apollo Patch Database", hint: st.patchesUpdatedAt ? `last ${when(st.patchesUpdatedAt)} · ${counts}` : "never fetched", run: async () => { const r = await window.axm.apolloUpdatePatches(); deps.notify(`Patch database: ${r.message}`, ICON.utility); } },
      { label: "Update Apollo Save Database", hint: st.savesUpdatedAt ? `last ${when(st.savesUpdatedAt)} · ${Object.entries(st.saveTitleCounts).map(([p, n]) => `${p} ${n}`).join(" · ")}` : "never fetched", run: async () => { const r = await window.axm.apolloUpdateSaves(); deps.notify(`Save database: ${r.message}`, ICON.utility); } },
      { label: "Last database update", hint: `patches ${st.patchesUpdatedAt ? when(st.patchesUpdatedAt) : "never"} · saves ${st.savesUpdatedAt ? when(st.savesUpdatedAt) : "never"}` },
      { label: `Auto-update: ${st.autoUpdate ? "weekly" : "off"}`, run: async () => { await window.axm.setSettings({ apollo: { autoUpdate: !st.autoUpdate, offline: st.offline, location: st.location } }); } },
      { label: `Offline mode: ${st.offline ? "on" : "off"}`, hint: "on: nothing is fetched, only what's already here is used", run: async () => { await window.axm.setSettings({ apollo: { autoUpdate: st.autoUpdate, offline: !st.offline, location: st.location } }); } },
      { label: "Database location", hint: `${st.location} · ${fmt(st.cacheBytes)}`, children: deps.volumes().filter((v) => !v.system).map((v) => ({ label: `${v.label} (${v.drive})`, hint: `${v.drive}\\A-X-M\\apollo`, run: async () => { await window.axm.apolloSetLocation(`${v.drive}\\A-X-M\\apollo`); deps.notify("Apollo database moved"); } })).concat([{ label: "This PC (default)", hint: "in A-X-M's own data folder", run: async () => { await window.axm.apolloSetLocation(""); } }]) },
      { label: "Open the custom patch folder", hint: "your own .savepatch files, by platform", run: () => { void window.axm.openFolder(`${st.location}\\custom`); } },
      { label: "Clear cache", hint: "downloaded databases and saves; your custom folder and backups stay", children: [{ label: "Yes, clear it", run: async () => { await window.axm.apolloClearCache(); deps.notify("Apollo cache cleared"); } }, { label: "No" }] },
    ]);
  });
}

export class MemoryCardUtility {
  private view: View = "root";
  private managed: MemoryCard[] = [];
  private emulators: EmulatorCards[] = [];
  private card: MemoryCard | null = null;
  private saves: CardSave[] = [];
  private usage: { usedBlocks: number; totalBlocks: number } | null = null;
  /** Apollo's answer for the save whose sidebar is open, and what's ticked in it. */
  private cheatsFor: { save: string; match: PatchMatch | null; error: string } | null = null;
  private selection = new Map<string, ApolloSelection>();
  private candidates: { ps1: ImportCandidate[]; ps2: ImportCandidate[] } | null = null;
  private apolloNote = "";

  constructor(private deps: UtilityDeps) {
    window.axm.onApolloProgress(({ note }) => {
      this.apolloNote = note;
      deps.refresh();
    });
    // The phone edited or restored a save: what's on screen follows.
    window.axm.onMemcardsChanged(({ cardId }) => {
      if (this.card?.id === cardId) void window.axm.memcardSaves(cardId).then((r) => { this.saves = r.saves; this.usage = r.usage; this.cheatsFor = null; deps.refresh(); });
    });
  }

  // ------------------------------------------------------------ nav ----

  async open(): Promise<void> {
    await this.reload();
    this.go("root");
  }

  private go(view: View): void {
    this.view = view;
    this.deps.enterLevel(`memcards:${view}:${this.card?.id ?? ""}`);
    this.deps.resetSelection();
    this.deps.refresh();
  }

  private async reload(): Promise<void> {
    const o = await window.axm.memcardOverview();
    this.managed = o.managed;
    this.emulators = o.emulators;
    if (this.card) this.card = this.managed.find((c) => c.id === this.card!.id) ?? null;
  }

  private async reloadSaves(): Promise<void> {
    if (!this.card) return;
    window.axm.memcardsChanged();
    const r = await window.axm.memcardSaves(this.card.id);
    this.saves = r.saves;
    this.usage = r.usage;
    this.cheatsFor = null;
  }

  /** B: up one level; false when already at the root (the column takes it). */
  back(): boolean {
    switch (this.view) {
      case "root": return false;
      case "card": this.card = null; this.go("root"); return true;
      case "import": case "emulators": this.go(this.card ? "card" : "root"); return true;
    }
  }

  hint(): string {
    const card = this.card ? ` › ${this.card.name}` : "";
    switch (this.view) {
      case "root": return "Memory Card Utility";
      case "card": return `Memory Card Utility${card}${this.usage ? ` · ${this.usage.usedBlocks} of ${this.usage.totalBlocks} ${this.card?.kind === "ps1" ? "blocks" : "KB"} used` : ""} · Y on a save: edit, cheats, backups`;
      case "import": return "Memory Card Utility › Import Saves";
      case "emulators": return "Memory Card Utility › Emulators";
    }
  }

  items(): MenuItem[] {
    switch (this.view) {
      case "root": return this.rootItems();
      case "card": return this.cardItems();
      case "import": return this.importItems();
      case "emulators": return this.emulatorItems();
    }
  }

  // ----------------------------------------------------------- root ----

  private cardIcon(c: MemoryCard): string {
    return c.kind === "ps1" ? ICON.ps1(c.slot) : ICON.ps2(c.slot);
  }

  private rootItems(): MenuItem[] {
    const cards = this.managed.map((c): MenuItem => ({
      id: `mc-${c.id}`,
      title: c.name,
      subtitle: `${c.kind === "ps1" ? "PlayStation" : "PlayStation 2"} card · slot ${c.slot} · ${fmt(c.sizeBytes)}`,
      iconUrl: this.cardIcon(c),
      iconClass: "memcard",
      contextHint: "card options",
      onConfirm: async () => { this.card = c; await this.reloadSaves(); this.go("card"); },
      onContext: () => { this.cardOptions(c); return true; },
    }));
    const found = this.emulators.filter((e) => e.installPath);
    return [
      // "Create" first, as the PS3's Memory Card Utility has it; the kind is chosen on the next screen.
      { id: "mc-new", title: "New PlayStation Memory Card", subtitle: "Create an internal memory card (PS2 or PS)", iconUrl: ICON.newCard, iconClass: "memcard", onConfirm: () => this.createCardFlow() },
      ...cards,
      { id: "mc-import", title: "Import Saves", subtitle: "Cards and saves on your drives: raw, DexDrive, .psu, .psv", iconUrl: ICON.utility, iconClass: "memcard", onConfirm: async () => { this.candidates = null; this.go("import"); void this.scanDrives(); } },
      { id: "mc-emulators", title: "Emulators", subtitle: found.length ? found.map((e) => e.name).join(", ") : "DuckStation and PCSX2 · not found yet", iconUrl: ICON.utility, iconClass: "memcard", onConfirm: () => this.go("emulators") },
      { id: "mc-apollo", title: "Apollo Database", subtitle: this.apolloNote || "Cheats and community saves · also in Settings › System › Apollo Save Tool", iconUrl: ICON.utility, iconClass: "memcard", onConfirm: () => showApolloDatabaseOptions(this.deps) },
      { id: "mc-about", title: "About & Thanks", subtitle: "Apollo Save Tool, bucanero, and everyone whose work this stands on", iconUrl: ICON.utility, iconClass: "memcard", onConfirm: () => this.about() },
    ];
  }

  /** The PS3's own screen: "Select the internal memory card to be created." */
  private async createCardFlow(): Promise<void> {
    const pick = await this.deps.pickScreen("Select the internal memory card to be created.", [
      { id: "ps2", label: "Internal Memory Card (PS2)", note: "You can save up to 7998 KB of saved data for PlayStation®2 format software on the system storage." },
      { id: "ps1", label: "Internal Memory Card (PS)", note: "You can save up to 15 blocks (120 KB) of saved data for PlayStation® format software on the system storage." },
    ]);
    if (!pick) return;
    await this.createCard(pick.id as "ps1" | "ps2");
  }

  private async createCard(kind: "ps1" | "ps2"): Promise<void> {
    const a = await this.deps.askText(kind === "ps1" ? "New PlayStation Memory Card" : "New PlayStation 2 Memory Card", [{ label: "Name", value: kind === "ps1" ? "PS1 Memory Card" : "PS2 Memory Card" }]);
    if (!a) return;
    const card = await window.axm.memcardCreate(kind, a[0] || (kind === "ps1" ? "PS1 Memory Card" : "PS2 Memory Card"));
    await this.reload();
    this.deps.notify(`${card.name} created`, this.cardIcon(card));
    const emu = this.emulators.find((e) => e.kind === kind && e.installPath);
    if (emu) {
      this.deps.showOptions(`Put ${card.name} where ${emu.name} looks?`, [
        { label: `Yes, copy it to ${emu.name}`, hint: emu.cardFolder ?? emu.defaultCardFolder, run: async () => { const r = await window.axm.memcardPublish(card.id, emu.id); this.deps.notify(r.message); } },
        { label: "Not now" },
      ]);
    }
    this.deps.refresh();
  }

  private exportTargets(kind: "ps1" | "ps2", run: (folder: string) => Promise<void>): PopupOption[] {
    return this.deps.volumes().filter((v) => !v.system).map((v) => ({ label: `${v.label} (${v.drive})`, hint: `${v.drive}\\SAVE\\${kind === "ps1" ? "PS" : "PS2"}`, run: () => run(`${v.drive}\\SAVE\\${kind === "ps1" ? "PS" : "PS2"}`) }));
  }

  private cardOptions(c: MemoryCard): void {
    const emus = this.emulators.filter((e) => e.kind === c.kind && e.installPath);
    this.deps.showOptions(c.name, [
      ...emus.map((e) => ({ label: `Copy to ${e.name}`, hint: e.cardFolder ?? e.defaultCardFolder, run: async () => { const r = await window.axm.memcardPublish(c.id, e.id); this.deps.notify(r.message); } })),
      { label: "Import a save", hint: `${c.kind === "ps1" ? "raw card, DexDrive .gme, .mcs" : ".psu or .psv"} from a drive`, run: () => { this.card = c; this.candidates = null; this.go("import"); void this.scanDrives(); } },
      { label: "Save Database", hint: "community saves, by title id", run: () => this.searchCommunity(c) },
      { label: "Rename", run: async () => { const a = await this.deps.askText("Rename Card", [{ label: "Name", value: c.name }]); if (a) { await window.axm.memcardRename(c.id, a[0]); await this.reload(); this.deps.refresh(); } } },
      { label: `Slot ${c.slot === 1 ? 2 : 1}`, hint: "swaps with whatever holds it", run: async () => { await window.axm.memcardSlot(c.id, c.slot === 1 ? 2 : 1); await this.reload(); this.deps.refresh(); } },
      { label: "Export the whole card", children: this.exportTargets(c.kind, async (folder) => { const r = await window.axm.memcardExport(c.id, null, folder); this.deps.notify(r.message); }) },
      { label: "Delete card", hint: "the file and its saves - backups under Apollo stay", children: [{ label: `Yes, delete ${c.name}`, run: async () => { await window.axm.memcardDelete(c.id); await this.reload(); if (this.card?.id === c.id) { this.card = null; this.go("root"); } this.deps.refresh(); } }, { label: "No" }] },
    ]);
  }

  // ----------------------------------------------------------- card ----

  private cardItems(): MenuItem[] {
    const c = this.card!;
    const rows = this.saves.map((s): MenuItem => ({
      id: `save-${s.name}`,
      title: s.title,
      subtitle: `${s.name} · ${c.kind === "ps1" ? `${s.blocks ?? 1} block${(s.blocks ?? 1) === 1 ? "" : "s"}` : `${fmt(s.sizeBytes)} · ${s.files?.length ?? 0} file${(s.files?.length ?? 0) === 1 ? "" : "s"}`}`,
      iconUrl: ICON.save,
      iconClass: "memcard",
      contextHint: "edit save · cheats",
      onConfirm: () => { void this.saveSidebar(s); },
      onContext: () => { void this.saveSidebar(s); return true; },
    }));
    if (!rows.length) rows.push({ id: "save-none", title: "No saves on this card", subtitle: "Play a game with it mounted, or Y for Import and the Save Database", iconUrl: ICON.save, iconClass: "memcard", onConfirm: () => this.cardOptions(c), onContext: () => { this.cardOptions(c); return true; }, contextHint: "card options" });
    return rows;
  }

  // ----------------------------------------------------- Y sidebar ----

  /** Y (or A) on a save: everything that can be done to it, nested in the sidebar. */
  private async saveSidebar(s: CardSave): Promise<void> {
    const c = this.card!;
    const ref = { cardId: c.id, save: s.name };
    // Apollo's answer and the backups are local and quick; fetched before the sidebar opens.
    if (this.cheatsFor?.save !== s.name) {
      this.selection.clear();
      const r = await window.axm.apolloFind(ref).catch(() => null);
      this.cheatsFor = { save: s.name, match: r && !("error" in r) ? r : null, error: !r ? "This save's game couldn't be identified from its name." : "error" in r ? r.error : "" };
      for (const mc of this.cheatsFor.match?.codes ?? []) if (mc.code.isDefault && !mc.code.isInfo) this.selection.set(this.key(mc), { patchFile: mc.patchFile, codeId: mc.code.id, options: this.defaultOptions(mc) });
    }
    const backups = await window.axm.apolloBackups(ref).catch(() => [] as BackupInfo[]);
    const m = this.cheatsFor.match;
    const n = m ? m.codes.filter((x) => !x.code.isInfo).length : 0;
    this.deps.showOptions(s.title, [
      {
        label: "Edit Save",
        hint: m ? `${n} Apollo patch${n === 1 ? "" : "es"} · ${m.identity.gameName ?? m.identity.productCode}` : this.cheatsFor.error || "no patches found",
        children: [
          { label: "Apollo Cheats", hint: m ? `${m.identity.productCode}${m.identity.region ? ` · ${m.identity.region}` : ""}` : this.cheatsFor.error, children: this.cheatOptions(ref) },
          { label: "Restore Backup", hint: backups.length ? `${backups.length} backup${backups.length === 1 ? "" : "s"}` : "none yet", children: backups.length ? backups.map((b, i) => ({ label: `${when(b.at)}${i === 0 ? " · latest" : ""}`, hint: b.applied.length ? `before: ${b.applied.join(", ")}` : b.note || "before an edit", children: [{ label: "Restore the whole card to this point", run: async () => { const r = await window.axm.apolloRestore(ref, b.id); this.deps.notify(r.message); await this.reloadSaves(); this.deps.refresh(); } }, { label: "Cancel" }] })) : [{ label: "No backups yet", hint: "one is made before every edit and every import" }] },
          { label: "Undo Last Edit", hint: backups[0] ? `back to ${when(backups[0].at)}` : "nothing to undo", run: async () => { const r = await window.axm.apolloRestore(ref); this.deps.notify(r.message); await this.reloadSaves(); this.deps.refresh(); } },
        ],
      },
      { label: "Save Database", hint: "community saves for this game", run: () => this.openCommunity(c, ref) },
      ...(this.deps.phoneConnected() ? [{ label: "Send a copy to the phone", hint: "the companion keeps it offline", run: async () => { await this.deps.sendToPhone(c.id, s.name); this.deps.notify(`${s.title} sent to the phone`); } }] : []),
      { label: "Export save", children: this.exportTargets(c.kind, async (folder) => { const r = await window.axm.memcardExport(c.id, s.name, folder); this.deps.notify(r.message); }) },
      { label: "Details", run: () => this.deps.showInfo(s.title, this.cardIcon(c), [{ label: "Directory", value: s.name }, { label: "Size", value: fmt(s.sizeBytes) }, ...(s.files ? [{ label: "Files", value: s.files.join("\n") }] : []), { label: "Card", value: `${c.name} · ${c.filePath}` }]) },
    ]);
  }

  private key(mc: MatchedCode): string {
    return `${mc.patchFile}#${mc.code.id}`;
  }

  private defaultOptions(mc: MatchedCode): Record<string, string> {
    const o: Record<string, string> = {};
    for (const opt of mc.code.options) o[opt.tag] = opt.choices[0]?.value ?? "";
    return o;
  }

  private optionLabel(mc: MatchedCode, sel: ApolloSelection | undefined): string {
    return mc.code.options.map((o) => o.choices.find((c) => c.value === (sel?.options[o.tag] ?? o.choices[0]?.value))?.label ?? "").filter(Boolean).join(" · ");
  }

  /** The cheat list for the sidebar: toggles in place, values by a nested choice, then preview / apply. */
  private cheatOptions(ref: { cardId: string; save: string }): PopupOption[] {
    const m = this.cheatsFor?.match;
    if (!m) return [{ label: "No cheats for this save", hint: this.cheatsFor?.error ?? "" }];
    if (!m.codes.length) return [{ label: "No patches in the database for this game", hint: `nothing in apollo-patches names ${m.identity.productCode} · your own .savepatch files go in the custom folder` }];
    const rows: PopupOption[] = [];
    let group: string | null = null;
    for (const mc of m.codes) {
      if (mc.code.group !== group) {
        group = mc.code.group;
        if (group) rows.push({ label: `— ${group} —` });
      }
      const k = this.key(mc);
      if (mc.code.isInfo) {
        rows.push({ label: `ⓘ ${mc.code.name}` });
        continue;
      }
      const row: PopupOption = {
        label: mc.code.name,
        hint: [this.optionLabel(mc, this.selection.get(k)), mc.code.isRequired ? "required · added with any other" : "", mc.targets.join(", ")].filter(Boolean).join(" · "),
        selected: this.selection.has(k),
      };
      if (mc.code.options.length) {
        // A value to pick: the choices are the children; picking one selects the code with it.
        row.children = [
          ...mc.code.options.flatMap((o) => o.choices.map((ch) => ({
            label: ch.label,
            hint: `${o.tag} = ${ch.value}`,
            selected: this.selection.get(k)?.options[o.tag] === ch.value,
            run: () => {
              const cur = this.selection.get(k) ?? { patchFile: mc.patchFile, codeId: mc.code.id, options: this.defaultOptions(mc) };
              cur.options[o.tag] = ch.value;
              this.selection.set(k, cur);
              this.reopenCheats(ref);
            },
          }))),
          { label: "Clear", hint: "leave this one out", run: () => { this.selection.delete(k); this.reopenCheats(ref); } },
        ];
      } else {
        row.stay = true;
        row.run = () => {
          if (this.selection.has(k)) this.selection.delete(k);
          else this.selection.set(k, { patchFile: mc.patchFile, codeId: mc.code.id, options: {} });
          row.selected = this.selection.has(k);
        };
      }
      rows.push(row);
    }
    rows.push(
      { label: "[ Preview Changes ]", hint: "every byte that would change", run: () => this.previewChanges(ref) },
      { label: "[ Apply Selected ]", hint: "a timestamped backup of the card is made first", run: () => this.applySelected(ref) },
      { label: "About these patches", hint: m.attribution.length ? "source and author" : "", run: () => this.deps.showInfo(m.identity.gameName ?? m.identity.productCode, ICON.utility, [
        { label: "Title ID", value: `${m.identity.productCode} (${m.identity.titleId})` },
        { label: "Region", value: m.identity.region || "—" },
        { label: "Files", value: m.identity.files.map((f) => `${f.name} · ${fmt(f.size)}`).join("\n") },
        { label: "Source", value: m.attribution.join("\n") },
        { label: "Hidden", value: m.hidden ? `${m.hidden} code${m.hidden === 1 ? "" : "s"} in the file target other save files or regions, so they aren't shown` : "every code in the file fits this save" },
        { label: "Engine", value: "Apollo Save Tool patch engine, ported to TypeScript (apollo-lib, GPL-3.0)" },
      ]) },
    );
    return rows;
  }

  private reopenCheats(ref: { cardId: string; save: string }): void {
    this.deps.showOptions("Apollo Cheats", this.cheatOptions(ref));
  }

  private selections(): ApolloSelection[] {
    return [...this.selection.values()];
  }

  private async previewChanges(ref: { cardId: string; save: string }): Promise<void> {
    if (!this.selection.size) { this.deps.notify("Select a patch first"); this.reopenCheats(ref); return; }
    const p = await window.axm.apolloPreview(ref, this.selections());
    if (!p.ok) { this.deps.showInfo("Preview", ICON.utility, [{ label: "Refused", value: p.error ?? "" }, { label: "Log", value: p.log.slice(-12).join("\n") }]); return; }
    const rows: InfoRow[] = [];
    if (p.added.length) rows.push({ label: "Added", value: `${p.added.join(", ")} (required)` });
    for (const f of p.files) {
      rows.push({ label: f.name, value: f.changed ? `${f.changed} byte${f.changed === 1 ? "" : "s"} change${f.before !== f.after ? ` · size ${f.before} → ${f.after}` : ""}\n${f.first.map((c) => `0x${c.offset.toString(16).toUpperCase().padStart(6, "0")}: ${c.from} → ${c.to}`).join("\n")}${f.changed > f.first.length ? `\n… and ${f.changed - f.first.length} more` : ""}` : "unchanged" });
    }
    rows.push({ label: "Engine log", value: p.log.slice(-16).join("\n") });
    this.deps.showInfo("Preview Changes", ICON.utility, rows);
  }

  private async applySelected(ref: { cardId: string; save: string }): Promise<void> {
    if (!this.selection.size) { this.deps.notify("Select a patch first"); this.reopenCheats(ref); return; }
    this.deps.showOptions("Apply to the save?", [
      { label: `Apply ${this.selection.size} selected`, hint: "the card is backed up first; Undo Last Edit puts it back", run: async () => {
        const r = await window.axm.apolloApply(ref, this.selections(), this.cheatsFor?.match?.identity.gameName ?? undefined);
        this.deps.notify(r.ok ? `${this.saves.find((s) => s.name === ref.save)?.title ?? ref.save}: ${r.message}` : `Not applied: ${r.message}`, ICON.utility);
        if (!r.ok) this.deps.showInfo("Not applied", ICON.utility, [{ label: "Reason", value: r.message }, { label: "Log", value: r.log.slice(-12).join("\n") }]);
        else { this.selection.clear(); await this.reloadSaves(); }
        this.deps.refresh();
      } },
      { label: "Preview first", run: () => this.previewChanges(ref) },
      { label: "Cancel", run: () => this.reopenCheats(ref) },
    ]);
  }

  // ------------------------------------------------------ community ----

  private async openCommunity(c: MemoryCard, ref: { cardId: string; save: string }): Promise<void> {
    this.deps.notify("Asking the save database…", ICON.utility);
    const r = await window.axm.apolloCommunity(ref);
    this.showCommunity(c, r);
  }

  private async searchCommunity(c: MemoryCard): Promise<void> {
    const a = await this.deps.askText("Save Database", [{ label: "Title ID (e.g. SLUS-20216)", value: "" }]);
    if (!a || !a[0].trim()) return;
    const r = await window.axm.apolloCommunity({ platform: c.kind === "ps1" ? "PS1" : "PS2", titleId: a[0].trim() });
    this.showCommunity(c, r);
  }

  private showCommunity(c: MemoryCard, r: { gameName: string | null; titleId: string; saves: CommunitySave[] }): void {
    if (!r.saves.length) { this.deps.showOptions("Save Database", [{ label: "No community saves for this title", hint: `${r.gameName ?? (r.titleId || "unknown")} · apollo-saves lists nothing` }]); return; }
    this.deps.showOptions(`Save Database · ${r.gameName ?? r.titleId}`, r.saves.map((s) => ({
      label: s.description,
      hint: `${s.zip}${s.local ? " · downloaded" : ""}`,
      children: [
        { label: `Download and put it on ${c.name}`, hint: "the card is backed up first", run: async () => { const x = await window.axm.apolloImportCommunity(c.id, s.platform, s.titleId, s.zip); this.deps.notify(x.message, ICON.utility); if (this.card?.id === c.id) await this.reloadSaves(); this.deps.refresh(); } },
        { label: "Details", run: () => this.deps.showInfo(s.description, s.iconUrl ? `file:///${s.iconUrl.replace(/\\/g, "/")}` : undefined, [{ label: "Title", value: r.gameName ?? r.titleId }, { label: "File", value: s.zip }, { label: "Source", value: "Apollo Save Tool community database (bucanero/apollo-saves, GPL-3.0)" }]) },
        { label: "Cancel" },
      ],
    })));
  }

  // --------------------------------------------------------- import ----

  private async scanDrives(): Promise<void> {
    const roots = this.deps.volumes().map((v) => `${v.drive}\\`);
    const all = { ps1: [] as ImportCandidate[], ps2: [] as ImportCandidate[] };
    for (const r of roots) {
      try {
        const found = await window.axm.memcardScanDrive(r);
        all.ps1.push(...found.ps1);
        all.ps2.push(...found.ps2);
      } catch {
        /* drive gone */
      }
    }
    this.candidates = all;
    this.deps.refresh();
  }

  private importItems(): MenuItem[] {
    if (!this.candidates) return [{ id: "im-busy", title: "Looking through the drives…", subtitle: "SAVE\\PS and SAVE\\PS2 folders, memory card images and single saves", iconUrl: ICON.utility, iconClass: "memcard" }];
    const list = [...this.candidates.ps1, ...this.candidates.ps2];
    if (!list.length) return [{ id: "im-none", title: "Nothing to import", subtitle: "Put cards or saves in a drive's SAVE\\PS or SAVE\\PS2 folder", iconUrl: ICON.utility, iconClass: "memcard" }];
    return list.map((c): MenuItem => ({
      id: `im-${c.filePath}`,
      title: c.saves[0]?.title && c.saves.length === 1 ? `${c.saves[0].title} (${c.fileName})` : c.fileName,
      subtitle: c.supported ? `${c.kind?.toUpperCase()} ${c.format}${c.saves.length ? ` · ${c.saves.length} save${c.saves.length === 1 ? "" : "s"}` : ""} · ${c.filePath}` : c.reason ?? "unsupported",
      iconUrl: c.kind === "ps2" ? ICON.ps2(1) : ICON.ps1(1),
      iconClass: "memcard",
      onConfirm: () => {
        if (!c.supported) { this.deps.notify(c.reason ?? "That file can't be imported"); return; }
        const targets = this.managed.filter((m) => m.kind === c.kind);
        if (!targets.length) { this.deps.notify(`Make a ${c.kind?.toUpperCase()} card first`); return; }
        this.deps.showOptions(`Import ${c.fileName} onto`, targets.map((m) => ({ label: m.name, hint: `slot ${m.slot}`, run: async () => {
          const r = c.kind === "ps1" ? await window.axm.memcardImportPs1(m.id, c.filePath) : await window.axm.memcardImportPs2(m.id, c.filePath);
          this.deps.notify(r.message, this.cardIcon(m));
          if (this.card?.id === m.id) await this.reloadSaves();
          this.deps.refresh();
        } })));
      },
    }));
  }

  // ------------------------------------------------------ emulators ----

  private emulatorItems(): MenuItem[] {
    return this.emulators.map((e): MenuItem => ({
      id: `emu-${e.id}`,
      title: e.name,
      subtitle: e.installPath ? `${e.installPath} · cards: ${e.cardFolder ?? `${e.defaultCardFolder} (after its first run)`}${e.cards.length ? ` · ${e.cards.length} there` : ""}` : "Not installed · Retro › Store › Emulators",
      iconUrl: e.kind === "ps1" ? ICON.ps1(1) : ICON.ps2(1),
      iconClass: "memcard",
      onConfirm: () => this.deps.showOptions(e.name, [
        ...this.managed.filter((m) => m.kind === e.kind).map((m) => ({ label: `Copy ${m.name} to ${e.name}`, run: async () => { const r = await window.axm.memcardPublish(m.id, e.id); this.deps.notify(r.message); } })),
        ...e.cards.map((f) => ({ label: `Adopt ${f}`, hint: "a copy of the emulator's card, managed here", run: async () => { const a = await this.deps.askText("Card name", [{ label: "Name", value: f.replace(/\.[^.]+$/, "") }]); if (!a) return; const r = await window.axm.memcardAdopt(e.id, f, a[0]); this.deps.notify(r.message); await this.reload(); this.deps.refresh(); } })),
        { label: "Not now" },
      ]),
    }));
  }

  // ---------------------------------------------------------- about ----

  private about(): void {
    this.deps.showInfo("Thank you", ICON.utility, [
      { label: "Apollo Save Tool", value: "Damian \"bucanero\" Parrino - the patch format, the patch engine this ports (apollo-lib), the cheat database (apollo-patches) and the community save database (apollo-saves). GPL-3.0.\ngithub.com/bucanero/apollo-lib · apollo-patches · apollo-saves" },
      { label: "Patch authors", value: "Every code in the database carries its author's name in its header; A-X-M shows it under About these patches. Bruteforce Save Data (aldostools) and the Save Wizard format the codes descend from." },
      { label: "Memory cards", value: "Ross Ridge's ps2mc / mymc notes on the PS2 card filesystem; the DuckStation and PCSX2 projects, whose card formats these are." },
      { label: "Licence", value: "The Apollo-derived parts of A-X-M (src/main/apollo) are GPL-3.0, as the originals. See assets/THIRD_PARTY_LICENSES.md." },
    ]);
  }
}
