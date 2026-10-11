import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CodeFoldingPersistenceContribution } from './code-folding-persistence';

export default new ContainerModule(bind => {
	bind(CodeFoldingPersistenceContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CodeFoldingPersistenceContribution);
});
