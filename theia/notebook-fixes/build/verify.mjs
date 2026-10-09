import { verifyTheiaSources } from '../../shared/theia-source-check.mjs';

const expectedContextKernelService = `    @inject(NotebookKernelService)
    protected readonly notebookKernelService: NotebookKernelService;`;

const expectedContextToDispose = `    protected readonly toDispose = new DisposableCollection();`;

const expectedContextScopedStore = `    scopedStore: ScopedValueStore;`;

const expectedContextInit = `    init(widget: NotebookEditorWidget): void {
        this._context = widget.node;
        this.scopedStore = this.contextKeyService.createScoped(widget.node);

        this.toDispose.dispose();

        this.scopedStore.setContext(NOTEBOOK_VIEW_TYPE, widget?.notebookType);

        this.notebookViewModel = widget.viewModel;

        // Kernel related keys
        const kernel = widget?.model ? this.notebookKernelService.getSelectedNotebookKernel(widget.model) : undefined;
        this.scopedStore.setContext(NOTEBOOK_KERNEL_SELECTED, !!kernel);
        this.scopedStore.setContext(NOTEBOOK_KERNEL, kernel?.id);
        this.toDispose.push(this.notebookKernelService.onDidChangeSelectedKernel(e => {
            if (e.notebook.toString() === widget?.getResourceUri()?.toString()) {
                this.scopedStore.setContext(NOTEBOOK_KERNEL_SELECTED, !!e.newKernel);
                this.scopedStore.setContext(NOTEBOOK_KERNEL, e.newKernel);
            }
        }));

        widget.model?.onDidChangeContent(events => {
            if (events.some(e => e.kind === NotebookCellsChangeType.ModelChange || e.kind === NotebookCellsChangeType.Output)) {
                this.scopedStore.setContext(NOTEBOOK_HAS_OUTPUTS, widget.model?.cells.some(cell => cell.outputs.length > 0));
            }
        });

        this.scopedStore.setContext(NOTEBOOK_HAS_OUTPUTS, !!widget.model?.cells.find(cell => cell.outputs.length > 0));

        // Cell Selection related keys
        this.scopedStore.setContext(NOTEBOOK_CELL_FOCUSED, !!widget.viewModel.selectedCell);
        this.selectedCellChanged(widget.viewModel.selectedCell);
        widget.viewModel.onDidChangeSelectedCell(e => {
            this.selectedCellChanged(e.cell);
            this.scopedStore.setContext(NOTEBOOK_CELL_FOCUSED, !!e);
        });

        this.toDispose.push(this.executionStateService.onDidChangeExecution(e => {
            if (e.notebook.toString() === widget.model?.uri.toString()) {
                this.setCellContext(e.cellHandle, NOTEBOOK_CELL_EXECUTING, !!e.changed);
                this.setCellContext(e.cellHandle, NOTEBOOK_CELL_EXECUTION_STATE, e.changed?.state ?? 'idle');
            }
        }));

        widget.onDidChangeOutputInputFocus(focus => {
            this.scopedStore.setContext(NOTEBOOK_OUTPUT_INPUT_FOCUSED, focus);
        });
    }`;

const expectedSetCellContext = `    protected setCellContext(cellHandle: number, key: string, value: unknown): void {
        let cellContext = this.cellContexts.get(cellHandle);
        if (!cellContext) {
            cellContext = {};
            this.cellContexts.set(cellHandle, cellContext);
        }

        cellContext[key] = value;
    }`;

const expectedGetCellContext = `    getCellContext(cellHandle: number): ContextMatcher {
        return this.contextKeyService.createOverlay(Object.entries(this.cellContexts.get(cellHandle) ?? {}));
    }`;

const expectedRenderCellToolbar = `    renderCellToolbar(menuPath: string[], cell: NotebookCellModel, itemOptions: toolbarItemOptions): React.ReactNode {
        return <NotebookCellToolbar getMenuItems={() => this.getMenuItems(menuPath, cell, itemOptions)}
            onContextChanged={this.onDidChangeContext} />;
    }`;

const expectedToolbarCellContext = `                if (menuNode.isVisible(itemPath, this.notebookContextManager.getCellContext(cell.handle), this.notebookContextManager.context, itemOptions.commandArgs?.() ?? [])) {`;

const expectedToolbarItemFields = `            id: menuNode.id,
            icon: menuNode.icon,
            label: menuNode.label,`;

const expectedToolbarConstructor = `    constructor(props: NotebookCellToolbarProps) {
        super(props);
        this.toDispose.push(props.onContextChanged(e => {
            const menuItems = this.props.getMenuItems();
            this.setState({ inlineItems: menuItems });
        }));
        this.state = { inlineItems: this.props.getMenuItems() };
    }`;

const expectedCodeCellRender = `    render(notebookModel: NotebookModel, cell: NotebookCellModel, handle: number): React.ReactNode {
        return <div className='theia-notebook-cell-with-sidebar' ref={ref => observeCellHeight(ref, cell)}>
            <div className='theia-notebook-cell-editor-container'>
                <CellEditor notebookModel={notebookModel} cell={cell}
                    notebookViewModel={this.notebookViewModel}
                    monacoServices={this.monacoServices}
                    notebookContextManager={this.notebookContextManager}
                    notebookViewportService={this.notebookViewportService}
                    notebookCellEditorService={this.notebookCellEditorService}
                    fontInfo={this.notebookOptionsService.editorFontInfo} />
                <NotebookCodeCellStatus cell={cell} notebook={notebookModel}
                    commandRegistry={this.commandRegistry}
                    executionStateService={this.executionStateService}
                    cellStatusBarService={this.notebookCellStatusBarService}
                    labelParser={this.labelParser}
                    onClick={() => this.notebookViewModel.cellViewModels.get(cell.handle)?.requestFocusEditor()} />
            </div >
        </div >;
    }`;

const expectedMarkdownCellRender = `    render(notebookModel: NotebookModel, cell: NotebookCellModel): React.ReactNode {
        return <MarkdownCell
            markdownRenderer={this.markdownRenderer}
            commandRegistry={this.commandRegistry}
            monacoServices={this.monacoServices}
            notebookOptionsService={this.notebookOptionsService}
            cell={cell}
            notebookModel={notebookModel}
            notebookViewModel={this.notebookViewModel}
            notebookContextManager={this.notebookContextManager}
            notebookCellEditorService={this.notebookCellEditorService}
            notebookCellStatusBarService={this.notebookCellStatusBarService}
            labelParser={this.labelParser}
        />;
    }

    renderSidebar(notebookModel: NotebookModel, cell: NotebookCellModel): React.ReactNode {
        return <div className='theia-notebook-markdown-sidebar'></div>;
    }`;

const expectedMarkdownContentClass = `<div className='theia-notebook-markdown-content' key="markdown"`;

const expectedFindMatches = `    findMatches(options: NotebookEditorFindMatchOptions): NotebookEditorFindMatch[] {
        if (this.cellKind === CellKind.Markup && this.onMarkdownFind) {
            return this.onMarkdownFind(options) ?? [];
        }
        if (!this.textModel) {
            return [];
        }
        const matches = options.search ? this.textModel.findMatches({
            searchString: options.search,
            isRegex: options.regex,
            matchCase: options.matchCase,
            matchWholeWord: options.wholeWord
        }) : [];
        const editorFindMatches = matches.map(match => new NotebookCodeEditorFindMatch(this, match.range, this.textModel!));
        this.onDidFindMatchesEmitter.fire(editorFindMatches);
        return editorFindMatches;
    }`;

const expectedNotebookRevert = `    async revert(options?: Saveable.RevertOptions): Promise<void> {
        if (!options?.soft) {
            // Load the data from the file again
            try {
                const data = await this.modelResolverService.resolveExistingNotebookData(this.props.resource, this.props.viewType);
                this.setData(data, false);
            } catch (err) {
                this.logger.error('Failed to revert notebook', err);
            }
        }
        this.dirty = false;
    }`;

const expectedCellClass = `<li className={'theia-notebook-cell' + `;

const expectedCellHandleAttribute = `data-cell-handle={cell.handle}`;

const expectedCellEditorClass = `<div className='theia-notebook-cell-editor' id=`;

const expectedScrollContainerClass = `<PerfectScrollbar className='theia-notebook-scroll-container'`;

const expectedCreateEditorContainer = `export function createNotebookEditorWidgetContainer(parent: interfaces.Container, props: NotebookEditorProps): interfaces.Container {
    const child = parent.createChild();

    child.bind(NotebookEditorProps).toConstantValue(props);

    const cellOutputWebviewFactory: CellOutputWebviewFactory = parent.get(CellOutputWebviewFactory);
    child.bind(CellOutputWebview).toConstantValue(cellOutputWebviewFactory());

    child.bind(NotebookViewModel).toSelf().inSingletonScope();

    child.bind(NotebookContextManager).toSelf().inSingletonScope();
    child.bind(NotebookMainToolbarRenderer).toSelf().inSingletonScope();
    child.bind(NotebookCellToolbarFactory).toSelf().inSingletonScope();
    child.bind(NotebookCodeCellRenderer).toSelf().inSingletonScope();
    child.bind(NotebookMarkdownCellRenderer).toSelf().inSingletonScope();
    child.bind(NotebookViewportService).toSelf().inSingletonScope();

    child.bind(NotebookEditorWidget).toSelf();

    return child;
}`;

const expectedContainerFactoryBinding = `    bind(NotebookEditorWidgetContainerFactory).toFactory(ctx => (props: NotebookEditorProps) =>
        createNotebookEditorWidgetContainer(ctx.container, props).get(NotebookEditorWidget)
    );`;

const expectedMonacoMarkdownRender = `    render(markdown: MarkdownString, options?: MarkdownRenderOptions): MarkdownRenderResult {
        const rendered = this.delegate.render(markdown, this.transformOptions(options));
        // The delegate activates links through its own opener service, which \`interceptOpen\`
        // routes to Theia's. Declaring that keeps callers from wiring a second handler, which
        // would open every link twice.
        markMarkdownLinksWired(rendered.element);
        return rendered;
    }

    protected transformOptions(options?: MarkdownRenderOptions): MonacoMarkdownRenderOptions | undefined {
        if (!options) {
            return undefined;
        }
        const { actionHandler, ...opts } = options;
        if (!actionHandler) {
            return opts;
        }
        return {
            ...opts,
            actionHandler: (content: string) => actionHandler.callback(content)
        };
    }`;

const notebookToolbarMapping = `'notebook/toolbar'`;

const expectedMatchingMenuPaths = `    private getMatchingTheiaMenuPaths(contributionPoint: string): MenuPath[] | undefined {
        return codeToTheiaMappings.get(contributionPoint);
    }`;

await verifyTheiaSources(import.meta.url, [{
	package: '@theia/notebook',
	file: 'src/browser/service/notebook-context-manager.ts',
	expect: [
		{ snippet: expectedContextKernelService, message: 'Unsupported @theia/notebook NotebookContextManager.notebookKernelService member.' },
		{ snippet: expectedContextToDispose, message: 'Unsupported @theia/notebook NotebookContextManager.toDispose member.' },
		{ snippet: expectedContextScopedStore, message: 'Unsupported @theia/notebook NotebookContextManager.scopedStore member.' },
		{ snippet: expectedContextInit, message: 'Unsupported @theia/notebook NotebookContextManager.init implementation.' },
		{ snippet: expectedSetCellContext, message: 'Unsupported @theia/notebook NotebookContextManager.setCellContext implementation.' },
		{ snippet: expectedGetCellContext, message: 'Unsupported @theia/notebook NotebookContextManager.getCellContext implementation.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view/notebook-cell-toolbar-factory.tsx',
	expect: [
		{ snippet: expectedRenderCellToolbar, message: 'Unsupported @theia/notebook NotebookCellToolbarFactory.renderCellToolbar implementation.' },
		{ snippet: expectedToolbarCellContext, message: 'Unsupported @theia/notebook NotebookCellToolbarFactory.getMenuItems cell context lookup.' },
		{ snippet: expectedToolbarItemFields, message: 'Unsupported @theia/notebook NotebookCellToolbarFactory.createToolbarItem id, icon and label.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view/notebook-cell-toolbar.tsx',
	expect: [
		{ snippet: expectedToolbarConstructor, message: 'Unsupported @theia/notebook NotebookCellActionBar constructor.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view/notebook-code-cell-view.tsx',
	expect: [
		{ snippet: expectedCodeCellRender, message: 'Unsupported @theia/notebook NotebookCodeCellRenderer.render implementation.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view/notebook-markdown-cell-view.tsx',
	expect: [
		{ snippet: expectedMarkdownCellRender, message: 'Unsupported @theia/notebook NotebookMarkdownCellRenderer.render and renderSidebar implementation.' },
		{ snippet: expectedMarkdownContentClass, message: 'Unsupported @theia/notebook theia-notebook-markdown-content class.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view-model/notebook-cell-model.ts',
	expect: [
		{ snippet: expectedFindMatches, message: 'Unsupported @theia/notebook NotebookCellModel.findMatches implementation.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view-model/notebook-model.ts',
	expect: [
		{ snippet: expectedNotebookRevert, message: 'Unsupported @theia/notebook NotebookModel.revert implementation.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view/notebook-cell-list-view.tsx',
	expect: [
		{ snippet: expectedCellClass, message: 'Unsupported @theia/notebook theia-notebook-cell class.' },
		{ snippet: expectedCellHandleAttribute, message: 'Unsupported @theia/notebook data-cell-handle attribute.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/view/notebook-cell-editor.tsx',
	expect: [
		{ snippet: expectedCellEditorClass, message: 'Unsupported @theia/notebook theia-notebook-cell-editor class.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/notebook-editor-widget.tsx',
	expect: [
		{ snippet: expectedScrollContainerClass, message: 'Unsupported @theia/notebook theia-notebook-scroll-container class.' },
		{ snippet: expectedCreateEditorContainer, message: 'Unsupported @theia/notebook createNotebookEditorWidgetContainer implementation.' }
	]
}, {
	package: '@theia/notebook',
	file: 'src/browser/notebook-frontend-module.ts',
	expect: [
		{ snippet: expectedContainerFactoryBinding, message: 'Unsupported @theia/notebook NotebookEditorWidgetContainerFactory binding.' }
	]
}, {
	package: '@theia/monaco',
	file: 'src/browser/markdown-renderer/monaco-markdown-renderer.ts',
	expect: [
		{ snippet: expectedMonacoMarkdownRender, message: 'Unsupported @theia/monaco MonacoMarkdownRenderer.render and transformOptions implementation.' }
	]
}, {
	package: '@theia/plugin-ext',
	file: 'src/main/browser/menus/vscode-theia-menu-mappings.ts',
	expect: [
		{ snippet: notebookToolbarMapping, message: 'Unsupported @theia/plugin-ext notebook/toolbar menu mapping.', absent: true }
	]
}, {
	package: '@theia/plugin-ext',
	file: 'src/main/browser/menus/menus-contribution-handler.ts',
	expect: [
		{ snippet: expectedMatchingMenuPaths, message: 'Unsupported @theia/plugin-ext MenusContributionPointHandler.getMatchingTheiaMenuPaths implementation.' }
	]
}]);
