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

  readonly boardId = this.route.snapshot.paramMap.get("boardId") ?? "";
  readonly isSample = this.boardId === "sample";
  readonly board = signal<Board | null>(null);
  readonly permission = signal<BoardPermission | null>(null);
  readonly canEdit = computed(() =>
    ["owner", "admin", "edit"].includes(this.permission() ?? ""),
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
  readonly tools: { id: BoardTool; label: string; icon: string }[] = [
    { id: "select", label: "Select (V)", icon: "↖" },
    { id: "hand", label: "Hand (H)", icon: "✋" },
    { id: "note", label: "Sticky note (N)", icon: "▤" },
    { id: "text", label: "Text (T)", icon: "T" },
    { id: "shape", label: "Shapes (S)", icon: "◇" },
    { id: "card", label: "Card", icon: "▱" },
    { id: "line", label: "Connection line (L)", icon: "↗" },
    { id: "pen", label: "Pen (P)", icon: "／" },
    { id: "eraser", label: "Eraser (E)", icon: "⌫" },
    { id: "lasso", label: "Lasso (Q)", icon: "◯" },
    { id: "frame", label: "Frame (F)", icon: "▣" },
    { id: "comment", label: "Comment (C)", icon: "▢" },
    { id: "sticker", label: "Sticker", icon: "★" },
  ];
  readonly shapeKinds: {
    id: BoardShapeKind;
    label: string;
    icon: string;
  }[] = [
    { id: "rectangle", label: "Rectangle", icon: "▱" },
    { id: "ellipse", label: "Ellipse", icon: "◯" },
    { id: "arrow", label: "Arrow", icon: "➜" },
  ];
  readonly colorOptions: NoteColor[] = ["cream", "rose", "sage", "sky"];

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
  private readonly undoStack: ElementHistory[] = [];
  private readonly redoStack: ElementHistory[] = [];

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
      !!target.closest("input, textarea, [contenteditable='true']");
    const focusedControl =
      target instanceof HTMLElement &&
      !!target.closest("button, select, [role='button']");
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
    } else if (event.key === "Escape") {
      this.cancelGesture();
      this.setTool("select");
      this.editingElementId.set(null);
      this.contextMenu.set(null);
    }
  }

  @HostListener("document:keyup", ["$event"])
  onDocumentKeyUp(event: KeyboardEvent): void {
    if (event.code === "Space" && this.spaceDown) {
      this.spaceDown = false;
      this.spaceHandActive.set(false);
    }
  }

  @HostListener("window:blur")
  onWindowBlur(): void {
    this.spaceDown = false;
    this.spaceHandActive.set(false);
  }

  loadBoard(connectLive = false): void {
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
        this.errorMessage.set(null);
        if (connectLive && !this.stopLive) {
          this.stopLive = this.boardLive.connect(
            this.boardId,
            (updatedAt) => {
              const currentBoard = this.board();
              if (this.isSaving() || currentBoard?.updatedAt === updatedAt) {
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
    this.boardService.updateTitle(this.boardId, title).subscribe({
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
        this.finishPendingRefresh();
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
      this.selectedTool() !== "select"
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
      ids.has(element.id) && "color" in element
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

  resetView(): void {
    this.viewport.set({ x: 0, y: 0, zoom: 1 });
    this.contextMenu.set(null);
  }

  deleteSelection(): void {
    if (!this.canEdit() || this.isSaving()) return;
    const board = this.board();
    if (!board) return;
    const selected = new Set(this.selectedElementIds());
    const elements = this.removeElements(board.elements, selected);
    if (elements.length === board.elements.length) return;
    this.setSelection([]);
    this.saveElements(elements, this.cloneElements(board.elements));
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
    if (target instanceof HTMLElement && target.closest("textarea, input")) {
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
    ];
    this.elementDrag = {
      ids: dragIds,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      before: this.cloneElements(board.elements),
    };
    this.pendingElementClickId = element.id;
    this.draggingElementId.set(element.id);
    this.beginLocalEdit();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  moveElement(event: PointerEvent): void {
    const drag = this.elementDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const board = this.board();
    if (!board) return;
    const zoom = this.viewport().zoom;
    const dx = ((event.clientX - drag.clientX) / zoom / sceneWidth) * 100;
    const dy = ((event.clientY - drag.clientY) / zoom / sceneHeight) * 100;
    const moveIds = new Set(drag.ids);
    const beforeById = new Map(drag.before.map((item) => [item.id, item]));
    this.board.set({
      ...board,
      elements: board.elements.map((element) => {
        if (moveIds.has(element.id)) {
          const original = beforeById.get(element.id) ?? element;
          if (element.type === "line") {
            return {
              ...element,
              x: this.clampCoordinate(original.x + dx),
              y: this.clampCoordinate(original.y + dy),
              endX: this.clampCoordinate(element.endX + dx),
              endY: this.clampCoordinate(element.endY + dy),
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
    const moved = !this.sameElements(drag.before, board.elements);
    if (moved) {
      this.saveElements(board.elements, drag.before);
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
        (element) => element.id === id && element.type === "stroke",
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
    return {
      x: Math.max(0, Math.min(100, (worldX / sceneWidth) * 100)),
      y: Math.max(0, Math.min(100, (worldY / sceneHeight) * 100)),
    };
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
        element.id === id ? update(element) : element,
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
    this.hasLocalEdit = false;
    this.isSaving.set(true);
    this.saveState.set("Saving…");
    this.errorMessage.set(null);
    this.board.set({ ...board, elements });
    this.boardService
      .replaceElements(this.boardId, elements, board.updatedAt)
      .subscribe({
        next: ({ board: updatedBoard }) => {
          this.board.set(updatedBoard);
          this.isSaving.set(false);
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
          this.finishPendingRefresh();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.saveState.set("Not saved");
          this.board.set({ ...board, elements: before });
          this.errorMessage.set(
            error.status === 409
              ? "The board changed elsewhere. Your change was not saved; the latest board is loading."
              : this.describeError(error, "Could not save your board changes."),
          );
          if (error.status === 409) {
            this.refreshPending = false;
            this.loadBoard();
          } else {
            this.finishPendingRefresh();
          }
        },
      });
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
