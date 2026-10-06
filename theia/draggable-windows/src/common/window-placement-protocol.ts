export interface ScreenPoint {
	x: number;
	y: number;
}

export interface ScreenBounds extends ScreenPoint {
	width: number;
	height: number;
}

export interface CursorScreenPosition {
	point: ScreenPoint;
	display: ScreenBounds;
}

export const DraggableWindowPlacementPath = '/services/draggable-window-placement';

export const DraggableWindowPlacementService = Symbol('DraggableWindowPlacementService');
export interface DraggableWindowPlacementService {
	getCursorScreenPosition(): Promise<CursorScreenPosition>;
}
