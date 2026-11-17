export type BoardGrant = "view" | "edit";
export type BoardPermission = BoardGrant | "owner" | "admin";
export type NoteColor = "rose" | "cream" | "sage" | "sky";

export interface BoardNote {
  id: string;
  type: "note";
  text: string;
  x: number;
  y: number;
  color: NoteColor;
}

export interface Board {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  elements: BoardNote[];
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
