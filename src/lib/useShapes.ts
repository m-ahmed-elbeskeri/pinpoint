// The shapes drawn on a surface (the page or the sketch board), with undo and redo.
import { useState } from 'react';
import type { Shape } from './types';

export function useShapes() {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [undoStack, setUndo] = useState<Shape[][]>([]);
  const [redoStack, setRedo] = useState<Shape[][]>([]);
  return {
    shapes,
    set(next: Shape[]) { setUndo((u) => [...u.slice(-100), shapes]); setRedo([]); setShapes(next); },
    undo() { if (!undoStack.length) return; setRedo((r) => [...r, shapes]); setShapes(undoStack[undoStack.length - 1]); setUndo(undoStack.slice(0, -1)); },
    redo() { if (!redoStack.length) return; setUndo((u) => [...u, shapes]); setShapes(redoStack[redoStack.length - 1]); setRedo(redoStack.slice(0, -1)); },
    reset() { setShapes([]); setUndo([]); setRedo([]); },
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
