import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CodeFoldingPersistenceContribution } from './code-folding-persistence';
import { SecondaryWindowService } from '@theia/core/lib/browser/window/secondary-window-service';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { DraggableWindowsContribution } from './draggable-windows-contribution';
import { DraggableWindowPlacementPath, DraggableWindowPlacementService } from '../common/window-placement-protocol';
import { CursorPositionedSecondaryWindowService } from '../electron-browser/cursor-positioned-secondary-window-service';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(CodeFoldingPersistenceContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CodeFoldingPersistenceContribution);

	bind(DraggableWindowPlacementService).toDynamicValue(context =>
		ElectronIpcConnectionProvider.createProxy(context.container, DraggableWindowPlacementPath)
	).inSingletonScope();

	bind(CursorPositionedSecondaryWindowService).toSelf().inSingletonScope();
	rebind(SecondaryWindowService).toService(CursorPositionedSecondaryWindowService);

	bind(DraggableWindowsContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(DraggableWindowsContribution);
});
