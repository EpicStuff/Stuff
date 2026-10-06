import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { ExtractableWidget } from '@theia/core/lib/browser/widgets/extractable-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TabBar, Widget } from '@theia/core/shared/@lumino/widgets';
import { CursorPositionedSecondaryWindowService } from '../electron-browser/cursor-positioned-secondary-window-service';

const EXTRACT_WIDGET_COMMAND = 'extract-widget';

@injectable()
export class DraggableWindowsContribution implements FrontendApplicationContribution {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(CommandService)
	protected readonly commandService!: CommandService;

	@inject(CursorPositionedSecondaryWindowService)
	protected readonly secondaryWindowService!: CursorPositionedSecondaryWindowService;

	protected readonly registeredTabBars = new WeakSet<TabBar<Widget>>();

	async onStart(): Promise<void> {
		await this.shell.initialized;
		this.registerTabBars();
		this.shell.onDidAddWidget(() => this.registerTabBars());
	}

	protected registerTabBars(): void {
		for (const tabBar of this.shell.allTabBars) {
			if (this.registeredTabBars.has(tabBar)) {
				continue;
			}
			this.registeredTabBars.add(tabBar);
			tabBar.tabDetachRequested.connect(this.onTabDetachRequested, this);
		}
	}

	protected onTabDetachRequested(sender: TabBar<Widget>, args: TabBar.ITabDetachRequestedArgs<Widget>): void {
		const widget = args.title.owner;
		if (!ExtractableWidget.is(widget) || widget.secondaryWindow !== undefined) {
			return;
		}

		const dragDocument = sender.node.ownerDocument;
		const dragWindow = dragDocument.defaultView;
		if (!dragWindow) {
			return;
		}

		const tabBounds = args.tab.getBoundingClientRect();
		const offsetX = tabBounds.width / 2;
		const offsetY = tabBounds.height / 2;

		let finished = false;
		const cleanup = () => {
			if (finished) {
				return;
			}
			finished = true;
			dragDocument.removeEventListener('pointerup', onPointerUp, true);
			dragDocument.removeEventListener('pointercancel', onPointerCancel, true);
			dragDocument.removeEventListener('keydown', onKeyDown, true);
		};
		const onPointerCancel = () => cleanup();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				cleanup();
			}
		};
		const onPointerUp = (event: PointerEvent) => {
			if (event.button !== 0) {
				return;
			}

			const shouldExtract = this.isOutsideWindow(event, dragWindow);
			cleanup();
			if (!shouldExtract) {
				return;
			}

			setTimeout(() => {
				void this.extractWidgetAtPointer(widget, offsetX, offsetY);
			});
		};

		dragDocument.addEventListener('pointerup', onPointerUp, true);
		dragDocument.addEventListener('pointercancel', onPointerCancel, true);
		dragDocument.addEventListener('keydown', onKeyDown, true);
	}

	protected async extractWidgetAtPointer(widget: ExtractableWidget, offsetX: number, offsetY: number): Promise<void> {
		if (widget.isDisposed || widget.secondaryWindow !== undefined) {
			return;
		}

		await this.secondaryWindowService.captureNextWindowPosition(offsetX, offsetY);
		try {
			if (!widget.isDisposed && widget.secondaryWindow === undefined) {
				await this.commandService.executeCommand(EXTRACT_WIDGET_COMMAND, widget);
			}
		} finally {
			this.secondaryWindowService.clearNextWindowPosition();
		}
	}

	protected isOutsideWindow(event: PointerEvent, dragWindow: Window): boolean {
		return event.clientX < 0 || event.clientX >= dragWindow.innerWidth || event.clientY < 0 || event.clientY >= dragWindow.innerHeight;
	}
}
