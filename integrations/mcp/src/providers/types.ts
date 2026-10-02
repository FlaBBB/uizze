import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  FontMaterial,
  IconMaterial,
  MaterialInput,
  ReferenceInput,
} from "../contracts.js";

export interface ReferenceProvider {
  id: string;
  search(input: ReferenceInput): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface MaterialProvider {
  id: string;
  kind: "font" | "icon";
  search(input: MaterialInput): Promise<FontMaterial[] | IconMaterial[]>;
}
