import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { DraggableWindowsContribution } from './draggable-windows-contribution';

export default new ContainerModule(bind => {
	bind(DraggableWindowsContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(DraggableWindowsContribution);
});
