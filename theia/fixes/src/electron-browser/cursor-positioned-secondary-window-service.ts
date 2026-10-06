import { ExtractableWidget } from '@theia/core/lib/browser/widgets/extractable-widget';
import { ElectronSecondaryWindowService } from '@theia/core/lib/electron-browser/window/electron-secondary-window-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CursorScreenPosition, DraggableWindowPlacementService } from '../common/window-placement-protocol';

@injectable()
export class CursorPositionedSecondaryWindowService extends ElectronSecondaryWindowService {
	@inject(DraggableWindowPlacementService)
	protected readonly draggableWindowPlacementService!: DraggableWindowPlacementService;

	protected nextWindowPosition: CursorScreenPosition | undefined;

	async captureNextWindowPosition(): Promise<void> {
		try {
			this.nextWindowPosition = await this.draggableWindowPlacementService.getCursorScreenPosition();
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

		const [height, width] = coordinates;
		const effectiveWidth = width ?? widget.node.clientWidth;
		const left = Math.max(position.display.x, Math.round(position.point.x - effectiveWidth / 2));
		const top = Math.max(position.display.y, Math.round(position.point.y - 30));
		return [height, width, left, top];
	}
}
