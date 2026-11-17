// Copyright Epic Games, Inc. All Rights Reserved.

import { HttpErrorResponse } from "@angular/common/http";
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import {
  Board,
  BoardElement,
  NoteColor,
  BoardPermission,
  BoardPoint,
  BoardShapeKind,
  BoardElementOperation,
  NewBoardElement,
} from "../../core/models/board.model";
import { BoardLive } from "../../core/services/board-live";
import { Boards } from "../../core/services/boards";

type BoardTool =
  | "select"
  | "hand"
  | "note"
  | "text"
  | "card"
  | "shape"
  | "line"
  | "frame"
  | "pen"
  | "eraser"
  | "lasso"
  | "sticker"
  | "comment";

type PlacementTool =
  "note" | "text" | "card" | "shape" | "frame" | "sticker" | "comment";

interface ElementHistory {
  before: BoardElement[];
  after: BoardElement[];
}

interface ElementDrag {
  ids: string[];
  pointerId: number;
  clientX: number;
  clientY: number;
  before: BoardElement[];
  saveBefore: BoardElement[];
}

interface CanvasPan {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  targetId: string | null;
  moved: boolean;
}

interface PointerGesture {
  pointerId: number;
  tool: BoardTool;
  start: BoardPoint;
  current: BoardPoint;
  startElementId?: string;
  points?: BoardPoint[];
}

interface ContextMenuState {
  x: number;
  y: number;
  targetId: string | null;
}

interface DuplicateMemory {
  latestIds: string[];
  positions: Record<string, BoardPoint>;
  offset: BoardPoint;
}

interface AlignmentGuides {
  vertical: number[];
  horizontal: number[];
}

type PaletteCommandId =
  | BoardTool
  | "undo"
  | "redo"
  | "duplicate"
  | "tidy"
  | "fit-board"
  | "fit-selection"
  | "lock"
  | "delete";

const sceneWidth = 2400;
const sceneHeight = 1600;
const maxHistoryEntries = 50;

@Component({
  selector: "app-board-page",
  imports: [FormsModule, RouterLink],
  templateUrl: "./board-page.html",
  styleUrl: "./board-page.scss",
})
export class BoardPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly boardService = inject(Boards);
  private readonly boardLive = inject(BoardLive);
  @ViewChild("canvas") private canvas?: ElementRef<HTMLElement>;
  @ViewChild("commandInput")
  private commandInput?: ElementRef<HTMLInputElement>;

  readonly boardId = this.route.snapshot.paramMap.get("boardId") ?? "";
  readonly isSample = this.boardId === "sample";
  readonly board = signal<Board | null>(null);
  readonly permission = signal<BoardPermission | null>(null);
  readonly conflictedOperations = signal<BoardElementOperation[] | null>(null);
  readonly canEdit = computed(
    () =>
      ["owner", "admin", "edit"].includes(this.permission() ?? "") &&
      this.conflictedOperations() === null,
  );
  readonly titleDraft = signal("");
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly saveState = signal("Saved");
  readonly selectedTool = signal<BoardTool>("select");
  readonly shapeKind = signal<BoardShapeKind>("rectangle");
  readonly selectedElementId = signal<string | null>(null);
  readonly selectedElementIds = signal<string[]>([]);
  readonly editingElementId = signal<string | null>(null);
  readonly drawingPoints = signal<BoardPoint[]>([]);
  readonly lassoPoints = signal<BoardPoint[]>([]);
  readonly selectionRectangle = signal<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  readonly creationRectangle = signal<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  readonly linePreview = signal<{ start: BoardPoint; end: BoardPoint } | null>(
    null,
  );
  readonly contextMenu = signal<ContextMenuState | null>(null);
  readonly alignmentGuides = signal<AlignmentGuides>({
    vertical: [],
    horizontal: [],
  });
  readonly paletteOpen = signal(false);
  readonly paletteQuery = signal("");
  readonly canvasPanning = signal(false);
  readonly draggingElementId = signal<string | null>(null);
  readonly inputMode = signal<"mouse" | "trackpad">("mouse");
  readonly spaceHandActive = signal(false);
  readonly undoDepth = signal(0);
  readonly redoDepth = signal(0);
  readonly viewport = signal({ x: 0, y: 0, zoom: 1 });
  readonly liveStatus = this.boardLive.status;
  readonly canUndo = computed(
    () => this.canEdit() && !this.isSaving() && this.undoDepth() > 0,
  );
  readonly canRedo = computed(
    () => this.canEdit() && !this.isSaving() && this.redoDepth() > 0,
  );
  readonly sceneTransform = computed(() => {
    const view = this.viewport();
    return `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  });
  readonly title = computed(() =>
    this.isSample
      ? "Getting started"
      : (this.board()?.title ?? "Loading board…"),
  );
  readonly tools: {
    id: BoardTool;
    label: string;
    shortLabel: string;
  }[] = [
    { id: "select", label: "Select (V)", shortLabel: "Select" },
    { id: "hand", label: "Hand (H)", shortLabel: "Hand" },
    { id: "note", label: "Sticky note (N)", shortLabel: "Note" },
    { id: "text", label: "Text (T)", shortLabel: "Text" },
    { id: "shape", label: "Shapes (S)", shortLabel: "Shapes" },
    { id: "card", label: "Card", shortLabel: "Card" },
    { id: "line", label: "Connection line (L)", shortLabel: "Line" },
    { id: "pen", label: "Pen (P)", shortLabel: "Pen" },
    { id: "eraser", label: "Eraser (E)", shortLabel: "Erase" },
    { id: "lasso", label: "Lasso (Q)", shortLabel: "Lasso" },
    { id: "frame", label: "Frame (F)", shortLabel: "Frame" },
    { id: "comment", label: "Comment (C)", shortLabel: "Comment" },
    { id: "sticker", label: "Sticker", shortLabel: "Sticker" },
  ];
  readonly shapeKinds: {
    id: BoardShapeKind;
    label: string;
  }[] = [
    { id: "rectangle", label: "Rectangle" },
    { id: "ellipse", label: "Ellipse" },
    { id: "arrow", label: "Arrow" },
  ];
  readonly colorOptions: NoteColor[] = ["cream", "rose", "sage", "sky"];
  readonly connectionDirections: {
    id: "up" | "right" | "down" | "left";
  }[] = [{ id: "up" }, { id: "right" }, { id: "down" }, { id: "left" }];
  readonly paletteCommands: { id: PaletteCommandId; label: string }[] = [
    ...this.tools.map((tool) => ({
      id: tool.id,
      label: tool.label.replace(/\s+\(.+\)$/, ""),
    })),
    { id: "undo", label: "Undo" },
    { id: "redo", label: "Redo" },
    { id: "duplicate", label: "Duplicate selection" },
    { id: "tidy", label: "Tidy up selection" },
    { id: "fit-board", label: "Fit board to screen" },
    { id: "fit-selection", label: "Zoom to selection" },
    { id: "lock", label: "Lock or unlock selection" },
    { id: "delete", label: "Delete selection" },
  ];
  readonly matchingPaletteCommands = computed(() => {
    const query = this.paletteQuery().trim().toLowerCase();
    return this.paletteCommands.filter((command) =>
      command.label.toLowerCase().includes(query),
    );
  });

  private stopLive: (() => void) | null = null;
  private hasLocalEdit = false;
  private refreshPending = false;
  private elementDrag: ElementDrag | undefined;
  private canvasPan: CanvasPan | undefined;
  private drawingPointerId: number | undefined;
  private gesture: PointerGesture | undefined;
  private eraseBefore: BoardElement[] | undefined;
  private suppressNextClick = false;
  private pendingElementClickId: string | undefined;
  private spaceDown = false;
  private textEditBefore: BoardElement[] | undefined;
  private pendingFocusElementId: string | undefined;
  private readonly undoStack: ElementHistory[] = [];
  private readonly redoStack: ElementHistory[] = [];
  private duplicateMemory: DuplicateMemory | undefined;
  private lastPointerPoint: BoardPoint = { x: 50, y: 50 };

  ngOnInit(): void {
    if (this.isSample) {
      this.isLoading.set(false);
      return;
    }
    this.loadBoard(true);
  }

  ngOnDestroy(): void {
    this.stopLive?.();
  }

  @HostListener("document:keydown", ["$event"])
  onDocumentKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    const editingField =
      target instanceof HTMLElement &&
      !!target.closest(
        "input:not([readonly]), textarea:not([readonly]), select, [contenteditable='true'], [role='textbox']",
      );
    const focusedControl =
      target instanceof HTMLElement &&
      !!target.closest("button, select, [role='button']");

    if (this.paletteOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeCommandPalette();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.openCommandPalette();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.editingElementId()) {
        if (target instanceof HTMLElement) {
          target.blur();
        } else {
          this.saveTextEdit();
        }
        return;
      }
      if (this.selectedTool() !== "select") {
        this.cancelGesture();
        this.setTool("select");
        return;
      }
      this.cancelGesture();
      this.setSelection([]);
      this.contextMenu.set(null);
      return;
    }
    if (
      event.code === "Digit1" &&
      (event.shiftKey || event.altKey) &&
      !editingField
    ) {
      event.preventDefault();
      this.fitBoardToScreen();
      return;
    }
    if (event.code === "Digit2" && event.shiftKey && !editingField) {
      event.preventDefault();
      this.zoomToSelection();
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (
      modifier &&
      event.shiftKey &&
      event.key.toLowerCase() === "l" &&
      !editingField
    ) {
      event.preventDefault();
      this.toggleSelectionLock();
      return;
    }
    if (modifier && event.key.toLowerCase() === "z" && !editingField) {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y" && !editingField) {
      event.preventDefault();
      this.redo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "d" && !editingField) {
      event.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (
      !editingField &&
      (event.key === "Delete" || event.key === "Backspace") &&
      this.selectedElementIds().length > 0
    ) {
      event.preventDefault();
      this.deleteSelection();
      return;
    }
    if (event.code === "Space" && !editingField && !focusedControl) {
      event.preventDefault();
      this.spaceDown = true;
      this.spaceHandActive.set(true);
      return;
    }
    if (editingField || event.altKey || event.ctrlKey || event.metaKey) return;
    const shortcuts: Record<string, BoardTool> = {
      v: "select",
      h: "hand",
      n: "note",
      t: "text",
      s: "shape",
      l: "line",
      p: "pen",
      e: "eraser",
      q: "lasso",
      f: "frame",
      c: "comment",
    };
    const shortcut = shortcuts[event.key.toLowerCase()];
    if (shortcut) {
      event.preventDefault();
      this.setTool(shortcut);
    }
  }

  @HostListener("document:keyup", ["$event"])
  onDocumentKeyUp(event: KeyboardEvent): void {
    if (event.code === "Space" && this.spaceDown) {
      this.spaceDown = false;
      this.spaceHandActive.set(false);
    }
  }

  @HostListener("document:copy", ["$event"])
  onDocumentCopy(event: ClipboardEvent): void {
    if (this.isTypingTarget(event.target)) return;
    const elements = this.selectedElements();
    if (!elements.length || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      JSON.stringify({ format: "pinit-elements-v1", elements }),
    );
  }

  @HostListener("document:cut", ["$event"])
  onDocumentCut(event: ClipboardEvent): void {
    if (this.isTypingTarget(event.target)) return;
    this.onDocumentCopy(event);
    if (event.defaultPrevented) this.deleteSelection();
  }

  @HostListener("document:paste", ["$event"])
  onDocumentPaste(event: ClipboardEvent): void {
    if (
      this.isTypingTarget(event.target) ||
      !this.canEdit() ||
      this.isSample ||
      this.isSaving() ||
      !event.clipboardData
    ) {
      return;
    }
    const customData = event.clipboardData.getData(
      "application/x-pinit-elements",
    );
    const plainText = event.clipboardData.getData("text/plain");
    const clipboardText = customData || plainText;
    const copiedElements = this.parseClipboardElements(clipboardText);
    if (copiedElements) {
      event.preventDefault();
      this.pasteElements(copiedElements);
      return;
    }
    if (clipboardText.trimStart().startsWith('{"format":"pinit-elements-')) {
      event.preventDefault();
      this.errorMessage.set("The copied PinIt items are invalid.");
      return;
    }
    if (!clipboardText) return;
    const rows = clipboardText.replace(/\r/g, "").split("\n");
    if (rows.at(-1) === "") rows.pop();
    const grid = rows.map((row) => row.split("\t"));
    const cells = grid.flat();
    if (
      cells.length === 1 &&
      !clipboardText.includes("\t") &&
      !clipboardText.includes("\n")
    ) {
      grid[0][0] = clipboardText;
    }
    event.preventDefault();
    this.pasteGrid(grid);
  }

  @HostListener("window:blur")
  onWindowBlur(): void {
    this.spaceDown = false;
    this.spaceHandActive.set(false);
  }

  loadBoard(connectLive = false, messageAfterLoad?: string): void {
    if (this.hasLocalEdit || this.isSaving()) {
      this.refreshPending = true;
      return;
    }
    this.boardService.get(this.boardId).subscribe({
      next: ({ board, permission }) => {
        this.board.set(board);
        this.permission.set(permission ?? null);
        this.titleDraft.set(board.title);
        this.isLoading.set(false);
        this.errorMessage.set(messageAfterLoad ?? null);
        if (connectLive && !this.stopLive) {
          this.stopLive = this.boardLive.connect(
            this.boardId,
            (updatedAt) => {
              const currentBoard = this.board();
              if (currentBoard?.updatedAt === updatedAt) {
                return;
              }
              this.clearHistory();
              this.loadBoard();
            },
            () => {
              this.errorMessage.set(
                "An admin removed your access to this board.",
              );
              this.stopLive?.();
              void this.router.navigate(["/boards"]);
            },
          );
        }
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading.set(false);
        if (error.status === 404) {
          void this.router.navigate(["/boards"]);
          return;
        }
        this.errorMessage.set(
          this.describeError(error, "Could not load this board."),
        );
      },
    });
  }

  beginLocalEdit(): void {
    if (this.canEdit() && !this.isSaving()) {
      this.hasLocalEdit = true;
    }
  }

  saveTitle(): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    const title = this.titleDraft().trim();
    this.hasLocalEdit = false;
    if (!board || !title) {
      this.titleDraft.set(board?.title ?? "");
      this.finishPendingRefresh();
      return;
    }
    if (title === board.title) {
      this.finishPendingRefresh();
      return;
    }
    this.isSaving.set(true);
    this.saveState.set("Saving…");
    this.boardService.updateTitle(this.boardId, title, board.title).subscribe({
      next: ({ board: updatedBoard }) => {
        this.board.set(updatedBoard);
        this.titleDraft.set(updatedBoard.title);
        this.saveState.set("Saved");
        this.isSaving.set(false);
        this.finishPendingRefresh();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.saveState.set("Not saved");
        this.errorMessage.set(
          this.describeError(error, "Could not rename this board."),
        );
        if (error.status === 409) {
          this.refreshPending = false;
          this.loadBoard(
            false,
            "The board title changed elsewhere. The latest title was loaded; apply your rename again if needed.",
          );
        } else {
          this.finishPendingRefresh();
        }
      },
    });
  }

  saveTitleOnEnter(event: Event): void {
    event.preventDefault();
    this.saveTitle();
    (event.currentTarget as HTMLInputElement).blur();
  }

  setTool(tool: BoardTool): void {
    if (
      (!this.canEdit() && tool !== "select" && tool !== "hand") ||
      this.isSaving()
    )
      return;
    this.selectedTool.set(tool);
    this.editingElementId.set(null);
    this.contextMenu.set(null);
    if (tool !== "select") this.setSelection([]);
  }

  setInputMode(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "mouse" || value === "trackpad") {
      this.inputMode.set(value);
    }
  }

  setShapeKind(shape: BoardShapeKind): void {
    this.shapeKind.set(shape);
  }

  setSelection(ids: string[]): void {
    const board = this.board();
    const validIds = new Set(
      board?.elements.map((element) => element.id) ?? [],
    );
    const selection = [...new Set(ids)].filter((id) => validIds.has(id));
    this.selectedElementIds.set(selection);
    this.selectedElementId.set(selection[0] ?? null);
  }

  onElementClick(element: BoardElement, event: MouseEvent): void {
    event.stopPropagation();
    if (this.pendingElementClickId === element.id) {
      this.pendingElementClickId = undefined;
      return;
    }
    if (this.selectedTool() !== "select") return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const selected = this.selectedElementIds();
      this.setSelection(
        selected.includes(element.id)
          ? selected.filter((id) => id !== element.id)
          : [...selected, element.id],
      );
    } else {
      this.setSelection([element.id]);
    }
  }

  onElementDoubleClick(element: BoardElement, event: MouseEvent): void {
    event.stopPropagation();
    if (
      !this.canEdit() ||
      this.isSaving() ||
      this.selectedTool() !== "select" ||
      element.locked
    ) {
      return;
    }
    if (
      element.type === "note" ||
      element.type === "text" ||
      element.type === "card" ||
      element.type === "comment" ||
      element.type === "frame" ||
      element.type === "shape"
    ) {
      this.setSelection([element.id]);
      this.focusEditableElement(element.id);
    }
  }

  spawnNextSticky(id: string, event: KeyboardEvent): void {
    if (
      event.key !== "Tab" ||
      this.editingElementId() !== id ||
      !this.canEdit() ||
      this.isSaving()
    ) {
      return;
    }
    const note = this.board()?.elements.find(
      (element): element is Extract<BoardElement, { type: "note" }> =>
        element.id === id && element.type === "note",
    );
    if (!note) return;
    event.preventDefault();
    this.textEditBefore = undefined;
    this.editingElementId.set(null);
    (event.currentTarget as HTMLTextAreaElement).blur();
    const x = note.x + (note.width ?? 10) + 2;
    const y = note.y + (note.height ?? 15) + 2;
    const next = this.createElement(
      "note",
      x + 10 <= 100 ? x : note.x,
      x + 10 <= 100 ? note.y : Math.min(y, 85),
    );
    this.addElements([next], "note");
  }

  createConnectedElement(
    source: BoardElement,
    direction: "up" | "right" | "down" | "left",
  ): void {
    if (!this.canEdit() || this.isSaving() || source.locked) return;
    const sourceWidth = this.itemWidth(source);
    const sourceHeight = this.itemHeight(source) ?? 10;
    const newTool: PlacementTool =
      source.type === "shape"
        ? "shape"
        : source.type === "card"
          ? "card"
          : "note";
    const newSize =
      newTool === "shape"
        ? { width: 12, height: 10 }
        : newTool === "card"
          ? { width: 20, height: 16 }
          : { width: 10, height: 15 };
    const x =
      direction === "left"
        ? source.x - newSize.width - 3
        : direction === "right"
          ? source.x + sourceWidth + 3
          : source.x + (sourceWidth - newSize.width) / 2;
    const y =
      direction === "up"
        ? source.y - newSize.height - 3
        : direction === "down"
          ? source.y + sourceHeight + 3
          : source.y + (sourceHeight - newSize.height) / 2;
    const child = this.createElement(
      newTool,
      this.clampCoordinate(x),
      this.clampCoordinate(y),
    );
    const childElement =
      child.type === "note"
        ? { ...child, width: newSize.width, height: newSize.height }
        : child.type === "shape" || child.type === "card"
          ? { ...child, width: newSize.width, height: newSize.height }
          : child;
    const sourceCenter = {
      x: source.x + sourceWidth / 2,
      y: source.y + sourceHeight / 2,
    };
    const childCenter = {
      x: childElement.x + newSize.width / 2,
      y: childElement.y + newSize.height / 2,
    };
    const line: BoardElement = {
      id: crypto.randomUUID(),
      type: "line",
      x: this.edgePoint(source, childCenter).x,
      y: this.edgePoint(source, childCenter).y,
      endX: this.edgePoint(childElement, sourceCenter).x,
      endY: this.edgePoint(childElement, sourceCenter).y,
      startElementId: source.id,
      endElementId: childElement.id,
      color:
        "color" in source && this.isNoteColor(source.color)
          ? source.color
          : "rose",
      strokeWidth: 2,
    };
    const board = this.board();
    if (!board || board.elements.length + 2 > 500) {
      this.errorMessage.set("This board can hold at most 500 items.");
      return;
    }
    const before = this.cloneElements(board.elements);
    this.saveElements([...board.elements, childElement, line], before);
    this.setSelection([childElement.id]);
    if (childElement.type === "note") {
      this.focusEditableElement(childElement.id);
    }
  }

  onToolDragStart(event: DragEvent, tool: BoardTool): void {
    event.dataTransfer?.setData("application/x-pinit-tool", tool);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  }

  onCanvasDrop(event: DragEvent): void {
    event.preventDefault();
    if (!this.canEdit() || this.isSaving()) return;
    const tool = event.dataTransfer?.getData(
      "application/x-pinit-tool",
    ) as BoardTool;
    if (!this.isCreationTool(tool)) return;
    const point = this.pointerToBoardPoint(event.clientX, event.clientY);
    this.finishCreationGesture({
      pointerId: -1,
      tool,
      start: point,
      current: point,
    });
  }

  applySelectedColor(color: NoteColor): void {
    const board = this.board();
    if (!board || !this.canEdit() || this.isSaving()) return;
    const ids = new Set(this.selectedElementIds());
    const before = this.cloneElements(board.elements);
    const elements = board.elements.map((element) =>
      ids.has(element.id) && !element.locked && "color" in element
        ? { ...element, color }
        : element,
    );
    this.saveElements(elements, before);
  }

  contextDelete(): void {
    const targetId = this.contextMenu()?.targetId;
    this.contextMenu.set(null);
    if (targetId) this.removeElement(targetId);
  }

  contextTargetLocked(): boolean {
    const targetId = this.contextMenu()?.targetId;
    return (
      this.board()?.elements.find((element) => element.id === targetId)
        ?.locked ?? false
    );
  }

  contextToggleLock(): void {
    const targetId = this.contextMenu()?.targetId;
    this.contextMenu.set(null);
    if (!targetId) return;
    this.setSelection([targetId]);
    this.toggleSelectionLock();
  }

  resetView(): void {
    this.viewport.set({ x: 0, y: 0, zoom: 1 });
    this.contextMenu.set(null);
  }

  openCommandPalette(): void {
    this.paletteQuery.set("");
    this.paletteOpen.set(true);
    this.setTimeout(() => this.commandInput?.nativeElement.focus());
  }

  closeCommandPalette(): void {
    this.paletteOpen.set(false);
    this.paletteQuery.set("");
  }

  executePaletteCommand(command: PaletteCommandId): void {
    this.closeCommandPalette();
    const tool = this.tools.find((candidate) => candidate.id === command);
    if (tool) {
      this.setTool(tool.id);
      return;
    }
    switch (command) {
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
      case "duplicate":
        this.duplicateSelection();
        break;
      case "tidy":
        this.tidySelection();
        break;
      case "fit-board":
        this.fitBoardToScreen();
        break;
      case "fit-selection":
        this.zoomToSelection();
        break;
      case "lock":
        this.toggleSelectionLock();
        break;
      case "delete":
        this.deleteSelection();
        break;
    }
  }

  executeFirstPaletteCommand(event: Event): void {
    event.preventDefault();
    const command = this.matchingPaletteCommands()[0];
    if (command) this.executePaletteCommand(command.id);
  }

  fitBoardToScreen(): void {
    this.fitElementsToScreen(this.board()?.elements ?? []);
  }

  zoomToSelection(): void {
    this.fitElementsToScreen(this.selectedElements());
  }

  toggleSelectionLock(): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    const selected = this.selectedElements();
    if (!board || !selected.length) return;
    const ids = new Set(selected.map((element) => element.id));
    const shouldLock = selected.some((element) => !element.locked);
    const before = this.cloneElements(board.elements);
    const elements = board.elements.map((element) =>
      ids.has(element.id) ? { ...element, locked: shouldLock } : element,
    );
    this.saveElements(elements, before);
  }

  tidySelection(): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    const selected = this.selectedElements().filter(
      (element) =>
        !element.locked && element.type !== "line" && element.type !== "stroke",
    );
    if (!board || selected.length < 2) return;
    const columns = Math.ceil(Math.sqrt(selected.length));
    const rows = Math.ceil(selected.length / columns);
    const columnWidths = Array.from({ length: columns }, (_, column) =>
      Math.max(
        ...selected
          .filter((_, index) => index % columns === column)
          .map((element) => this.itemWidth(element)),
      ),
    );
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(
        ...selected
          .slice(row * columns, (row + 1) * columns)
          .map((element) => this.itemHeight(element) ?? 4),
      ),
    );
    const anchorX = Math.min(...selected.map((element) => element.x));
    const anchorY = Math.min(...selected.map((element) => element.y));
    const positions = new Map<string, BoardPoint>();
    let rowY = anchorY;
    for (let row = 0; row < rows; row += 1) {
      let columnX = anchorX;
      for (let column = 0; column < columns; column += 1) {
        const element = selected[row * columns + column];
        if (!element) continue;
        positions.set(element.id, {
          x: this.clampCoordinate(columnX),
          y: this.clampCoordinate(rowY),
        });
        columnX += (columnWidths[column] ?? 10) + 2;
      }
      rowY += (rowHeights[row] ?? 10) + 2;
    }
    const before = this.cloneElements(board.elements);
    const beforeById = new Map(
      board.elements.map((element) => [element.id, element]),
    );
    const elements = board.elements.map((element) => {
      const position = positions.get(element.id);
      if (position) return { ...element, ...position };
      if (element.type !== "line") return element;
      const start = positions.get(element.startElementId ?? "");
      const end = positions.get(element.endElementId ?? "");
      const original = beforeById.get(element.id);
      if (!original || original.type !== "line" || (!start && !end)) {
        return element;
      }
      const startElement = beforeById.get(element.startElementId ?? "");
      const endElement = beforeById.get(element.endElementId ?? "");
      return {
        ...element,
        x:
          start && startElement
            ? this.clampCoordinate(element.x + start.x - startElement.x)
            : element.x,
        y:
          start && startElement
            ? this.clampCoordinate(element.y + start.y - startElement.y)
            : element.y,
        endX:
          end && endElement
            ? this.clampCoordinate(element.endX + end.x - endElement.x)
            : element.endX,
        endY:
          end && endElement
            ? this.clampCoordinate(element.endY + end.y - endElement.y)
            : element.endY,
      };
    });
    this.saveElements(elements, before);
  }

  switchSelectedType(): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    const selected = new Set(
      this.selectedElements()
        .filter((element) => !element.locked)
        .map((element) => element.id),
    );
    if (!board || !selected.size) return;
    const before = this.cloneElements(board.elements);
    const elements = board.elements.map((element) =>
      selected.has(element.id) ? this.convertElementType(element) : element,
    );
    if (this.sameElements(before, elements)) return;
    this.saveElements(elements, before);
  }

  selectionHasLockedItems(): boolean {
    const selected = this.selectedElements();
    return selected.length > 0 && selected.every((element) => element.locked);
  }

  canSwitchSelectionType(): boolean {
    const selected = this.selectedElements();
    return (
      selected.length > 0 &&
      selected.every(
        (element) =>
          !element.locked &&
          ["note", "text", "shape", "card"].includes(element.type),
      )
    );
  }

  deleteSelection(): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    if (!board) return;
    const selectedIds = new Set(this.selectedElementIds());
    const selected = new Set(
      board.elements
        .filter((element) => selectedIds.has(element.id) && !element.locked)
        .map((element) => element.id),
    );
    if (!selected.size) return;
    const elements = this.removeElements(board.elements, selected);
    if (elements.length === board.elements.length) return;
    this.setSelection([...selectedIds].filter((id) => !selected.has(id)));
    this.saveElements(elements, this.cloneElements(board.elements));
  }

  duplicateSelection(): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    const selected = this.selectedElements();
    if (!board || !selected.length) return;
    const sourceIds = new Set(selected.map((element) => element.id));
    for (const element of selected) {
      if (element.type === "frame") {
        this.elementsInFrame(element, board.elements).forEach((id) =>
          sourceIds.add(id),
        );
      }
    }
    const source = board.elements.filter((element) =>
      sourceIds.has(element.id),
    );
    if (board.elements.length + source.length > 500) {
      this.errorMessage.set("This board can hold at most 500 items.");
      return;
    }
    let offset: BoardPoint = { x: 0, y: 0 };
    const memory = this.duplicateMemory;
    const selectedIds = this.selectedElementIds();
    if (
      memory &&
      selectedIds.length === memory.latestIds.length &&
      selectedIds.every((id, index) => id === memory.latestIds[index])
    ) {
      const current = source.find((element) => element.id === selectedIds[0]);
      const initial = memory.positions[selectedIds[0] ?? ""];
      if (current && initial) {
        const moved = { x: current.x - initial.x, y: current.y - initial.y };
        offset =
          Math.abs(moved.x) + Math.abs(moved.y) > 0.05 ? moved : memory.offset;
      } else {
        offset = memory.offset;
      }
    }
    const copies = this.cloneWithNewIds(source, offset);
    const before = this.cloneElements(board.elements);
    this.saveElements([...board.elements, ...copies], before);
    this.setSelection(copies.map((element) => element.id));
    this.duplicateMemory = {
      latestIds: copies.map((element) => element.id),
      positions: Object.fromEntries(
        copies.map((element) => [element.id, { x: element.x, y: element.y }]),
      ),
      offset,
    };
  }

  zoomCanvas(event: WheelEvent): void {
    event.preventDefault();
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return;
    if (
      (this.inputMode() === "trackpad" && !event.ctrlKey && !event.metaKey) ||
      (event.shiftKey && !event.ctrlKey && !event.metaKey)
    ) {
      const view = this.viewport();
      this.viewport.set({
        ...view,
        x: view.x - event.deltaX,
        y: view.y - event.deltaY,
      });
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left - bounds.width / 2;
    const pointerY = event.clientY - bounds.top - bounds.height / 2;
    const view = this.viewport();
    const zoom = Math.max(
      0.3,
      Math.min(2.5, view.zoom * Math.exp(-event.deltaY * 0.001)),
    );
    const worldX = (pointerX - view.x) / view.zoom;
    const worldY = (pointerY - view.y) / view.zoom;
    this.viewport.set({
      x: pointerX - worldX * zoom,
      y: pointerY - worldY * zoom,
      zoom,
    });
  }

  onCanvasPointerDown(event: PointerEvent): void {
    this.contextMenu.set(null);
    if (
      event.button === 2 ||
      event.button === 1 ||
      (event.button === 0 &&
        (this.spaceHandActive() || this.selectedTool() === "hand"))
    ) {
      event.preventDefault();
      this.canvasPan = {
        pointerId: event.pointerId,
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        targetId: this.elementIdAtPoint(event.clientX, event.clientY),
        moved: false,
      };
      this.canvasPanning.set(true);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || !this.canEdit() || this.isSaving()) return;
    const tool = this.selectedTool();
    const point = this.pointerToBoardPoint(event.clientX, event.clientY);
    event.preventDefault();
    if (tool === "pen") {
      this.beginLocalEdit();
      this.drawingPointerId = event.pointerId;
      this.drawingPoints.set([point]);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } else if (tool === "select" || tool === "lasso") {
      this.gesture = {
        pointerId: event.pointerId,
        tool,
        start: point,
        current: point,
        ...(tool === "lasso" ? { points: [point] } : {}),
      };
      if (tool === "lasso") {
        this.lassoPoints.set([point]);
      } else {
        this.selectionRectangle.set({
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
        });
      }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } else if (tool === "eraser") {
      this.beginEraserGesture(event, point);
    } else if (tool === "line") {
      this.beginLineGesture(
        event,
        point,
        this.elementIdAtPoint(event.clientX, event.clientY) ?? undefined,
      );
    } else if (this.isCreationTool(tool)) {
      this.gesture = {
        pointerId: event.pointerId,
        tool,
        start: point,
        current: point,
      };
      this.updateCreationRectangle(point, point);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
  }

  onCanvasPointerMove(event: PointerEvent): void {
    if (this.canvasPan?.pointerId === event.pointerId) {
      const previous = this.canvasPan;
      const view = this.viewport();
      const moved =
        previous.moved ||
        Math.hypot(
          event.clientX - previous.startX,
          event.clientY - previous.startY,
        ) > 3;
      this.viewport.set({
        ...view,
        x: view.x + event.clientX - previous.clientX,
        y: view.y + event.clientY - previous.clientY,
      });
      this.pointerToBoardPoint(event.clientX, event.clientY);
      this.canvasPan = {
        pointerId: event.pointerId,
        button: previous.button,
        clientX: event.clientX,
        clientY: event.clientY,
        startX: previous.startX,
        startY: previous.startY,
        targetId: previous.targetId,
        moved,
      };
      return;
    }
    const point = this.pointerToBoardPoint(event.clientX, event.clientY);
    if (this.drawingPointerId === event.pointerId) {
      const points = this.drawingPoints();
      const previous = points[points.length - 1];
      if (
        previous &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 0.15
      ) {
        return;
      }
      this.appendDrawingPoint(point);
      return;
    }
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.gesture.current = point;
    if (this.gesture.tool === "select") {
      this.updateSelectionRectangle(this.gesture.start, point);
    } else if (this.gesture.tool === "lasso") {
      const points = this.gesture.points ?? [];
      const last = points[points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.2) {
        this.gesture.points = [...points, point];
        this.lassoPoints.set(this.gesture.points);
      }
    } else if (this.gesture.tool === "line") {
      this.linePreview.set({ start: this.gesture.start, end: point });
    } else if (this.gesture.tool === "eraser") {
      this.eraseStrokeAt(event.clientX, event.clientY);
    } else if (this.isCreationTool(this.gesture.tool)) {
      this.updateCreationRectangle(this.gesture.start, point);
    }
  }

  onCanvasPointerUp(event: PointerEvent): void {
    if (this.canvasPan?.pointerId === event.pointerId) {
      const pan = this.canvasPan;
      this.canvasPan = undefined;
      this.canvasPanning.set(false);
      if (pan.button === 2 && !pan.moved) {
        const bounds = this.canvas?.nativeElement.getBoundingClientRect();
        if (bounds) {
          this.contextMenu.set({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
            targetId: pan.targetId,
          });
        }
      }
      if (pan.button === 0) this.suppressNextClick = true;
      return;
    }
    if (this.drawingPointerId === event.pointerId) {
      this.drawingPointerId = undefined;
      const points = [...this.drawingPoints()];
      const finalPoint = this.pointerToBoardPoint(event.clientX, event.clientY);
      const lastPoint = points[points.length - 1];
      if (
        !lastPoint ||
        Math.hypot(finalPoint.x - lastPoint.x, finalPoint.y - lastPoint.y) >=
          0.15
      ) {
        if (points.length < 512) points.push(finalPoint);
      }
      this.drawingPoints.set([]);
      this.suppressNextClick = true;
      if (points.length < 2) {
        this.hasLocalEdit = false;
        this.finishPendingRefresh();
        return;
      }
      this.addElements([this.createStroke(points)], "pen");
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.current = this.pointerToBoardPoint(event.clientX, event.clientY);
    this.gesture = undefined;
    this.suppressNextClick = true;
    this.creationRectangle.set(null);
    this.selectionRectangle.set(null);
    if (gesture.tool === "select") {
      this.selectWithin(gesture.start, gesture.current);
    } else if (gesture.tool === "lasso") {
      this.selectWithinLasso(gesture.points ?? []);
      this.lassoPoints.set([]);
    } else if (gesture.tool === "line") {
      this.finishLineGesture(gesture, event.clientX, event.clientY);
    } else if (gesture.tool === "eraser") {
      const before = this.eraseBefore;
      this.eraseBefore = undefined;
      this.hasLocalEdit = false;
      const board = this.board();
      if (board && before && !this.sameElements(before, board.elements)) {
        this.saveElements(board.elements, before);
      } else {
        this.finishPendingRefresh();
      }
    } else if (this.isCreationTool(gesture.tool)) {
      this.finishCreationGesture(gesture);
    }
  }

  onCanvasClick(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    if (this.contextMenu()) {
      this.contextMenu.set(null);
      return;
    }
    if (this.isSample || this.isSaving()) {
      return;
    }
    const tool = this.selectedTool();
    if (tool === "select") {
      this.setSelection([]);
      return;
    }
    if (tool === "hand" || !this.canEdit()) return;
    const board = this.board();
    if (!board) return;
    const point = this.pointerToBoardPoint(event.clientX, event.clientY);
    if (tool === "line") {
      return;
    }
    if (tool === "pen" || tool === "eraser" || tool === "lasso") return;
    if (this.isCreationTool(tool)) {
      this.finishCreationGesture({
        pointerId: -1,
        tool,
        start: point,
        current: point,
      });
    }
  }

  startElementDrag(element: BoardElement, event: PointerEvent): void {
    if (event.button === 2 || event.button === 1) return;
    if (!this.canEdit() || this.isSaving()) return;
    if (element.locked && this.selectedTool() !== "line") {
      event.stopPropagation();
      return;
    }
    if (this.selectedTool() === "comment" && element.type === "comment") {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("textarea, input")
      ) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.setSelection([element.id]);
      this.focusEditableElement(element.id);
      return;
    }
    if (this.selectedTool() === "line" && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      this.beginLineGesture(
        event,
        this.pointerToBoardPoint(event.clientX, event.clientY),
        element.id,
      );
      return;
    }
    if (this.selectedTool() === "eraser" && element.type === "stroke") {
      event.preventDefault();
      event.stopPropagation();
      this.beginEraserGesture(
        event,
        this.pointerToBoardPoint(event.clientX, event.clientY),
      );
      this.eraseStrokeAt(event.clientX, event.clientY);
      return;
    }
    if (
      event.button !== 0 ||
      this.selectedTool() !== "select" ||
      this.spaceHandActive()
    ) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("textarea, input") &&
      this.editingElementId() === element.id
    ) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const board = this.board();
    if (!board) return;
    const selectedIds = this.selectedElementIds();
    const ids = selectedIds.includes(element.id)
      ? selectedIds
      : event.ctrlKey || event.metaKey || event.shiftKey
        ? [...selectedIds, element.id]
        : [element.id];
    this.setSelection(ids);
    const dragIds = [
      ...new Set([
        ...ids,
        ...(element.type === "frame"
          ? this.elementsInFrame(element, board.elements)
          : []),
      ]),
    ].filter(
      (id) => !board.elements.find((candidate) => candidate.id === id)?.locked,
    );
    let before = this.cloneElements(board.elements);
    const saveBefore = this.cloneElements(board.elements);
    let movingIds = dragIds;
    if (event.altKey) {
      const sourceElements = board.elements.filter((candidate) =>
        dragIds.includes(candidate.id),
      );
      const copies = this.cloneWithNewIds(sourceElements, { x: 0, y: 0 });
      if (board.elements.length + copies.length > 500) {
        this.errorMessage.set("This board can hold at most 500 items.");
        return;
      }
      const copiedBoard = {
        ...board,
        elements: [...board.elements, ...copies],
      };
      this.board.set(copiedBoard);
      this.setSelection(copies.map((copy) => copy.id));
      movingIds = copies.map((copy) => copy.id);
      before = this.cloneElements(copiedBoard.elements);
    }
    this.elementDrag = {
      ids: movingIds,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      before,
      saveBefore,
    };
    this.pendingElementClickId = element.id;
    this.draggingElementId.set(movingIds[0] ?? element.id);
    this.beginLocalEdit();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  moveElement(event: PointerEvent): void {
    const drag = this.elementDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const board = this.board();
    if (!board) return;
    const zoom = this.viewport().zoom;
    let dx = ((event.clientX - drag.clientX) / zoom / sceneWidth) * 100;
    let dy = ((event.clientY - drag.clientY) / zoom / sceneHeight) * 100;
    const moveIds = new Set(drag.ids);
    const beforeById = new Map(drag.before.map((item) => [item.id, item]));
    const primary = beforeById.get(this.draggingElementId() ?? "");
    const verticalGuides: number[] = [];
    const horizontalGuides: number[] = [];
    if (primary) {
      const bounds = this.elementBounds(primary);
      const snapThresholdX = (8 / (sceneWidth * zoom)) * 100;
      const vertical = this.findSnap(
        [
          bounds.left + dx,
          (bounds.left + bounds.right) / 2 + dx,
          bounds.right + dx,
        ],
        board.elements
          .filter((element) => !moveIds.has(element.id))
          .flatMap((element) => {
            const other = this.elementBounds(element);
            return [other.left, (other.left + other.right) / 2, other.right];
          }),
        snapThresholdX,
      );
      if (vertical) {
        dx += vertical.adjustment;
        verticalGuides.push(vertical.position);
      }
      const movingLeft = bounds.left + dx;
      const movingWidth = bounds.right - bounds.left;
      const movingCenterY = (bounds.top + bounds.bottom) / 2 + dy;
      const rowThreshold = (8 / (sceneHeight * zoom)) * 100;
      const horizontalNeighbors = board.elements
        .filter(
          (element) =>
            !moveIds.has(element.id) &&
            element.type !== "line" &&
            element.type !== "stroke",
        )
        .map((element) => this.elementBounds(element))
        .sort((first, second) => first.left - second.left);
      let equalSpacingSnap:
        { adjustment: number; left: number; right: number } | undefined;
      for (let index = 0; index < horizontalNeighbors.length - 1; index += 1) {
        const left = horizontalNeighbors[index];
        const right = horizontalNeighbors[index + 1];
        if (
          !left ||
          !right ||
          left.right > right.left ||
          right.left - left.right < movingWidth ||
          Math.abs((left.top + left.bottom - right.top - right.bottom) / 2) >
            rowThreshold ||
          Math.abs(movingCenterY - (left.top + left.bottom) / 2) > rowThreshold
        ) {
          continue;
        }
        const targetLeft =
          left.right + (right.left - left.right - movingWidth) / 2;
        const adjustment = targetLeft - movingLeft;
        if (
          Math.abs(adjustment) <= snapThresholdX &&
          (!equalSpacingSnap ||
            Math.abs(adjustment) < Math.abs(equalSpacingSnap.adjustment))
        ) {
          equalSpacingSnap = {
            adjustment,
            left: left.right,
            right: right.left,
          };
        }
      }
      if (equalSpacingSnap) {
        dx += equalSpacingSnap.adjustment;
        verticalGuides.push(equalSpacingSnap.left, equalSpacingSnap.right);
      }
      const horizontal = this.findSnap(
        [
          bounds.top + dy,
          (bounds.top + bounds.bottom) / 2 + dy,
          bounds.bottom + dy,
        ],
        board.elements
          .filter((element) => !moveIds.has(element.id))
          .flatMap((element) => {
            const other = this.elementBounds(element);
            return [other.top, (other.top + other.bottom) / 2, other.bottom];
          }),
        (8 / (sceneHeight * zoom)) * 100,
      );
      if (horizontal) {
        dy += horizontal.adjustment;
        horizontalGuides.push(horizontal.position);
      }
    }
    this.alignmentGuides.set({
      vertical: [...new Set(verticalGuides)],
      horizontal: [...new Set(horizontalGuides)],
    });
    this.board.set({
      ...board,
      elements: board.elements.map((element) => {
        if (moveIds.has(element.id)) {
          const original = beforeById.get(element.id) ?? element;
          if (element.type === "line") {
            if (original.type !== "line") return element;
            return {
              ...element,
              x: this.clampCoordinate(original.x + dx),
              y: this.clampCoordinate(original.y + dy),
              endX: this.clampCoordinate(original.endX + dx),
              endY: this.clampCoordinate(original.endY + dy),
            };
          }
          return {
            ...element,
            x: this.clampCoordinate(original.x + dx),
            y: this.clampCoordinate(original.y + dy),
          };
        }
        if (element.type === "line") {
          const original = beforeById.get(element.id);
          if (!original || original.type !== "line") return element;
          return {
            ...element,
            x: moveIds.has(element.startElementId ?? "")
              ? this.clampCoordinate(original.x + dx)
              : original.x,
            y: moveIds.has(element.startElementId ?? "")
              ? this.clampCoordinate(original.y + dy)
              : original.y,
            endX: moveIds.has(element.endElementId ?? "")
              ? this.clampCoordinate(original.endX + dx)
              : original.endX,
            endY: moveIds.has(element.endElementId ?? "")
              ? this.clampCoordinate(original.endY + dy)
              : original.endY,
          };
        }
        return element;
      }),
    });
  }

  finishElementDrag(event: PointerEvent): void {
    const drag = this.elementDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.elementDrag = undefined;
    this.draggingElementId.set(null);
    this.alignmentGuides.set({ vertical: [], horizontal: [] });
    const clickedId = this.pendingElementClickId;
    globalThis.setTimeout(() => {
      if (this.pendingElementClickId === clickedId) {
        this.pendingElementClickId = undefined;
      }
    }, 0);
    const board = this.board();
    this.hasLocalEdit = false;
    if (!board) {
      this.finishPendingRefresh();
      return;
    }
    const moved = !this.sameElements(drag.saveBefore, board.elements);
    if (moved) {
      this.saveElements(board.elements, drag.saveBefore);
    } else {
      this.finishPendingRefresh();
    }
  }

  private isCreationTool(tool: BoardTool): tool is PlacementTool {
    return (
      tool === "note" ||
      tool === "text" ||
      tool === "card" ||
      tool === "shape" ||
      tool === "frame" ||
      tool === "sticker" ||
      tool === "comment"
    );
  }

  private finishCreationGesture(gesture: PointerGesture): void {
    if (!this.isCreationTool(gesture.tool)) return;
    const element = this.createElement(
      gesture.tool,
      gesture.start.x,
      gesture.start.y,
    );
    const dragged =
      Math.hypot(
        ((gesture.current.x - gesture.start.x) * sceneWidth) / 100,
        ((gesture.current.y - gesture.start.y) * sceneHeight) / 100,
      ) > 6;
    const created = dragged
      ? this.resizeCreatedElement(element, gesture.start, gesture.current)
      : element;
    this.addElements([created], gesture.tool);
  }

  private resizeCreatedElement(
    element: BoardElement,
    start: BoardPoint,
    end: BoardPoint,
  ): BoardElement {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.max(0.5, Math.abs(end.x - start.x));
    const height = Math.max(0.5, Math.abs(end.y - start.y));
    switch (element.type) {
      case "note":
      case "text":
      case "card":
      case "shape":
      case "frame":
        return {
          ...element,
          x,
          y,
          width,
          height,
          ...(element.type === "text" ? { autoWidth: false } : {}),
        };
      default:
        return element;
    }
  }

  private addElements(elements: BoardElement[], tool: BoardTool): void {
    const board = this.board();
    if (!board) return;
    this.saveElements(
      [...board.elements, ...elements],
      this.cloneElements(board.elements),
    );
    this.setSelection(elements.map((element) => element.id));
    const editableElement = elements.find(
      (element) =>
        element.type === "note" ||
        element.type === "text" ||
        element.type === "card" ||
        element.type === "comment",
    );
    if (editableElement) this.focusEditableElement(editableElement.id);
    if (!["comment", "pen", "eraser", "lasso", "hand"].includes(tool)) {
      this.selectedTool.set("select");
    }
  }

  private focusEditableElement(id: string): void {
    if (this.isSaving()) {
      this.pendingFocusElementId = id;
      return;
    }
    this.editingElementId.set(id);
    this.setTimeout(() => {
      const element = this.canvas?.nativeElement.querySelector<HTMLElement>(
        `[data-element-id="${id}"] textarea, [data-element-id="${id}"] input`,
      );
      element?.focus();
    });
  }

  private setTimeout(callback: () => void): void {
    globalThis.setTimeout(callback, 0);
  }

  private beginLineGesture(
    event: PointerEvent,
    point: BoardPoint,
    startElementId?: string,
  ): void {
    let start = point;
    if (startElementId) {
      const element = this.board()?.elements.find(
        (candidate) => candidate.id === startElementId,
      );
      if (element) start = this.edgePoint(element, point);
    }
    this.gesture = {
      pointerId: event.pointerId,
      tool: "line",
      start,
      current: point,
      ...(startElementId ? { startElementId } : {}),
    };
    this.linePreview.set({ start, end: point });
    this.canvas?.nativeElement.setPointerCapture(event.pointerId);
  }

  private finishLineGesture(
    gesture: PointerGesture,
    clientX: number,
    clientY: number,
  ): void {
    const board = this.board();
    if (!board) return;
    const targetId = this.elementIdAtPoint(clientX, clientY);
    const target = board.elements.find((element) => element.id === targetId);
    const end = target
      ? this.edgePoint(target, gesture.current)
      : gesture.current;
    const line = {
      id: crypto.randomUUID(),
      type: "line" as const,
      x: gesture.start.x,
      y: gesture.start.y,
      endX: end.x,
      endY: end.y,
      startElementId: gesture.startElementId ?? null,
      endElementId: target?.id ?? null,
      color: "rose" as NoteColor,
      strokeWidth: 2,
    };
    this.linePreview.set(null);
    this.addElements([line], "line");
  }

  private beginEraserGesture(event: PointerEvent, point: BoardPoint): void {
    const board = this.board();
    if (!board) return;
    this.eraseBefore ??= this.cloneElements(board.elements);
    this.gesture = {
      pointerId: event.pointerId,
      tool: "eraser",
      start: point,
      current: point,
    };
    this.beginLocalEdit();
    this.canvas?.nativeElement.setPointerCapture(event.pointerId);
  }

  private eraseStrokeAt(clientX: number, clientY: number): void {
    const id = this.elementIdAtPoint(clientX, clientY);
    if (!id) return;
    const board = this.board();
    if (
      !board?.elements.some(
        (element) =>
          element.id === id && element.type === "stroke" && !element.locked,
      )
    ) {
      return;
    }
    this.board.set({
      ...board,
      elements: this.removeElements(board.elements, new Set([id])),
    });
  }

  private updateSelectionRectangle(start: BoardPoint, end: BoardPoint): void {
    this.selectionRectangle.set(this.normalizedRectangle(start, end));
  }

  private updateCreationRectangle(start: BoardPoint, end: BoardPoint): void {
    this.creationRectangle.set(this.normalizedRectangle(start, end));
  }

  private findSnap(
    moving: number[],
    targets: number[],
    threshold: number,
  ): { adjustment: number; position: number } | null {
    let best: { adjustment: number; position: number } | null = null;
    for (const value of moving) {
      for (const target of targets) {
        const adjustment = target - value;
        if (
          Math.abs(adjustment) <= threshold &&
          (!best || Math.abs(adjustment) < Math.abs(best.adjustment))
        ) {
          best = { adjustment, position: target };
        }
      }
    }
    return best;
  }

  private normalizedRectangle(
    start: BoardPoint,
    end: BoardPoint,
  ): { x: number; y: number; width: number; height: number } {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  private selectWithin(start: BoardPoint, end: BoardPoint): void {
    const rectangle = this.normalizedRectangle(start, end);
    if (rectangle.width < 0.1 && rectangle.height < 0.1) {
      this.setSelection([]);
      return;
    }
    const right = rectangle.x + rectangle.width;
    const bottom = rectangle.y + rectangle.height;
    const selected = (this.board()?.elements ?? [])
      .filter((element) => {
        const bounds = this.elementBounds(element);
        return (
          bounds.right >= rectangle.x &&
          bounds.left <= right &&
          bounds.bottom >= rectangle.y &&
          bounds.top <= bottom
        );
      })
      .map((element) => element.id);
    this.setSelection(selected);
  }

  private selectWithinLasso(points: BoardPoint[]): void {
    if (points.length < 3) {
      this.setSelection([]);
      return;
    }
    const selected = (this.board()?.elements ?? [])
      .filter((element) => {
        const bounds = this.elementBounds(element);
        const center = {
          x: (bounds.left + bounds.right) / 2,
          y: (bounds.top + bounds.bottom) / 2,
        };
        let inside = false;
        for (
          let index = 0, previous = points.length - 1;
          index < points.length;
          previous = index++
        ) {
          const currentPoint = points[index];
          const previousPoint = points[previous];
          const crosses =
            currentPoint.y > center.y !== previousPoint.y > center.y &&
            center.x <
              ((previousPoint.x - currentPoint.x) *
                (center.y - currentPoint.y)) /
                (previousPoint.y - currentPoint.y) +
                currentPoint.x;
          if (crosses) inside = !inside;
        }
        return inside;
      })
      .map((element) => element.id);
    this.setSelection(selected);
  }

  private elementBounds(element: BoardElement): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    if (element.type === "line") {
      return {
        left: Math.min(element.x, element.endX),
        top: Math.min(element.y, element.endY),
        right: Math.max(element.x, element.endX),
        bottom: Math.max(element.y, element.endY),
      };
    }
    const width = this.itemWidth(element);
    const height = this.itemHeight(element) ?? 4;
    return {
      left: element.x,
      top: element.y,
      right: element.x + width,
      bottom: element.y + height,
    };
  }

  private elementsInFrame(
    frame: Extract<BoardElement, { type: "frame" }>,
    elements: BoardElement[],
  ): string[] {
    const frameBounds = this.elementBounds(frame);
    return [
      frame.id,
      ...elements
        .filter((element) => {
          if (element.id === frame.id) return false;
          const bounds = this.elementBounds(element);
          const centerX = (bounds.left + bounds.right) / 2;
          const centerY = (bounds.top + bounds.bottom) / 2;
          return (
            centerX >= frameBounds.left &&
            centerX <= frameBounds.right &&
            centerY >= frameBounds.top &&
            centerY <= frameBounds.bottom
          );
        })
        .map((element) => element.id),
    ];
  }

  private edgePoint(element: BoardElement, point: BoardPoint): BoardPoint {
    if (element.type === "line" || element.type === "stroke") return point;
    const bounds = this.elementBounds(element);
    const candidates = [
      {
        x: bounds.left,
        y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
      },
      {
        x: bounds.right,
        y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
      },
      {
        x: Math.max(bounds.left, Math.min(bounds.right, point.x)),
        y: bounds.top,
      },
      {
        x: Math.max(bounds.left, Math.min(bounds.right, point.x)),
        y: bounds.bottom,
      },
    ];
    return candidates.reduce((nearest, candidate) =>
      Math.hypot(candidate.x - point.x, candidate.y - point.y) <
      Math.hypot(nearest.x - point.x, nearest.y - point.y)
        ? candidate
        : nearest,
    );
  }

  private elementIdAtPoint(clientX: number, clientY: number): string | null {
    const target = document.elementFromPoint(clientX, clientY);
    const item = target?.closest<HTMLElement>("[data-element-id]");
    return item?.dataset["elementId"] ?? null;
  }

  private clampCoordinate(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  private cancelGesture(): void {
    if (this.elementDrag) {
      const board = this.board();
      if (board) {
        this.board.set({ ...board, elements: this.elementDrag.saveBefore });
      }
    }
    if (this.eraseBefore) {
      const board = this.board();
      if (board) this.board.set({ ...board, elements: this.eraseBefore });
    }
    this.eraseBefore = undefined;
    this.gesture = undefined;
    this.elementDrag = undefined;
    this.canvasPan = undefined;
    this.drawingPointerId = undefined;
    this.drawingPoints.set([]);
    this.lassoPoints.set([]);
    this.selectionRectangle.set(null);
    this.creationRectangle.set(null);
    this.linePreview.set(null);
    this.canvasPanning.set(false);
    this.draggingElementId.set(null);
    this.alignmentGuides.set({ vertical: [], horizontal: [] });
    this.hasLocalEdit = false;
  }

  beginTextEdit(id?: string): void {
    if (!this.canEdit() || this.isSaving()) return;
    if (id && this.editingElementId() !== id) return;
    this.textEditBefore = this.cloneElements(this.board()?.elements ?? []);
    this.beginLocalEdit();
  }

  changeElementText(id: string, text: string): void {
    if (!this.canEdit() || this.isSaving()) return;
    this.updateElementLocally(id, (element) => {
      switch (element.type) {
        case "note":
        case "card":
        case "comment":
        case "shape":
          return { ...element, text };
        case "text":
          return {
            ...element,
            text,
            ...(element.autoWidth ? { width: this.autoTextWidth(text) } : {}),
          };
        default:
          return element;
      }
    });
  }

  changeElementTitle(id: string, title: string): void {
    if (!this.canEdit() || this.isSaving()) return;
    this.updateElementLocally(id, (element) =>
      "title" in element ? { ...element, title } : element,
    );
  }

  saveTextEdit(): void {
    const before = this.textEditBefore;
    this.textEditBefore = undefined;
    this.hasLocalEdit = false;
    this.editingElementId.set(null);
    const board = this.board();
    if (!board || !before || this.sameElements(before, board.elements)) {
      this.finishPendingRefresh();
      return;
    }
    this.saveElements(board.elements, before);
  }

  removeElement(id: string): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    if (!board) return;
    if (board.elements.find((element) => element.id === id)?.locked) return;
    const elements = this.removeElements(board.elements, new Set([id]));
    if (elements.length === board.elements.length) return;
    this.setSelection(
      this.selectedElementIds().filter((selectedId) => selectedId !== id),
    );
    this.saveElements(elements, this.cloneElements(board.elements));
  }

  undo(): void {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry || !this.canUndo()) return;
    const board = this.board();
    if (!board) return;
    this.saveElements(entry.before, this.cloneElements(board.elements), () => {
      this.undoStack.pop();
      this.redoStack.push(entry);
      this.updateHistoryDepths();
    });
  }

  redo(): void {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry || !this.canRedo()) return;
    const board = this.board();
    if (!board) return;
    this.saveElements(entry.after, this.cloneElements(board.elements), () => {
      this.redoStack.pop();
      this.undoStack.push(entry);
      this.trimHistory();
      this.updateHistoryDepths();
    });
  }

  itemWidth(element: BoardElement): number {
    switch (element.type) {
      case "text":
      case "card":
      case "shape":
      case "frame":
        return element.type === "text" && element.autoWidth
          ? this.autoTextWidth(element.text)
          : element.width;
      case "stroke":
        return element.width;
      case "line":
        return Math.max(0.5, Math.abs(element.endX - element.x));
      case "note":
        return element.width ?? 10;
      case "sticker":
        return 5;
      case "comment":
        return 3;
    }
  }

  itemHeight(element: BoardElement): number | null {
    switch (element.type) {
      case "card":
      case "shape":
      case "stroke":
      case "frame":
        return element.height;
      case "line":
        return Math.max(0.5, Math.abs(element.endY - element.y));
      case "text":
        return element.autoWidth
          ? this.autoTextHeight(element.text, this.autoTextWidth(element.text))
          : (element.height ?? null);
      case "note":
        return element.height ?? 15;
      case "sticker":
        return 5;
      case "comment":
        return 3;
    }
  }

  itemLeft(element: BoardElement): number {
    return element.type === "line"
      ? Math.min(element.x, element.endX)
      : element.x;
  }

  itemTop(element: BoardElement): number {
    return element.type === "line"
      ? Math.min(element.y, element.endY)
      : element.y;
  }

  lineCoordinate(
    line: Extract<BoardElement, { type: "line" }>,
    axis: "x" | "y",
    endpoint: "start" | "end",
  ): number {
    const start = axis === "x" ? line.x : line.y;
    const end = axis === "x" ? line.endX : line.endY;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    if (upper - lower < 0.5) return 50;
    const value = endpoint === "start" ? start : end;
    return value === lower ? 0 : 100;
  }

  itemClass(element: BoardElement): string {
    const shapeClass =
      element.type === "shape" ? ` shape-${element.shape}` : "";
    return `board-item ${element.type}-item${shapeClass}${"color" in element ? ` item-${element.color}` : ""}`;
  }

  colorValue(color: NoteColor): string {
    return {
      cream: "#d5a928",
      rose: "#c75d71",
      sage: "#548a5e",
      sky: "#4b82b8",
    }[color];
  }

  strokePointString(stroke: Extract<BoardElement, { type: "stroke" }>): string {
    return stroke.points.map((point) => `${point.x},${point.y}`).join(" ");
  }

  drawingPointString(points = this.drawingPoints()): string {
    return points.map((point) => `${point.x},${point.y}`).join(" ");
  }

  private selectedElements(): BoardElement[] {
    const ids = new Set(this.selectedElementIds());
    return (this.board()?.elements ?? []).filter((element) =>
      ids.has(element.id),
    );
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      !!target.closest(
        "input:not([readonly]), textarea:not([readonly]), select, [contenteditable='true'], [role='textbox']",
      )
    );
  }

  private parseClipboardElements(text: string): BoardElement[] | null {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const payload = value as Record<string, unknown>;
    const elements = payload["elements"];
    if (
      payload["format"] !== "pinit-elements-v1" ||
      !Array.isArray(elements) ||
      !elements.every((element) => this.isClipboardElement(element))
    ) {
      return null;
    }
    return elements;
  }

  private isClipboardElement(value: unknown): value is BoardElement {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const element = value as Record<string, unknown>;
    if (
      typeof element["id"] !== "string" ||
      typeof element["x"] !== "number" ||
      typeof element["y"] !== "number" ||
      (element["locked"] !== undefined &&
        typeof element["locked"] !== "boolean")
    ) {
      return false;
    }
    switch (element["type"]) {
      case "note":
        return (
          typeof element["text"] === "string" &&
          this.isNoteColor(element["color"])
        );
      case "text":
        return (
          typeof element["text"] === "string" &&
          typeof element["width"] === "number" &&
          this.isNoteColor(element["color"])
        );
      case "card":
        return (
          typeof element["title"] === "string" &&
          typeof element["text"] === "string" &&
          typeof element["width"] === "number" &&
          typeof element["height"] === "number"
        );
      case "shape":
        return (
          typeof element["shape"] === "string" &&
          typeof element["width"] === "number" &&
          typeof element["height"] === "number" &&
          this.isNoteColor(element["color"])
        );
      case "stroke":
        return (
          typeof element["width"] === "number" &&
          typeof element["height"] === "number" &&
          Array.isArray(element["points"]) &&
          this.isNoteColor(element["color"]) &&
          typeof element["strokeWidth"] === "number"
        );
      case "line":
        return (
          typeof element["endX"] === "number" &&
          typeof element["endY"] === "number" &&
          (element["startElementId"] === null ||
            typeof element["startElementId"] === "string") &&
          (element["endElementId"] === null ||
            typeof element["endElementId"] === "string") &&
          this.isNoteColor(element["color"]) &&
          typeof element["strokeWidth"] === "number"
        );
      case "sticker":
        return typeof element["emoji"] === "string";
      case "comment":
        return typeof element["text"] === "string";
      case "frame":
        return (
          typeof element["title"] === "string" &&
          typeof element["width"] === "number" &&
          typeof element["height"] === "number"
        );
      default:
        return false;
    }
  }

  private isNoteColor(value: unknown): value is NoteColor {
    return (
      value === "rose" ||
      value === "cream" ||
      value === "sage" ||
      value === "sky"
    );
  }

  private pasteElements(source: BoardElement[]): void {
    const board = this.board();
    if (!board || board.elements.length + source.length > 500) {
      this.errorMessage.set("This board can hold at most 500 items.");
      return;
    }
    const sourceBounds = source.map((element) => this.elementBounds(element));
    const left = Math.min(...sourceBounds.map((bounds) => bounds.left));
    const top = Math.min(...sourceBounds.map((bounds) => bounds.top));
    const copies = this.cloneWithNewIds(source, {
      x: this.lastPointerPoint.x - left,
      y: this.lastPointerPoint.y - top,
    });
    this.insertCopies(copies);
  }

  private pasteGrid(grid: string[][]): void {
    const board = this.board();
    const cellCount = grid.reduce((total, row) => total + row.length, 0);
    if (!board || !cellCount) return;
    if (board.elements.length + cellCount > 500) {
      this.errorMessage.set("This board can hold at most 500 items.");
      return;
    }
    if (grid.some((row) => row.some((cell) => cell.length > 2000))) {
      this.errorMessage.set("A pasted cell is longer than 2,000 characters.");
      return;
    }
    const startX = Math.min(this.lastPointerPoint.x, 100 - 10);
    const startY = Math.min(this.lastPointerPoint.y, 100 - 15);
    const notes: BoardElement[] = [];
    grid.forEach((row, rowIndex) => {
      row.forEach((text, columnIndex) => {
        const element = this.createElement(
          "note",
          this.clampCoordinate(startX + columnIndex * 11),
          this.clampCoordinate(startY + rowIndex * 16),
        );
        if (element.type === "note") {
          notes.push({ ...element, text });
        }
      });
    });
    this.insertCopies(notes);
  }

  private insertCopies(copies: BoardElement[]): void {
    const board = this.board();
    if (!board || !copies.length) return;
    const before = this.cloneElements(board.elements);
    this.saveElements([...board.elements, ...copies], before);
    this.setSelection(copies.map((element) => element.id));
  }

  private cloneWithNewIds(
    source: BoardElement[],
    offset: BoardPoint,
  ): BoardElement[] {
    const ids = new Map(
      source.map((element) => [element.id, crypto.randomUUID()]),
    );
    return source.map((element) => {
      const position = {
        x: this.clampCoordinate(element.x + offset.x),
        y: this.clampCoordinate(element.y + offset.y),
      };
      const id = ids.get(element.id) ?? crypto.randomUUID();
      if (element.type === "line") {
        return {
          ...element,
          id,
          ...position,
          endX: this.clampCoordinate(element.endX + offset.x),
          endY: this.clampCoordinate(element.endY + offset.y),
          startElementId: ids.get(element.startElementId ?? "") ?? null,
          endElementId: ids.get(element.endElementId ?? "") ?? null,
        };
      }
      return { ...element, id, ...position };
    });
  }

  private fitElementsToScreen(elements: BoardElement[]): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return;
    if (!elements.length) {
      this.resetView();
      return;
    }
    const bounds = elements.map((element) => this.elementBounds(element));
    const left = Math.min(...bounds.map((entry) => entry.left));
    const top = Math.min(...bounds.map((entry) => entry.top));
    const right = Math.max(...bounds.map((entry) => entry.right));
    const bottom = Math.max(...bounds.map((entry) => entry.bottom));
    const width = Math.max(2, ((right - left) / 100) * sceneWidth);
    const height = Math.max(2, ((bottom - top) / 100) * sceneHeight);
    const viewportBounds = canvas.getBoundingClientRect();
    const zoom = Math.max(
      0.3,
      Math.min(
        2.5,
        (viewportBounds.width * 0.88) / width,
        (viewportBounds.height * 0.88) / height,
      ),
    );
    const centerX = ((left + right) / 2 / 100) * sceneWidth;
    const centerY = ((top + bottom) / 2 / 100) * sceneHeight;
    this.viewport.set({
      zoom,
      x: (sceneWidth / 2 - centerX) * zoom,
      y: (sceneHeight / 2 - centerY) * zoom,
    });
  }

  private convertElementType(element: BoardElement): BoardElement {
    const width = this.itemWidth(element);
    const height = this.itemHeight(element) ?? 10;
    const text =
      element.type === "card"
        ? [element.title, element.text].filter(Boolean).join("\n")
        : "text" in element
          ? (element.text ?? "")
          : "";
    const color =
      "color" in element && this.isNoteColor(element.color)
        ? element.color
        : "cream";
    if (element.type === "note") {
      return {
        id: element.id,
        type: "shape",
        shape: "rectangle",
        x: element.x,
        y: element.y,
        width,
        height,
        color: element.color,
        text: element.text,
        ...(element.locked === undefined ? {} : { locked: element.locked }),
      };
    }
    if (element.type === "shape") {
      return {
        id: element.id,
        type: "card",
        x: element.x,
        y: element.y,
        title: "Card",
        text,
        width,
        height,
        ...(element.locked === undefined ? {} : { locked: element.locked }),
      };
    }
    if (element.type === "card" || element.type === "text") {
      return {
        id: element.id,
        type: "note",
        x: element.x,
        y: element.y,
        text,
        color,
        width,
        height,
        ...(element.locked === undefined ? {} : { locked: element.locked }),
      };
    }
    return element;
  }

  private autoTextWidth(text: string): number {
    const longestLine = Math.max(
      0,
      ...text.split("\n").map((line) => line.length),
    );
    return Math.max(8, Math.min(40, 4 + longestLine * 0.38));
  }

  private autoTextHeight(text: string, width: number): number {
    const charactersPerLine = Math.max(8, ((width / 100) * sceneWidth) / 9);
    const lines = text
      .split("\n")
      .reduce(
        (count, line) =>
          count + Math.max(1, Math.ceil(line.length / charactersPerLine)),
        0,
      );
    return Math.max(4, lines * 1.8);
  }

  private createElement(
    tool: PlacementTool,
    x: number,
    y: number,
  ): BoardElement {
    const id = crypto.randomUUID();
    const elements: Record<PlacementTool, NewBoardElement> = {
      note: {
        type: "note",
        x,
        y,
        text: "",
        color: "cream",
        width: 10,
        height: 15,
      },
      text: {
        type: "text",
        x,
        y,
        text: "",
        color: "cream",
        width: 8,
        autoWidth: true,
      },
      card: {
        type: "card",
        x,
        y,
        title: "Card",
        text: "",
        width: 20,
        height: 16,
      },
      shape: {
        type: "shape",
        x,
        y,
        shape: this.shapeKind(),
        width: 12,
        height: 10,
        color: "sky",
      },
      frame: { type: "frame", x, y, title: "Frame", width: 40, height: 33.75 },
      sticker: { type: "sticker", x, y, emoji: "⭐" },
      comment: { type: "comment", x, y, text: "Add a comment…" },
    };
    const element = elements[tool];
    return { ...element, id };
  }

  private createStroke(points: BoardPoint[]): BoardElement {
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const width = Math.max(0.5, maxX - minX);
    const height = Math.max(0.5, maxY - minY);
    return {
      id: crypto.randomUUID(),
      type: "stroke",
      x: minX,
      y: minY,
      width,
      height,
      points: points.map((point) => ({
        x: Math.max(0, Math.min(100, ((point.x - minX) / width) * 100)),
        y: Math.max(0, Math.min(100, ((point.y - minY) / height) * 100)),
      })),
      color: "rose",
      strokeWidth: 2,
    };
  }

  private appendDrawingPoint(point: BoardPoint): void {
    const points = this.drawingPoints();
    this.drawingPoints.set(
      points.length < 512
        ? [...points, point]
        : [...points.filter((_, index) => index % 2 === 0), point],
    );
  }

  private removeElements(
    elements: BoardElement[],
    ids: Set<string>,
  ): BoardElement[] {
    return elements
      .filter((element) => !ids.has(element.id))
      .map((element) =>
        element.type === "line"
          ? {
              ...element,
              startElementId: ids.has(element.startElementId ?? "")
                ? null
                : element.startElementId,
              endElementId: ids.has(element.endElementId ?? "")
                ? null
                : element.endElementId,
            }
          : element,
      );
  }

  private pointerToBoardPoint(clientX: number, clientY: number): BoardPoint {
    const bounds = this.canvas?.nativeElement.getBoundingClientRect();
    if (!bounds) return { x: 50, y: 50 };
    const view = this.viewport();
    const worldX =
      (clientX - bounds.left - bounds.width / 2 - view.x) / view.zoom +
      sceneWidth / 2;
    const worldY =
      (clientY - bounds.top - bounds.height / 2 - view.y) / view.zoom +
      sceneHeight / 2;
    const point = {
      x: Math.max(0, Math.min(100, (worldX / sceneWidth) * 100)),
      y: Math.max(0, Math.min(100, (worldY / sceneHeight) * 100)),
    };
    this.lastPointerPoint = point;
    return point;
  }

  private updateElementLocally(
    id: string,
    update: (element: BoardElement) => BoardElement,
  ): void {
    const board = this.board();
    if (!board) return;
    this.board.set({
      ...board,
      elements: board.elements.map((element) =>
        element.id === id && !element.locked ? update(element) : element,
      ),
    });
  }

  private saveElements(
    elements: BoardElement[],
    before: BoardElement[],
    onSuccess?: () => void,
  ): void {
    const board = this.board();
    if (!board || this.isSaving()) return;
    if (this.sameElements(before, elements)) {
      this.hasLocalEdit = false;
      this.finishPendingRefresh();
      return;
    }
    const operations = this.createElementOperations(before, elements);
    this.hasLocalEdit = false;
    this.isSaving.set(true);
    this.saveState.set("Saving…");
    this.errorMessage.set(null);
    this.board.set({ ...board, elements });
    this.boardService
      .applyElementOperations(this.boardId, operations)
      .subscribe({
        next: ({ board: updatedBoard }) => {
          this.board.set(updatedBoard);
          this.isSaving.set(false);
          this.conflictedOperations.set(null);
          this.saveState.set("Saved");
          if (onSuccess) {
            onSuccess();
          } else {
            this.undoStack.push({
              before: this.cloneElements(before),
              after: this.cloneElements(updatedBoard.elements),
            });
            this.trimHistory();
            this.redoStack.length = 0;
            this.updateHistoryDepths();
          }
          const pendingFocusId = this.pendingFocusElementId;
          this.pendingFocusElementId = undefined;
          if (pendingFocusId) this.focusEditableElement(pendingFocusId);
          this.finishPendingRefresh();
        },
        error: (error: HttpErrorResponse) => {
          this.pendingFocusElementId = undefined;
          this.isSaving.set(false);
          this.saveState.set("Not saved");
          this.board.set({ ...board, elements: before });
          const message =
            error.status === 409
              ? "A board item changed elsewhere. Review the latest board, then reapply or discard your changes."
              : this.describeError(error, "Could not save your board changes.");
          this.errorMessage.set(message);
          if (error.status === 409) {
            this.conflictedOperations.set(operations);
            this.refreshPending = false;
            this.loadBoard(false, message);
          } else {
            this.finishPendingRefresh();
          }
        },
      });
  }

  private createElementOperations(
    before: BoardElement[],
    after: BoardElement[],
  ): BoardElementOperation[] {
    const beforeById = new Map(before.map((element) => [element.id, element]));
    const afterById = new Map(after.map((element) => [element.id, element]));
    const operations: BoardElementOperation[] = [];

    for (const element of before) {
      const updated = afterById.get(element.id);
      if (!updated) {
        operations.push({ type: "delete", expected: element });
      } else if (JSON.stringify(element) !== JSON.stringify(updated)) {
        operations.push({
          type: "update",
          expected: element,
          element: updated,
        });
      }
    }
    for (const element of after) {
      if (!beforeById.has(element.id)) {
        operations.push({ type: "add", element });
      }
    }
    return operations;
  }

  reapplyConflictedChanges(): void {
    const board = this.board();
    const pending = this.conflictedOperations();
    if (!board || !pending || this.isSaving()) return;

    const currentById = new Map(
      board.elements.map((element) => [element.id, element]),
    );
    const rebased: BoardElementOperation[] = [];
    for (const operation of pending) {
      if (operation.type === "add") {
        const current = currentById.get(operation.element.id);
        if (!current) {
          rebased.push(operation);
        } else if (
          JSON.stringify(current) !== JSON.stringify(operation.element)
        ) {
          this.errorMessage.set(
            "A new board item conflicts with an existing item. Discard these changes and try again.",
          );
          return;
        }
      } else {
        const current = currentById.get(operation.expected.id);
        if (operation.type === "delete") {
          if (current) rebased.push({ type: "delete", expected: current });
        } else if (current) {
          rebased.push({
            type: "update",
            expected: current,
            element: operation.element,
          });
        } else {
          rebased.push({ type: "add", element: operation.element });
        }
      }
    }

    if (rebased.length === 0) {
      this.conflictedOperations.set(null);
      this.errorMessage.set("Your changes are already present on the board.");
      return;
    }
    const finalIds = new Set(board.elements.map((element) => element.id));
    for (const operation of rebased) {
      if (operation.type === "delete") {
        finalIds.delete(operation.expected.id);
      } else if (operation.type === "add") {
        finalIds.add(operation.element.id);
      }
    }
    const effectiveOperations = rebased.map((operation) => {
      if (
        (operation.type !== "add" && operation.type !== "update") ||
        operation.element.type !== "line"
      ) {
        return operation;
      }
      return {
        ...operation,
        element: {
          ...operation.element,
          startElementId:
            operation.element.startElementId &&
            !finalIds.has(operation.element.startElementId)
              ? null
              : operation.element.startElementId,
          endElementId:
            operation.element.endElementId &&
            !finalIds.has(operation.element.endElementId)
              ? null
              : operation.element.endElementId,
        },
      };
    });
    const rebasedById = new Map(
      effectiveOperations.map((operation) => [
        operation.type === "add" ? operation.element.id : operation.expected.id,
        operation,
      ]),
    );
    const elements = board.elements.flatMap((element) => {
      const operation = rebasedById.get(element.id);
      if (!operation || operation.type === "add") return [element];
      if (operation.type === "delete") return [];
      return [operation.element];
    });
    for (const operation of effectiveOperations) {
      if (operation.type === "add") elements.push(operation.element);
    }
    this.errorMessage.set(null);
    this.saveElements(elements, this.cloneElements(board.elements));
  }

  discardConflictedChanges(): void {
    this.conflictedOperations.set(null);
    this.errorMessage.set(null);
  }

  private cloneElements(elements: BoardElement[]): BoardElement[] {
    return elements.map((element) =>
      element.type === "stroke"
        ? { ...element, points: element.points.map((point) => ({ ...point })) }
        : { ...element },
    );
  }

  private sameElements(first: BoardElement[], second: BoardElement[]): boolean {
    return JSON.stringify(first) === JSON.stringify(second);
  }

  private trimHistory(): void {
    if (this.undoStack.length > maxHistoryEntries) {
      this.undoStack.splice(0, this.undoStack.length - maxHistoryEntries);
    }
  }

  private updateHistoryDepths(): void {
    this.undoDepth.set(this.undoStack.length);
    this.redoDepth.set(this.redoStack.length);
  }

  private clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.updateHistoryDepths();
  }

  private finishPendingRefresh(): void {
    if (!this.refreshPending) return;
    this.refreshPending = false;
    this.loadBoard();
  }

  private describeError(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return "Cannot reach StoreIt. Check that the backend is running.";
    }
    return error.error?.error ?? fallback;
  }
}
