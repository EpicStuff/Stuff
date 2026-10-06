import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { ExtractableWidget } from '@theia/core/lib/browser/widgets/extractable-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TabBar, Widget } from '@theia/core/shared/@lumino/widgets';

const EXTRACT_WIDGET_COMMAND = 'extract-widget';

@injectable()
export class DraggableWindowsContribution implements FrontendApplicationContribution {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(CommandService)
	protected readonly commandService!: CommandService;

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
				if (!widget.isDisposed && ExtractableWidget.is(widget) && widget.secondaryWindow === undefined) {
					void this.commandService.executeCommand(EXTRACT_WIDGET_COMMAND, widget);
				}
			});
		};

		dragDocument.addEventListener('pointerup', onPointerUp, true);
		dragDocument.addEventListener('pointercancel', onPointerCancel, true);
		dragDocument.addEventListener('keydown', onKeyDown, true);
	}

	protected isOutsideWindow(event: PointerEvent, dragWindow: Window): boolean {
		const left = dragWindow.screenX;
		const top = dragWindow.screenY;
		const right = left + dragWindow.outerWidth;
		const bottom = top + dragWindow.outerHeight;
		return event.screenX < left || event.screenX >= right || event.screenY < top || event.screenY >= bottom;
	}
}
