// Copyright Epic Games, Inc. All Rights Reserved.

import { HttpErrorResponse } from "@angular/common/http";
import {
  Component,
  ElementRef,
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
  BoardPermission,
  BoardPoint,
  BoardShapeKind,
  NewBoardElement,
} from "../../core/models/board.model";
import { BoardLive } from "../../core/services/board-live";
import { Boards } from "../../core/services/boards";

type BoardTool =
  | "select"
  | "note"
  | "text"
  | "card"
  | "shape"
  | "frame"
  | "draw"
  | "sticker"
  | "comment";

interface ElementHistory {
  before: BoardElement[];
  after: BoardElement[];
}

interface ElementDrag {
  id: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  before: BoardElement[];
}

interface CanvasPan {
  pointerId: number;
  clientX: number;
  clientY: number;
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
  readonly drawingPoints = signal<BoardPoint[]>([]);
  readonly canvasPanning = signal(false);
  readonly draggingElementId = signal<string | null>(null);
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
    { id: "select", label: "Select", icon: "↖" },
    { id: "note", label: "Sticky note", icon: "▤" },
    { id: "text", label: "Text", icon: "T" },
    { id: "card", label: "Card", icon: "▱" },
    { id: "shape", label: "Shape", icon: "◇" },
    { id: "frame", label: "Frame", icon: "▣" },
    { id: "draw", label: "Draw", icon: "／" },
    { id: "sticker", label: "Sticker", icon: "★" },
    { id: "comment", label: "Comment", icon: "▢" },
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

  private stopLive: (() => void) | null = null;
  private hasLocalEdit = false;
  private refreshPending = false;
  private elementDrag: ElementDrag | undefined;
  private canvasPan: CanvasPan | undefined;
  private drawingPointerId: number | undefined;
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
    if (!this.canEdit() || this.isSaving()) return;
    this.selectedTool.set(tool);
    this.selectedElementId.set(null);
  }

  setShapeKind(shape: BoardShapeKind): void {
    this.shapeKind.set(shape);
  }

  zoomCanvas(event: WheelEvent): void {
    event.preventDefault();
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return;
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
    if (event.button === 2) {
      event.preventDefault();
      this.canvasPan = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      this.canvasPanning.set(true);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      return;
    }
    if (
      event.button !== 0 ||
      this.selectedTool() !== "draw" ||
      !this.canEdit() ||
      this.isSaving()
    ) {
      return;
    }
    event.preventDefault();
    this.beginLocalEdit();
    this.drawingPointerId = event.pointerId;
    this.drawingPoints.set([
      this.pointerToBoardPoint(event.clientX, event.clientY),
    ]);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onCanvasPointerMove(event: PointerEvent): void {
    if (this.canvasPan?.pointerId === event.pointerId) {
      const previous = this.canvasPan;
      const view = this.viewport();
      this.viewport.set({
        ...view,
        x: view.x + event.clientX - previous.clientX,
        y: view.y + event.clientY - previous.clientY,
      });
      this.canvasPan = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      return;
    }
    if (this.drawingPointerId !== event.pointerId) return;
    const point = this.pointerToBoardPoint(event.clientX, event.clientY);
    const points = this.drawingPoints();
    const previous = points[points.length - 1];
    if (
      previous &&
      Math.hypot(point.x - previous.x, point.y - previous.y) < 0.15
    ) {
      return;
    }
    this.drawingPoints.set([...points, point]);
  }

  onCanvasPointerUp(event: PointerEvent): void {
    if (this.canvasPan?.pointerId === event.pointerId) {
      this.canvasPan = undefined;
      this.canvasPanning.set(false);
      return;
    }
    if (this.drawingPointerId !== event.pointerId) return;
    this.drawingPointerId = undefined;
    const points = this.drawingPoints();
    this.drawingPoints.set([]);
    if (points.length < 2) {
      this.hasLocalEdit = false;
      this.finishPendingRefresh();
      return;
    }
    const stroke = this.createStroke(points);
    const board = this.board();
    this.hasLocalEdit = false;
    if (board) {
      this.saveElements(
        [...board.elements, stroke],
        this.cloneElements(board.elements),
      );
    }
  }

  onCanvasClick(event: MouseEvent): void {
    if (
      event.button !== 0 ||
      event.target !== this.canvas?.nativeElement ||
      this.isSample ||
      !this.canEdit() ||
      this.isSaving()
    ) {
      return;
    }
    const tool = this.selectedTool();
    if (tool === "select" || tool === "draw") {
      this.selectedElementId.set(null);
      return;
    }
    const board = this.board();
    if (!board) return;
    const point = this.pointerToBoardPoint(event.clientX, event.clientY);
    const element = this.createElement(tool, point.x, point.y);
    this.saveElements(
      [...board.elements, element],
      this.cloneElements(board.elements),
    );
    this.selectedElementId.set(element.id);
  }

  startElementDrag(element: BoardElement, event: PointerEvent): void {
    if (
      event.button !== 0 ||
      !this.canEdit() ||
      this.isSaving() ||
      this.selectedTool() !== "select"
    ) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("textarea, input, button")
    ) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const board = this.board();
    if (!board) return;
    this.selectedElementId.set(element.id);
    this.elementDrag = {
      id: element.id,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: element.x,
      y: element.y,
      before: this.cloneElements(board.elements),
    };
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
    const x = Math.max(
      0,
      Math.min(
        100,
        drag.x + ((event.clientX - drag.clientX) / zoom / sceneWidth) * 100,
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        100,
        drag.y + ((event.clientY - drag.clientY) / zoom / sceneHeight) * 100,
      ),
    );
    this.board.set({
      ...board,
      elements: board.elements.map((element) =>
        element.id === drag.id ? { ...element, x, y } : element,
      ),
    });
  }

  finishElementDrag(event: PointerEvent): void {
    const drag = this.elementDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.elementDrag = undefined;
    this.draggingElementId.set(null);
    const board = this.board();
    this.hasLocalEdit = false;
    if (!board) {
      this.finishPendingRefresh();
      return;
    }
    const moved = board.elements.some((element, index) => {
      const old = drag.before[index];
      return (
        element.id === drag.id &&
        old &&
        (element.x !== old.x || element.y !== old.y)
      );
    });
    if (moved) {
      this.saveElements(board.elements, drag.before);
    } else {
      this.finishPendingRefresh();
    }
  }

  beginTextEdit(): void {
    if (!this.canEdit() || this.isSaving()) return;
    this.textEditBefore = this.cloneElements(this.board()?.elements ?? []);
    this.beginLocalEdit();
  }

  changeElementText(id: string, text: string): void {
    if (!this.canEdit() || this.isSaving()) return;
    this.updateElementLocally(id, (element) =>
      "text" in element ? { ...element, text } : element,
    );
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
    const elements = board.elements.filter((element) => element.id !== id);
    if (elements.length === board.elements.length) return;
    this.selectedElementId.set(null);
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
      case "stroke":
      case "frame":
        return element.width;
      case "note":
        return 12;
      case "sticker":
        return 5;
      case "comment":
        return 13;
    }
  }

  itemHeight(element: BoardElement): number | null {
    switch (element.type) {
      case "card":
      case "shape":
      case "stroke":
      case "frame":
        return element.height;
      case "text":
        return null;
      case "note":
        return 12;
      case "sticker":
        return 5;
      case "comment":
        return 9;
    }
  }

  itemClass(element: BoardElement): string {
    const shapeClass =
      element.type === "shape" ? ` shape-${element.shape}` : "";
    return `board-item ${element.type}-item${shapeClass}${"color" in element ? ` item-${element.color}` : ""}`;
  }

  strokePointString(stroke: Extract<BoardElement, { type: "stroke" }>): string {
    return stroke.points.map((point) => `${point.x},${point.y}`).join(" ");
  }

  drawingPointString(): string {
    return this.drawingPoints()
      .map((point) => `${point.x},${point.y}`)
      .join(" ");
  }

  private createElement(
    tool: Exclude<BoardTool, "select" | "draw">,
    x: number,
    y: number,
  ): BoardElement {
    const id = crypto.randomUUID();
    const elements: Record<
      Exclude<BoardTool, "select" | "draw">,
      NewBoardElement
    > = {
      note: { type: "note", x, y, text: "", color: "rose" },
      text: { type: "text", x, y, text: "", color: "cream", width: 16 },
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
      frame: { type: "frame", x, y, title: "Frame", width: 40, height: 30 },
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
