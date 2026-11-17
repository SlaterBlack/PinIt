export type BoardGrant = "view" | "edit";
export type BoardPermission = BoardGrant | "owner" | "admin";
export type NoteColor =
  | "cream"
  | "yellow"
  | "orange"
  | "coral"
  | "rose"
  | "pink"
  | "magenta"
  | "lavender"
  | "sky"
  | "blue"
  | "cyan"
  | "teal"
  | "sage"
  | "green"
  | "lime"
  | "white"
  | "black";
export type BoardShapeKind =
  | "rectangle"
  | "ellipse"
  | "rhombus"
  | "triangle"
  | "arrow"
  | "elbowArrow"
  | "blockArrow"
  | "divider";
export type BoardFontFamily = "inter" | "vt323" | "serif" | "mono";
export type BoardTextAlign = "left" | "center" | "right";

export interface BoardTextStyle {
  color?: string;
  fontFamily?: BoardFontFamily;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: BoardTextAlign;
}

export interface BoardPoint {
  x: number;
  y: number;
}

interface BoardElementBase {
  id: string;
  x: number;
  y: number;
  locked?: boolean;
}

export interface BoardNote extends BoardElementBase {
  type: "note";
  text: string;
  color: NoteColor;
  textStyle?: BoardTextStyle;
  width?: number;
  height?: number;
}

export interface BoardText extends BoardElementBase {
  type: "text";
  text: string;
  color: NoteColor;
  textStyle?: BoardTextStyle;
  width: number;
  height?: number;
  autoWidth?: boolean;
}

export interface BoardCard extends BoardElementBase {
  type: "card";
  title: string;
  text: string;
  textStyle?: BoardTextStyle;
  width: number;
  height: number;
}

export interface BoardShape extends BoardElementBase {
  type: "shape";
  shape: BoardShapeKind;
  width: number;
  height: number;
  color: NoteColor;
  text?: string;
  textStyle?: BoardTextStyle;
}

export interface BoardStroke extends BoardElementBase {
  type: "stroke";
  width: number;
  height: number;
  points: BoardPoint[];
  color: NoteColor;
  strokeWidth: number;
}

export interface BoardLine extends BoardElementBase {
  type: "line";
  endX: number;
  endY: number;
  startElementId: string | null;
  endElementId: string | null;
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
  textStyle?: BoardTextStyle;
}

export interface BoardFrame extends BoardElementBase {
  type: "frame";
  title: string;
  textStyle?: BoardTextStyle;
  width: number;
  height: number;
}

export type BoardElement =
  | BoardNote
  | BoardText
  | BoardCard
  | BoardShape
  | BoardStroke
  | BoardLine
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
  endX?: number;
  endY?: number;
  startElementId?: string | null;
  endElementId?: string | null;
  autoWidth?: boolean;
  locked?: boolean;
  textStyle?: BoardTextStyle;
}

export type BoardElementOperation =
  | { type: "add"; element: BoardElement }
  | { type: "update"; expected: BoardElement; element: BoardElement }
  | { type: "delete"; expected: BoardElement };

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
