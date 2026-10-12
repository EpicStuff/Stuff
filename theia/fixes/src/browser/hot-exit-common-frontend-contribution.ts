import { CommonFrontendContribution } from '@theia/core/lib/browser/common-frontend-contribution';
import { OnWillStopAction } from '@theia/core/lib/browser/frontend-application-contribution';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorWidget } from '@theia/editor/lib/browser';
import { HotExitContribution } from './hot-exit-contribution';

@injectable()
export class HotExitCommonFrontendContribution extends CommonFrontendContribution {
	@inject(HotExitContribution)
	protected readonly hotExit!: HotExitContribution;

	override onWillStop(): OnWillStopAction | undefined {
		const dirty = this.shell.widgets.filter(widget => Saveable.isDirty(widget));
		if (!this.shouldPreventClose && this.shell.canSaveAll() && dirty.length > 0 && dirty.every(widget => widget instanceof EditorWidget) && this.hotExit.canBackUpDirtyEditors(dirty as EditorWidget[])) {
			return {
				reason: 'Hot Exit backups for unsaved text editors',
				action: () => this.hotExit.prepareToExit()
			};
		}
		return super.onWillStop();
	}
}
