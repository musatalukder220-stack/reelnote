// Every `import … from "remotion"` in your film (and inside @remotion/player) lands here.
// It is the real remotion, except registerRoot, <Composition>, <Still> and <Folder>: ReelNote records those
// so it can play each composition in @remotion/player, live from your code.
export * from "reelnote:remotion";
import React, { createContext, useContext, useLayoutEffect } from "react";

export type Registered = {
  id: string;
  component?: React.ComponentType<Record<string, unknown>>;
  lazyComponent?: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>;
  durationInFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  defaultProps?: Record<string, unknown>;
  calculateMetadata?: (o: { defaultProps: Record<string, unknown>; props: Record<string, unknown>; abortSignal: AbortSignal; compositionId: string; isRendering: boolean }) =>
    Promise<Record<string, unknown>> | Record<string, unknown>;
  schema?: unknown;
  still: boolean;
  folder: string | null;
};

export const CollectorContext = createContext<{ add: (c: Registered) => void } | null>(null);
const FolderPath = createContext<string | null>(null);
const g = globalThis as unknown as { __reelnoteRoot?: React.FC };

export const registerRoot = (root: React.FC) => {
  g.__reelnoteRoot = root;
};

export const Folder: React.FC<{ name: string; children?: React.ReactNode }> = ({ name, children }) => {
  const parent = useContext(FolderPath);
  return <FolderPath.Provider value={parent ? `${parent}/${name}` : name}>{children}</FolderPath.Provider>;
};

const useRegister = (props: Record<string, unknown>, still: boolean) => {
  const collector = useContext(CollectorContext);
  const folder = useContext(FolderPath);
  useLayoutEffect(() => {
    collector?.add({ ...(props as unknown as Registered), still, folder, ...(still ? { durationInFrames: 1, fps: (props.fps as number) ?? 30 } : {}) });
  });
};

export const Composition = (props: Record<string, unknown>) => {
  useRegister(props, false);
  return null;
};
export const Still = (props: Record<string, unknown>) => {
  useRegister(props, true);
  return null;
};
