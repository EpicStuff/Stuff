import { BackendApplicationContribution, CliContribution } from '@theia/core/lib/node';
import { ContainerModule } from '@theia/core/shared/inversify';
import { PluginDeployerContribution } from '@theia/plugin-ext/lib/main/node/plugin-deployer-contribution';
import { KeepWarmBackendCliContribution, KeepWarmBackendCliPluginDeployerContribution, KeepWarmBackendCliRunner, KeepWarmBackendCliState } from './backend-cli';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(KeepWarmBackendCliState).toSelf().inSingletonScope();

	bind(KeepWarmBackendCliContribution).toSelf().inSingletonScope();
	bind(CliContribution).toService(KeepWarmBackendCliContribution);

	bind(KeepWarmBackendCliRunner).toSelf().inSingletonScope();
	bind(BackendApplicationContribution).toService(KeepWarmBackendCliRunner);

	rebind(PluginDeployerContribution).to(KeepWarmBackendCliPluginDeployerContribution).inSingletonScope();
});
