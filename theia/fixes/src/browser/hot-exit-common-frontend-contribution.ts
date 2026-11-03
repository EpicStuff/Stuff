import { ApplicationShell, OpenerService, SaveableService } from '@theia/core/lib/browser';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';
import { CommonFrontendContribution } from '@theia/core/lib/browser/common-frontend-contribution';
import { AsyncLocalizationProvider } from '@theia/core/lib/common/i18n/localization';
import { MessageService } from '@theia/core/lib/common/message-service';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { OnWillStopAction } from '@theia/core/lib/browser/frontend-application-contribution';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorWidget } from '@theia/editor/lib/browser';
import { HotExitContribution } from './hot-exit-contribution';

@injectable()
export class HotExitCommonFrontendContribution extends CommonFrontendContribution {
	@inject(HotExitContribution)
	protected readonly hotExit!: HotExitContribution;

	constructor(@inject(ApplicationShell) shell: ApplicationShell, @inject(SelectionService) selectionService: SelectionService, @inject(MessageService) messageService: MessageService, @inject(OpenerService) openerService: OpenerService, @inject(AboutDialog) aboutDialog: AboutDialog, @inject(AsyncLocalizationProvider) localizationProvider: AsyncLocalizationProvider, @inject(SaveableService) saveResourceService: SaveableService) {
		super(shell, selectionService, messageService, openerService, aboutDialog, localizationProvider, saveResourceService);
	}

	override onWillStop(): OnWillStopAction | undefined {
		const dirty = this.shell.widgets.filter(widget => Saveable.isDirty(widget));
		const editors = new Set<EditorWidget>();
		const collect = (widget: typeof dirty[number]): boolean => {
			if (widget instanceof EditorWidget) {
				editors.add(widget);
				return true;
			}
			const nested = widget as typeof widget & { getTrackableWidgets?: () => typeof dirty };
			return typeof nested.getTrackableWidgets === 'function' && nested.getTrackableWidgets().filter(child => Saveable.isDirty(child)).every(child => collect(child));
		};
		const allSupported = dirty.every(widget => collect(widget));
		if (!this.shouldPreventClose && this.shell.canSaveAll() && dirty.length > 0 && allSupported && editors.size > 0 && this.hotExit.canBackUpDirtyEditors([...editors])) {
			return {
				reason: 'Hot Exit backups for unsaved text editors',
				priority: Number.MAX_SAFE_INTEGER,
				action: () => this.hotExit.prepareToExit()
			};
		}
		if (!this.shouldPreventClose && dirty.length === 0 && this.hotExit.hasPendingWork()) {
			return { reason: 'Finish pending Hot Exit backups', priority: Number.MAX_SAFE_INTEGER, action: () => this.hotExit.prepareToExit() };
		}
		return super.onWillStop();
	}
}
