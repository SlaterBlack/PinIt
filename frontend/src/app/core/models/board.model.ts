export type BoardGrant = "view" | "edit";
export type BoardPermission = BoardGrant | "owner" | "admin";
export type NoteColor = "rose" | "cream" | "sage" | "sky";
export type BoardShapeKind = "rectangle" | "ellipse" | "arrow";

export interface BoardPoint {
  x: number;
  y: number;
}

interface BoardElementBase {
  id: string;
  x: number;
  y: number;
}

export interface BoardNote extends BoardElementBase {
  type: "note";
  text: string;
  color: NoteColor;
}

export interface BoardText extends BoardElementBase {
  type: "text";
  text: string;
  color: NoteColor;
  width: number;
}

export interface BoardCard extends BoardElementBase {
  type: "card";
  title: string;
  text: string;
  width: number;
  height: number;
}

export interface BoardShape extends BoardElementBase {
  type: "shape";
  shape: BoardShapeKind;
  width: number;
  height: number;
  color: NoteColor;
}

export interface BoardStroke extends BoardElementBase {
  type: "stroke";
  width: number;
  height: number;
  points: BoardPoint[];
  color: NoteColor;
  strokeWidth: number;
}

export interface BoardSticker extends BoardElementBase {
  type: "sticker";
  emoji: string;
}

export interface BoardComment extends BoardElementBase {
  type: "comment";
  text: string;
}

export interface BoardFrame extends BoardElementBase {
  type: "frame";
  title: string;
  width: number;
  height: number;
}

export type BoardElement =
  | BoardNote
  | BoardText
  | BoardCard
  | BoardShape
  | BoardStroke
  | BoardSticker
  | BoardComment
  | BoardFrame;

export type NewBoardElement = BoardElement extends infer Element
  ? Element extends BoardElementBase
    ? Omit<Element, "id">
    : never
  : never;

export interface BoardElementChanges {
  x?: number;
  y?: number;
  text?: string;
  title?: string;
  width?: number;
  height?: number;
  color?: NoteColor;
  shape?: BoardShapeKind;
  points?: BoardPoint[];
  strokeWidth?: number;
  emoji?: string;
}

export interface Board {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  elements: BoardElement[];
  grants?: Record<string, BoardGrant>;
}

export interface BoardSummary {
  id: string;
  title: string;
  ownerId: string;
  updatedAt: string;
  permission?: BoardPermission;
  grants?: Record<string, BoardGrant>;
}
