export interface SceneDefinition {
  readonly id: string;
  readonly name: string;
  readonly english: string;
  readonly path: string;
  readonly icon: string;
  readonly capabilities: readonly string[];
}
export const scenes: readonly SceneDefinition[];
export function sceneById(id: unknown): SceneDefinition | undefined;
