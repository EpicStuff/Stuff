import { ExtractableWidget } from '@theia/core/lib/browser/widgets/extractable-widget';
import { ElectronSecondaryWindowService } from '@theia/core/lib/electron-browser/window/electron-secondary-window-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CursorScreenPosition, DraggableWindowPlacementService } from '../common/window-placement-protocol';

interface NextWindowPosition {
	cursor: CursorScreenPosition;
	offsetX: number;
	offsetY: number;
}

@injectable()
export class CursorPositionedSecondaryWindowService extends ElectronSecondaryWindowService {
	@inject(DraggableWindowPlacementService)
	protected readonly draggableWindowPlacementService!: DraggableWindowPlacementService;

	protected nextWindowPosition: NextWindowPosition | undefined;

	async captureNextWindowPosition(offsetX: number, offsetY: number): Promise<void> {
		try {
			this.nextWindowPosition = {
				cursor: await this.draggableWindowPlacementService.getCursorScreenPosition(),
				offsetX,
				offsetY
			};
		} catch {
			this.nextWindowPosition = undefined;
		}
	}

	clearNextWindowPosition(): void {
		this.nextWindowPosition = undefined;
	}

	protected override findSecondaryWindowCoordinates(widget: ExtractableWidget): (number | undefined)[] {
		const coordinates = super.findSecondaryWindowCoordinates(widget);
		const position = this.nextWindowPosition;
		this.nextWindowPosition = undefined;
		if (!position) {
			return coordinates;
		}

		const { cursor, offsetX, offsetY } = position;
		const left = Math.max(cursor.display.x, Math.round(cursor.point.x - offsetX));
		const top = Math.max(cursor.display.y, Math.round(cursor.point.y - 30 - offsetY));
		return [coordinates[0], coordinates[1], left, top];
	}
}
