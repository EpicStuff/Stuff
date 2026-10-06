import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import { ContainerModule } from '@theia/core/shared/inversify';
import { DraggableWindowPlacementPath, DraggableWindowPlacementService } from '../common/window-placement-protocol';
import { DraggableWindowPlacementServiceImpl } from './draggable-window-placement-service';

export default new ContainerModule(bind => {
	bind(DraggableWindowPlacementServiceImpl).toSelf().inSingletonScope();
	bind(ElectronConnectionHandler).toDynamicValue(context =>
		new RpcConnectionHandler<DraggableWindowPlacementService>(DraggableWindowPlacementPath, () =>
			context.container.get(DraggableWindowPlacementServiceImpl)
		)
	).inSingletonScope();
});
