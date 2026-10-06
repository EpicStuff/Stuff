import { screen } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CursorScreenPosition, DraggableWindowPlacementService } from '../common/window-placement-protocol';

@injectable()
export class DraggableWindowPlacementServiceImpl implements DraggableWindowPlacementService {
	async getCursorScreenPosition(): Promise<CursorScreenPosition> {
		const point = screen.getCursorScreenPoint();
		const display = screen.getDisplayNearestPoint(point);
		return {
			point,
			display: display.bounds
		};
	}
}
