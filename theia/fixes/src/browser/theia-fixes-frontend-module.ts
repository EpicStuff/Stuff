import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommonFrontendContribution } from '@theia/core/lib/browser/common-frontend-contribution';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CodeFoldingPersistenceContribution } from './code-folding-persistence';
import { HotExitBackupService, HotExitBackupServicePath } from '../common/hot-exit-protocol';
import { HotExitCommonFrontendContribution } from './hot-exit-common-frontend-contribution';
import { HotExitContribution } from './hot-exit-contribution';
import { SecondaryWindowService } from '@theia/core/lib/browser/window/secondary-window-service';
import { DraggableWindowsContribution } from './draggable-windows-contribution';
import { DraggableWindowPlacementPath, DraggableWindowPlacementService } from '../common/window-placement-protocol';
import { CursorPositionedSecondaryWindowService } from '../electron-browser/cursor-positioned-secondary-window-service';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(CodeFoldingPersistenceContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CodeFoldingPersistenceContribution);
	bind(HotExitBackupService).toDynamicValue(context => ElectronIpcConnectionProvider.createProxy(context.container, HotExitBackupServicePath)).inSingletonScope();
	bind(HotExitContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(HotExitContribution);
	rebind(CommonFrontendContribution).to(HotExitCommonFrontendContribution).inSingletonScope();

	bind(DraggableWindowPlacementService).toDynamicValue(context =>
		ElectronIpcConnectionProvider.createProxy(context.container, DraggableWindowPlacementPath)
	).inSingletonScope();

	bind(CursorPositionedSecondaryWindowService).toSelf().inSingletonScope();
	rebind(SecondaryWindowService).toService(CursorPositionedSecondaryWindowService);

	bind(DraggableWindowsContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(DraggableWindowsContribution);
});
