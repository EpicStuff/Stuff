import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { KeepWarmElectronMainApplication } from './keep-warm-electron-main-application';

export default new ContainerModule((_bind, _unbind, _isBound, rebind) => {
	rebind(ElectronMainApplication).to(KeepWarmElectronMainApplication).inSingletonScope();
});
