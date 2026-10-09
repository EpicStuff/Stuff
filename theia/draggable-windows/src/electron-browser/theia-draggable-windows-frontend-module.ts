import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { SecondaryWindowService } from '@theia/core/lib/browser/window/secondary-window-service';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { ContainerModule } from '@theia/core/shared/inversify';
import { DraggableWindowsContribution } from '../browser/draggable-windows-contribution';
import { DraggableWindowPlacementPath, DraggableWindowPlacementService } from '../common/window-placement-protocol';
import { CursorPositionedSecondaryWindowService } from './cursor-positioned-secondary-window-service';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(DraggableWindowPlacementService).toDynamicValue(context =>
		ElectronIpcConnectionProvider.createProxy(context.container, DraggableWindowPlacementPath)
	).inSingletonScope();

	bind(CursorPositionedSecondaryWindowService).toSelf().inSingletonScope();
	rebind(SecondaryWindowService).toService(CursorPositionedSecondaryWindowService);

	bind(DraggableWindowsContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(DraggableWindowsContribution);
});
