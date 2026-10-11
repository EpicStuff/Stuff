import { Command, DisposableCollection } from '@theia/core';
import { codicon, UndoRedoHandler } from '@theia/core/lib/browser';
import { SelectComponent, SelectOption } from '@theia/core/lib/browser/widgets/select-component';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { isOSX } from '@theia/core/lib/common/os';
import { injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ToolbarIconDialogFactory } from '@theia/toolbar/lib/browser/toolbar-icon-selector-dialog';
import {
	EditableMenuEntry,
	EditableMenuItem
} from './custom-context-menu-types';
import { CustomContextMenuService } from './custom-context-menu-service';

interface AddChoice {
	key: string;
	label: string;
	commandId: string;
	entry: EditableMenuItem;
	detail: string;
}

interface EntryLocation {
	entry: EditableMenuEntry;
	parent: EditableMenuEntry[];
	index: number;
}

interface EntrySummary {
	/** Keys of the enclosing submenus, outermost first. */
	ancestors: string[];
	previousKey?: string;
	signature: string;
}

interface EditHistory {
	undo: unknown[];
	redo: unknown[];
}

export interface ContextMenuConfigEditorProps {
	service: CustomContextMenuService;
	quickCommandService: QuickCommandService;
	iconDialogFactory: ToolbarIconDialogFactory;
	height: string;
	autoFocus?: boolean;
}

/**
 * UI state only. Every edit is stored immediately, so there is nothing unsaved to transfer.
 */
export interface ContextMenuConfigEditorState {
	activeTargetId: string;
	expandedKeys: string[];
	selectedKey?: string;
	mode: 'menu' | 'add' | 'edit';
	addFilter: string;
	editingKey?: string;
	editLabel: string;
	editWhen: string;
	editIcon: string;
	selectedAddKey?: string;
	renamingKey?: string;
	renameValue: string;
}

function isTextInput(element: EventTarget | null): boolean {
	return element instanceof HTMLInputElement
		|| element instanceof HTMLTextAreaElement
		|| (element instanceof HTMLElement && element.isContentEditable);
}

export class ContextMenuConfigEditor extends React.Component<ContextMenuConfigEditorProps> {
	static readonly mounted = new Set<ContextMenuConfigEditor>();

	protected readonly toDispose = new DisposableCollection();
	protected rootNode: HTMLDivElement | null = null;
	protected activeTargetId = 'editor';
	/** View of the contributed menu plus the stored layout, rebuilt whenever either changes. */
	protected entries: EditableMenuEntry[] | undefined;
	/** Undo and redo stacks of stored layout values, per target menu. */
	protected readonly history = new Map<string, EditHistory>();
	protected readonly expandedKeys = new Set<string>();
	protected selectedKey: string | undefined;
	/** Row to scroll into view after the next render. */
	protected revealKey: string | undefined;
	protected draggedKey: string | undefined;
	protected mode: 'menu' | 'add' | 'edit' = 'menu';
	protected addFilter = '';
	protected editingKey: string | undefined;
	protected editLabel = '';
	protected editWhen = '';
	protected editIcon = '';
	protected dragOverKey: string | undefined;
	protected dragOverPosition: 'before' | 'after' | undefined;
	protected selectedAddKey: string | undefined;
	protected renamingKey: string | undefined;
	protected renameValue = '';
	protected status = '';

	componentDidMount(): void {
		ContextMenuConfigEditor.mounted.add(this);
		this.toDispose.push(this.props.service.onDidChange(() => {
			this.entries = undefined;
			this.forceUpdate();
		}));
		this.toDispose.push(this.props.service.onDidChangeWriteStatus(status => {
			this.status = status.error
				? `Could not save: ${status.error}`
				: status.saving ? 'Saving...' : 'Saved';
			this.forceUpdate();
		}));
		if (this.props.autoFocus) {
			this.focus();
		}
	}

	componentDidUpdate(): void {
		const key = this.revealKey;
		this.revealKey = undefined;
		if (key !== undefined) {
			this.rootNode?.querySelector(`[data-entry-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
		}
	}

	componentWillUnmount(): void {
		ContextMenuConfigEditor.mounted.delete(this);
		this.toDispose.dispose();
	}

	focus(): void {
		if (this.rootNode && !this.rootNode.contains(this.rootNode.ownerDocument.activeElement)) {
			this.rootNode.focus();
		}
	}

	hasFocus(): boolean {
		const activeElement = this.rootNode?.ownerDocument.activeElement ?? null;
		return !!this.rootNode?.contains(activeElement) && !isTextInput(activeElement);
	}

	captureState(): ContextMenuConfigEditorState {
		return {
			activeTargetId: this.activeTargetId,
			expandedKeys: [...this.expandedKeys],
			selectedKey: this.selectedKey,
			mode: this.mode,
			addFilter: this.addFilter,
			editingKey: this.editingKey,
			editLabel: this.editLabel,
			editWhen: this.editWhen,
			editIcon: this.editIcon,
			selectedAddKey: this.selectedAddKey,
			renamingKey: this.renamingKey,
			renameValue: this.renameValue
		};
	}

	restoreState(state: ContextMenuConfigEditorState): void {
		this.activeTargetId = state.activeTargetId;
		this.entries = undefined;
		this.expandedKeys.clear();
		for (const key of state.expandedKeys) {
			this.expandedKeys.add(key);
		}

		this.selectedKey = state.selectedKey;
		this.mode = state.mode;
		this.addFilter = state.addFilter;
		this.editingKey = state.editingKey;
		this.editLabel = state.editLabel;
		this.editWhen = state.editWhen;
		this.editIcon = state.editIcon;
		this.selectedAddKey = state.selectedAddKey;
		this.renamingKey = state.renamingKey;
		this.renameValue = state.renameValue;
		this.draggedKey = undefined;
		this.dragOverKey = undefined;
		this.dragOverPosition = undefined;
		this.forceUpdate();
	}

	canUndo(): boolean {
		return !!this.history.get(this.activeTargetId)?.undo.length;
	}

	canRedo(): boolean {
		return !!this.history.get(this.activeTargetId)?.redo.length;
	}

	undo = (): void => {
		const history = this.history.get(this.activeTargetId);
		if (!history?.undo.length) {
			return;
		}
		const before = this.summarizeEntries(this.getEntries());
		history.redo.push(this.props.service.getStoredValue(this.activeTargetId));
		this.props.service.setStoredValue(this.activeTargetId, history.undo.pop());
		this.revealChange(before);
	};

	redo = (): void => {
		const history = this.history.get(this.activeTargetId);
		if (!history?.redo.length) {
			return;
		}
		const before = this.summarizeEntries(this.getEntries());
		history.undo.push(this.props.service.getStoredValue(this.activeTargetId));
		this.props.service.setStoredValue(this.activeTargetId, history.redo.pop());
		this.revealChange(before);
	};

	/**
	 * Selects and scrolls to the first row that differs from `before`, expanding the submenus around it.
	 * A row that no longer exists is represented by its previous sibling, or by its submenu.
	 */
	protected revealChange(before: Map<string, EntrySummary>): void {
		const after = this.summarizeEntries(this.getEntries());
		let key: string | undefined;
		for (const [candidate, summary] of after) {
			if (before.get(candidate)?.signature !== summary.signature) {
				key = candidate;
				break;
			}
		}
		if (key === undefined) {
			for (const [candidate, summary] of before) {
				if (!after.has(candidate)) {
					key = [summary.previousKey, ...[...summary.ancestors].reverse()].find(neighbour => neighbour !== undefined && after.has(neighbour));
					break;
				}
			}
		}
		if (key === undefined) {
			return;
		}
		for (const ancestor of after.get(key)!.ancestors) {
			this.expandedKeys.add(ancestor);
		}
		this.selectedKey = key;
		this.revealKey = key;
		this.forceUpdate();
	}

	/** Summaries of all entries in display order, used to locate what an undo or redo changed. */
	protected summarizeEntries(entries: EditableMenuEntry[], ancestors: string[] = [], result = new Map<string, EntrySummary>()): Map<string, EntrySummary> {
		entries.forEach((entry, index) => {
			const previousKey = entries[index - 1]?.key;
			const content = entry.type === 'item' ? [entry.label, entry.when ?? '', entry.icon ?? ''] : [];
			result.set(entry.key, {
				ancestors,
				previousKey,
				signature: JSON.stringify([ancestors[ancestors.length - 1], previousKey, ...content])
			});
			if (entry.type === 'item' && entry.children) {
				this.summarizeEntries(entry.children, [...ancestors, entry.key], result);
			}
		});
		return result;
	}

	render(): React.ReactNode {
		return (
			<div
				ref={node => {
					this.rootNode = node;
				}}
				tabIndex={-1}
				onKeyDown={this.handleKeyDown}
				style={{ height: this.props.height, minHeight: 0, outline: 'none' }}
			>
				{this.mode === 'add'
					? this.renderAddCommands()
					: this.mode === 'edit' ? this.renderItemEditor() : this.renderMenuEditor()}
			</div>
		);
	}

	/**
	 * Ctrl+Z is routed through Theia's undo command to ContextMenuConfigUndoRedoHandler. This handles
	 * Ctrl+Shift+Z, which Theia only binds to redo on macOS. Text inputs keep their native undo.
	 */
	protected handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
		if (!(isOSX ? event.metaKey : event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z' || isTextInput(event.target)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.shiftKey) {
			this.redo();
		} else {
			this.undo();
		}
	};

	protected renderMenuEditor(): React.ReactNode {
		const targets = this.props.service.getTargets();
		const entries = this.getEntries();
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', minHeight: 0 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '0 0 auto' }}>
					<label style={{ minWidth: '52px' }}>Menu:</label>
					<div style={{ width: '280px' }}>
						<SelectComponent
							key={this.activeTargetId}
							options={targets.map(target => ({ value: target.id, label: target.label }))}
							defaultValue={this.activeTargetId}
							onChange={this.handleTargetChange}
						/>
					</div>
					<span style={{ opacity: 0.7 }}>
						Drag items to reorder. Expand submenus to edit their contents.
					</span>
				</div>

				<div
					key={this.activeTargetId}
					style={{
						border: '1px solid var(--theia-panel-border)',
						flex: 1,
						minHeight: 0,
						overflow: 'auto',
						padding: '4px'
					}}
				>
					{entries.length
						? this.renderEntries(entries, 0)
						: <div style={{ opacity: 0.7, padding: '18px', textAlign: 'center' }}>This menu is empty.</div>}
				</div>

				<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto', flexWrap: 'wrap' }}>
					{this.renderActionButton('add', 'Add Command', this.openAddCommands)}
					{this.renderActionButton('add', 'Separator', this.addSeparator)}
					{this.renderActionButton('folder', 'Submenu', this.addSubmenu)}
					{this.renderActionButton('arrow-up', 'Move Up', () => this.moveSelected(-1), !this.canMoveSelected(-1))}
					{this.renderActionButton('arrow-down', 'Move Down', () => this.moveSelected(1), !this.canMoveSelected(1))}
					{/* Focus moves to the editor so it is not lost when the button becomes disabled. */}
					{this.renderActionButton('discard', 'Undo', () => {
						this.undo();
						this.rootNode?.focus();
					}, !this.canUndo())}
					{this.renderActionButton('redo', 'Redo', () => {
						this.redo();
						this.rootNode?.focus();
					}, !this.canRedo())}
					<div style={{ flex: 1 }} />
					{this.status && <span style={{ opacity: 0.7 }}>{this.status}</span>}
					<button type='button' className='theia-button secondary' onClick={this.restoreDefaults}>
						Restore Defaults
					</button>
				</div>
			</div>
		);
	}

	protected renderActionButton(
		icon: string,
		label: string,
		onClick: () => void,
		disabled = false
	): React.ReactNode {
		return (
			<button
				type='button'
				className='theia-button secondary'
				disabled={disabled}
				onClick={onClick}
				style={{
					alignItems: 'center',
					display: 'inline-flex',
					gap: '6px',
					justifyContent: 'center'
				}}
			>
				<span
					className={codicon(icon)}
					style={{
						alignItems: 'center',
						display: 'inline-flex',
						justifyContent: 'center',
						lineHeight: 1
					}}
				/>
				<span>{label}</span>
			</button>
		);
	}

	protected renderEntries(entries: EditableMenuEntry[], depth: number): React.ReactNode[] {
		const result: React.ReactNode[] = [];
		for (const entry of entries) {
			result.push(this.renderEntry(entry, depth));
			if (entry.type === 'item' && entry.submenu && this.expandedKeys.has(entry.key)) {
				const children = entry.children ?? [];
				result.push(
					<div key={`${entry.key}:children`}>
						{this.renderEntries(children, depth + 1)}
						<div
							onDragOver={event => {
								event.preventDefault();
								event.dataTransfer.dropEffect = 'move';
							}}
							onDrop={event => this.dropIntoSubmenu(event, entry.key)}
							style={{
								border: '1px dashed var(--theia-panel-border)',
								margin: `2px 8px 4px ${28 + (depth + 1) * 20}px`,
								opacity: 0.65,
								padding: '5px 8px',
								textAlign: 'center'
							}}
						>
							{children.length ? `Drop here to move to the end of ${entry.label}` : `Drop commands here to add them to ${entry.label}`}
						</div>
					</div>
				);
			}
		}
		return result;
	}

	protected renderEntry(entry: EditableMenuEntry, depth: number): React.ReactNode {
		const selected = entry.key === this.selectedKey;
		const paddingLeft = 8 + depth * 20;
		const dragIndicator = this.dragOverKey === entry.key
			? this.dragOverPosition === 'before'
				? 'inset 0 2px var(--theia-focusBorder)'
				: 'inset 0 -2px var(--theia-focusBorder)'
			: undefined;

		if (entry.type === 'separator') {
			return (
				<div
					key={entry.key}
					data-entry-key={entry.key}
					draggable={true}
					onDragStart={event => this.startDrag(event, entry.key)}
					onDragEnd={this.endDrag}
					onDragEnter={event => this.handleDragOver(event, entry.key)}
					onDragOver={event => this.handleDragOver(event, entry.key)}
					onDrop={event => this.dropAt(event, entry.key)}
					onClick={() => this.selectEntry(entry.key)}
					style={{
						alignItems: 'center',
						background: selected ? 'var(--theia-list-activeSelectionBackground)' : undefined,
						cursor: 'default',
						display: 'flex',
						height: '30px',
						boxShadow: dragIndicator,
						padding: `0 8px 0 ${paddingLeft}px`
					}}
				>
					{this.renderRowIcon('grabber', 'Drag to move', 'grab')}
					<div style={{ borderTop: '1px solid var(--theia-menu-separatorBackground)', flex: 1 }} />
					<span style={{ fontSize: '11px', margin: '0 8px', opacity: 0.6 }}>separator</span>
					<div style={{ borderTop: '1px solid var(--theia-menu-separatorBackground)', flex: 1 }} />
					{this.renderRemoveButton(entry.key)}
				</div>
			);
		}

		const expanded = entry.submenu && this.expandedKeys.has(entry.key);
		return (
			<div
				key={entry.key}
				data-entry-key={entry.key}
				draggable={this.renamingKey !== entry.key}
				onDragStart={event => this.startDrag(event, entry.key)}
				onDragEnd={this.endDrag}
				onDragEnter={event => this.handleDragOver(event, entry.key)}
				onDragOver={event => this.handleDragOver(event, entry.key)}
				onDrop={event => this.dropAt(event, entry.key)}
				onClick={() => this.selectEntry(entry.key)}
				onDoubleClick={() => this.openItemEditor(entry.key)}
				style={{
					alignItems: 'center',
					background: selected ? 'var(--theia-list-activeSelectionBackground)' : undefined,
					borderRadius: '2px',
					boxShadow: dragIndicator,
					cursor: 'default',
					display: 'flex',
					minHeight: '40px',
					padding: `2px 8px 2px ${paddingLeft}px`
				}}
			>
				{entry.submenu
					? (
						<span
							className={codicon(expanded ? 'chevron-down' : 'chevron-right')}
							role='button'
							tabIndex={0}
							title={expanded ? 'Collapse submenu' : 'Expand submenu'}
							onClick={event => {
								event.stopPropagation();
								this.toggleExpanded(entry.key);
							}}
							style={{
								alignItems: 'center',
								cursor: 'pointer',
								display: 'inline-flex',
								height: '22px',
								justifyContent: 'center',
								lineHeight: 1,
								marginRight: '5px',
								width: '18px'
							}}
						/>
					)
					: this.renderRowIcon('grabber', 'Drag to move', 'grab')}
				{entry.icon && (
					<span
						className={entry.icon}
						style={{
							alignItems: 'center',
							display: 'inline-flex',
							justifyContent: 'center',
							lineHeight: 1,
							marginRight: '8px',
							width: '16px'
						}}
					/>
				)}
				<div style={{ flex: 1, minWidth: 0 }}>
					{this.renamingKey === entry.key
						? (
							<input
								autoFocus={true}
								className='theia-input'
								value={this.renameValue}
								onClick={event => event.stopPropagation()}
								onChange={event => {
									this.renameValue = event.currentTarget.value;
									this.forceUpdate();
								}}
								onKeyDown={event => {
									if (event.key === 'Enter') {
										this.commitRename(entry);
									} else if (event.key === 'Escape') {
										this.cancelRename();
									}
								}}
								onBlur={() => this.commitRename(entry)}
								style={{ width: '100%' }}
							/>
						)
						: (
							<div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{entry.label}
							</div>
						)}
					<div
						title={entry.when}
						style={{
							fontSize: '11px',
							opacity: 0.6,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap'
						}}
					>
						{entry.commandId || 'submenu'}{entry.when ? `  ·  when: ${entry.when}` : ''}
					</div>
				</div>
				{entry.customSubmenu && (
					<span
						className={codicon('edit')}
						role='button'
						tabIndex={0}
						title='Rename submenu'
						onClick={event => {
							event.stopPropagation();
							this.startRename(entry);
						}}
						style={{
							alignItems: 'center',
							cursor: 'pointer',
							display: 'inline-flex',
							height: '22px',
							justifyContent: 'center',
							lineHeight: 1,
							marginLeft: '8px',
							width: '22px'
						}}
					/>
				)}
				{entry.custom && !entry.customSubmenu && (
					<span
						title='Added by Custom Context Menu'
						className={codicon('add')}
						style={{
							alignItems: 'center',
							display: 'inline-flex',
							justifyContent: 'center',
							lineHeight: 1,
							marginLeft: '8px'
						}}
					/>
				)}
				{this.renderRemoveButton(entry.key)}
			</div>
		);
	}

	protected renderRowIcon(icon: string, title: string, cursor: string): React.ReactNode {
		return (
			<span
				className={codicon(icon)}
				title={title}
				style={{
					alignItems: 'center',
					cursor,
					display: 'inline-flex',
					height: '22px',
					justifyContent: 'center',
					lineHeight: 1,
					marginRight: '5px',
					width: '18px'
				}}
			/>
		);
	}

	protected renderRemoveButton(key: string): React.ReactNode {
		return (
			<span
				className={codicon('close')}
				role='button'
				tabIndex={0}
				title='Remove from menu'
				onClick={event => {
					event.stopPropagation();
					this.removeEntry(key);
				}}
				style={{
					alignItems: 'center',
					cursor: 'pointer',
					display: 'inline-flex',
					height: '22px',
					justifyContent: 'center',
					lineHeight: 1,
					marginLeft: '8px',
					width: '22px'
				}}
			/>
		);
	}

	protected renderItemEditor(): React.ReactNode {
		const key = this.editingKey;
		const location = key ? this.findLocation(this.getEntries(), key) : undefined;
		if (!location || location.entry.type !== 'item') {
			this.mode = 'menu';
			this.editingKey = undefined;
			return this.renderMenuEditor();
		}
		const entry = location.entry;
		const inheritedLabel = entry.defaultLabel ?? entry.label;
		const inheritedWhen = entry.defaultWhen ?? '';
		const inheritedIcon = entry.defaultIcon ?? '';

		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%', minHeight: 0 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<button
						type='button'
						className='theia-button secondary'
						onClick={this.closeItemEditor}
						style={{ alignItems: 'center', display: 'inline-flex', gap: '6px', justifyContent: 'center' }}
					>
						<span className={codicon('arrow-left')} style={{ alignItems: 'center', display: 'inline-flex', lineHeight: 1 }} />
						<span>Back</span>
					</button>
					<strong>Edit Menu Item</strong>
					<span style={{ opacity: 0.65 }}>{entry.commandId || 'submenu'}</span>
				</div>

				<div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', alignItems: 'center', gap: '12px 14px' }}>
					<label>Name</label>
					<input
						autoFocus={true}
						className='theia-input'
						value={this.editLabel}
						onChange={event => {
							this.editLabel = event.currentTarget.value;
							this.forceUpdate();
						}}
					/>

					<label>Condition</label>
					<input
						className='theia-input'
						placeholder='Always visible'
						value={this.editWhen}
						onChange={event => {
							this.editWhen = event.currentTarget.value;
							this.forceUpdate();
						}}
					/>

					<label>Icon</label>
					<div style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
						<button
							type='button'
							className='theia-button secondary'
							onClick={() => void this.chooseIcon(entry)}
							style={{
								alignItems: 'center',
								display: 'inline-flex',
								gap: '8px',
								justifyContent: 'center'
							}}
						>
							<span
								className={this.editIcon || codicon('symbol-color')}
								style={{
									alignItems: 'center',
									display: 'inline-flex',
									fontSize: '16px',
									justifyContent: 'center',
									lineHeight: 1,
									width: '18px'
								}}
							/>
							<span>{this.editIcon ? 'Change Icon' : 'Choose Icon'}</span>
						</button>
						<button
							type='button'
							className='theia-button secondary'
							disabled={!this.editIcon}
							onClick={() => {
								this.editIcon = '';
								this.forceUpdate();
							}}
						>
							Clear
						</button>
						<span style={{ opacity: 0.65 }}>{this.editIcon || 'No icon'}</span>
					</div>
				</div>

				<div
					style={{
						background: 'var(--theia-editorWidget-background)',
						border: '1px solid var(--theia-panel-border)',
						padding: '10px 12px'
					}}
				>
					<div><strong>Original name:</strong> {inheritedLabel}</div>
					<div><strong>Original condition:</strong> {inheritedWhen || 'none'}</div>
					<div><strong>Original icon:</strong> {inheritedIcon || 'none'}</div>
					<div style={{ marginTop: '8px', opacity: 0.7 }}>
						Clearing Condition overrides an existing condition and makes the item unconditional. Clearing Icon class removes the icon.
					</div>
				</div>

				<div style={{ flex: 1 }} />

				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
					<button type='button' className='theia-button secondary' onClick={() => this.resetItemEditor(entry)}>
						Use Original Values
					</button>
					<button type='button' className='theia-button main' onClick={() => this.saveItemEditor(entry)}>
						Save Item
					</button>
				</div>
			</div>
		);
	}

	protected openItemEditor(key: string): void {
		const location = this.findLocation(this.getEntries(), key);
		if (!location || location.entry.type !== 'item') {
			return;
		}
		const entry = location.entry;
		this.editingKey = key;
		this.editLabel = entry.label;
		this.editWhen = entry.when ?? '';
		this.editIcon = entry.icon ?? '';
		this.mode = 'edit';
		this.forceUpdate();
	}

	protected async chooseIcon(entry: EditableMenuItem): Promise<void> {
		const dialog = this.props.iconDialogFactory({
			id: entry.commandId || entry.key,
			label: this.editLabel.trim() || entry.label,
			iconClass: this.editIcon || undefined
		});
		const selected = await dialog.open();
		if (selected !== undefined) {
			this.editIcon = selected;
			this.forceUpdate();
		}
	}

	protected closeItemEditor = (): void => {
		this.mode = 'menu';
		this.editingKey = undefined;
		this.forceUpdate();
	};

	protected resetItemEditor(entry: EditableMenuItem): void {
		this.editLabel = entry.defaultLabel ?? entry.label;
		this.editWhen = entry.defaultWhen ?? '';
		this.editIcon = entry.defaultIcon ?? '';
		this.forceUpdate();
	}

	protected saveItemEditor(entry: EditableMenuItem): void {
		this.edit(entries => {
			const location = this.findLocation(entries, entry.key);
			if (location?.entry.type !== 'item') {
				return false;
			}
			this.applyItemEditorValues(location.entry);
			return true;
		});
		this.mode = 'menu';
		this.editingKey = undefined;
		this.forceUpdate();
	}

	protected applyItemEditorValues(entry: EditableMenuItem): void {
		const label = this.editLabel.trim() || entry.defaultLabel || entry.label;
		const when = this.editWhen.trim();
		const icon = this.editIcon.trim();

		if (entry.customSubmenu) {
			entry.label = label;
			entry.when = when || undefined;
			entry.icon = icon || undefined;
			entry.whenOverride = when;
			entry.iconOverride = icon;
		} else {
			const defaultLabel = entry.defaultLabel ?? entry.label;
			const defaultWhen = entry.defaultWhen ?? '';
			const defaultIcon = entry.defaultIcon ?? '';
			entry.label = label;
			entry.when = when || undefined;
			entry.icon = icon || undefined;
			entry.labelOverride = label === defaultLabel ? undefined : label;
			entry.whenOverride = when === defaultWhen ? undefined : when;
			entry.iconOverride = icon === defaultIcon ? undefined : icon;
		}
	}

	protected renderAddCommands(): React.ReactNode {
		const choices = this.getAddChoices();
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', minHeight: 0 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
					<button
						type='button'
						className='theia-button secondary'
						onClick={this.closeAddCommands}
						style={{ alignItems: 'center', display: 'inline-flex', gap: '6px', justifyContent: 'center' }}
					>
						<span className={codicon('arrow-left')} style={{ alignItems: 'center', display: 'inline-flex', lineHeight: 1 }} />
						<span>Back</span>
					</button>
					<input
						autoFocus={true}
						className='theia-input'
						placeholder='Search commands'
						spellCheck={false}
						value={this.addFilter}
						onChange={event => {
							this.addFilter = event.currentTarget.value;
							this.selectedAddKey = undefined;
							this.forceUpdate();
						}}
						style={{ flex: 1 }}
					/>
				</div>

				<div
					style={{
						border: '1px solid var(--theia-panel-border)',
						flex: 1,
						minHeight: 0,
						overflow: 'auto',
						padding: '4px'
					}}
				>
					{choices.length
						? choices.map(choice => this.renderAddChoice(choice))
						: <div style={{ opacity: 0.7, padding: '18px', textAlign: 'center' }}>No matching commands.</div>}
				</div>

				<div style={{ display: 'flex', justifyContent: 'flex-end', flex: '0 0 auto' }}>
					<button
						type='button'
						className='theia-button main'
						disabled={!this.selectedAddKey}
						onClick={this.addSelectedChoice}
					>
						Add Command
					</button>
				</div>
			</div>
		);
	}

	protected renderAddChoice(choice: AddChoice): React.ReactNode {
		const selected = choice.key === this.selectedAddKey;
		return (
			<div
				key={choice.key}
				onClick={() => {
					this.selectedAddKey = choice.key;
					this.forceUpdate();
				}}
				onDoubleClick={() => this.addChoice(choice)}
				style={{
					background: selected ? 'var(--theia-list-activeSelectionBackground)' : undefined,
					borderRadius: '2px',
					cursor: 'default',
					minHeight: '36px',
					padding: '4px 8px'
				}}
			>
				<div>{choice.label}</div>
				<div style={{ fontSize: '11px', opacity: 0.6 }}>{choice.commandId}  ·  {choice.detail}</div>
			</div>
		);
	}

	protected handleTargetChange = (option: SelectOption): void => {
		if (typeof option.value !== 'string') {
			return;
		}
		this.activeTargetId = option.value;
		this.selectedKey = undefined;
		this.renamingKey = undefined;
		this.entries = undefined;
		this.forceUpdate();
	};

	protected openAddCommands = (): void => {
		this.mode = 'add';
		this.addFilter = '';
		this.selectedAddKey = undefined;
		this.forceUpdate();
	};

	protected closeAddCommands = (): void => {
		this.mode = 'menu';
		this.addFilter = '';
		this.selectedAddKey = undefined;
		this.forceUpdate();
	};

	protected addSelectedChoice = (): void => {
		if (!this.selectedAddKey) {
			return;
		}
		const choice = this.getAddChoices().find(candidate => candidate.key === this.selectedAddKey);
		if (choice) {
			this.addChoice(choice);
		}
	};

	protected addChoice(choice: AddChoice): void {
		this.edit(entries => {
			const destination = this.getInsertionLocation(entries);
			const entry = this.cloneEntry(choice.entry);
			if (entry.custom) {
				entry.storageKey = this.nextCustomStorageKey(entries);
				entry.key = `custom-command:${entry.storageKey}`;
			}
			destination.parent.splice(destination.index, 0, entry);
			this.selectedKey = entry.key;
			return true;
		});
		this.closeAddCommands();
	}

	protected getAddChoices(): AddChoice[] {
		const entries = this.getEntries();
		const existingKeys = new Set<string>();
		const existingCommandIds = new Set<string>();
		this.collectExisting(entries, existingKeys, existingCommandIds);

		const choices: AddChoice[] = [];
		const commandIdsAlreadyOffered = new Set<string>();
		for (const entry of this.collectDefaultCommands(this.props.service.getDefaultEntries(this.activeTargetId))) {
			if (!entry.commandId || existingKeys.has(entry.key)) {
				continue;
			}
			choices.push({
				key: `default:${entry.key}`,
				label: entry.label,
				commandId: entry.commandId,
				entry: this.cloneEntry(entry) as EditableMenuItem,
				detail: entry.when ? `Original menu item, when: ${entry.when}` : 'Original menu item'
			});
			commandIdsAlreadyOffered.add(entry.commandId);
		}

		const { recent, other } = this.props.quickCommandService.getCommands();
		const commands = this.dedupeCommands([...recent, ...other]);
		for (const command of commands) {
			if (existingCommandIds.has(command.id) || commandIdsAlreadyOffered.has(command.id)) {
				continue;
			}
			const defaultLabel = command.label || command.id;
			const entry: EditableMenuItem = {
				type: 'item',
				key: `custom:${command.id}`,
				storageKey: '',
				label: defaultLabel,
				commandId: command.id,
				icon: command.iconClass,
				custom: true,
				submenu: false,
				defaultLabel,
				defaultWhen: undefined,
				defaultIcon: command.iconClass
			};
			choices.push({
				key: entry.key,
				label: entry.label,
				commandId: command.id,
				entry,
				detail: 'Registered command'
			});
		}

		const query = this.addFilter.trim().toLocaleLowerCase();
		return choices
			.filter(choice => !query || choice.label.toLocaleLowerCase().includes(query) || choice.commandId.toLocaleLowerCase().includes(query))
			.sort((left, right) => left.label.localeCompare(right.label));
	}

	protected collectDefaultCommands(entries: EditableMenuEntry[], target: EditableMenuItem[] = []): EditableMenuItem[] {
		for (const entry of entries) {
			if (entry.type !== 'item') {
				continue;
			}
			if (entry.commandId) {
				target.push(entry);
			}
			if (entry.children) {
				this.collectDefaultCommands(entry.children, target);
			}
		}
		return target;
	}

	protected collectExisting(entries: EditableMenuEntry[], keys: Set<string>, commandIds: Set<string>): void {
		for (const entry of entries) {
			keys.add(entry.key);
			if (entry.type === 'item') {
				if (entry.commandId) {
					commandIds.add(entry.commandId);
				}
				if (entry.children) {
					this.collectExisting(entry.children, keys, commandIds);
				}
			}
		}
	}

	protected dedupeCommands(commands: Command[]): Command[] {
		const seen = new Set<string>();
		return commands.filter(command => {
			if (seen.has(command.id)) {
				return false;
			}
			seen.add(command.id);
			return true;
		});
	}

	protected getEntries(): EditableMenuEntry[] {
		return this.entries ??= this.props.service.getEntries(this.activeTargetId);
	}

	/**
	 * Applies an edit to the current menu of the active target, stores it, and records the previous
	 * stored value for undo. The view is rebuilt from the stored layout afterwards.
	 */
	protected edit(mutate: (entries: EditableMenuEntry[]) => boolean): void {
		const targetId = this.activeTargetId;
		const previous = this.props.service.getStoredValue(targetId);
		if (this.props.service.updateEntries(targetId, mutate)) {
			this.recordUndo(targetId, previous);
		}
	}

	protected recordUndo(targetId: string, previous: unknown): void {
		const history = this.history.get(targetId) ?? { undo: [], redo: [] };
		history.undo.push(previous);
		history.redo = [];
		this.history.set(targetId, history);
	}

	protected cloneEntries(entries: EditableMenuEntry[]): EditableMenuEntry[] {
		return entries.map(entry => this.cloneEntry(entry));
	}

	protected cloneEntry(entry: EditableMenuEntry): EditableMenuEntry {
		if (entry.type === 'separator') {
			return { ...entry };
		}
		return {
			...entry,
			children: entry.children ? this.cloneEntries(entry.children) : undefined
		};
	}

	protected selectEntry(key: string): void {
		this.selectedKey = key;
		this.forceUpdate();
	}

	protected toggleExpanded(key: string): void {
		if (this.expandedKeys.has(key)) {
			this.expandedKeys.delete(key);
		} else {
			this.expandedKeys.add(key);
		}
		this.forceUpdate();
	}

	protected startDrag(event: React.DragEvent<HTMLElement>, key: string): void {
		this.draggedKey = key;
		this.dragOverKey = undefined;
		this.dragOverPosition = undefined;
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('application/x-custom-context-menu-key', key);
		event.dataTransfer.setData('text/plain', key);
		event.dataTransfer.setDragImage(event.currentTarget, 12, 12);
	}

	protected endDrag = (): void => {
		this.draggedKey = undefined;
		this.dragOverKey = undefined;
		this.dragOverPosition = undefined;
		this.forceUpdate();
	};

	protected handleDragOver(event: React.DragEvent<HTMLElement>, targetKey: string): void {
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = 'move';
		const bounds = event.currentTarget.getBoundingClientRect();
		const position: 'before' | 'after' = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
		if (this.dragOverKey !== targetKey || this.dragOverPosition !== position) {
			this.dragOverKey = targetKey;
			this.dragOverPosition = position;
			this.forceUpdate();
		}
	}

	protected getDraggedKey(event: React.DragEvent<HTMLElement>): string | undefined {
		return this.draggedKey
			|| event.dataTransfer.getData('application/x-custom-context-menu-key')
			|| event.dataTransfer.getData('text/plain')
			|| undefined;
	}

	protected dropAt(event: React.DragEvent<HTMLElement>, targetKey: string): void {
		event.preventDefault();
		event.stopPropagation();
		const draggedKey = this.getDraggedKey(event);
		const bounds = event.currentTarget.getBoundingClientRect();
		const position = this.dragOverKey === targetKey && this.dragOverPosition
			? this.dragOverPosition
			: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
		this.endDrag();
		if (!draggedKey || draggedKey === targetKey) {
			return;
		}

		this.edit(entries => {
			const source = this.findLocation(entries, draggedKey);
			if (!source || !this.findLocation(entries, targetKey) || this.entryContainsKey(source.entry, targetKey)) {
				return false;
			}
			const [entry] = source.parent.splice(source.index, 1);
			const target = this.findLocation(entries, targetKey);
			if (!target) {
				return false;
			}
			target.parent.splice(target.index + (position === 'after' ? 1 : 0), 0, entry);
			return true;
		});
		this.selectedKey = draggedKey;
		this.forceUpdate();
	}

	protected dropIntoSubmenu(event: React.DragEvent<HTMLElement>, submenuKey: string): void {
		event.preventDefault();
		event.stopPropagation();
		const draggedKey = this.getDraggedKey(event);
		this.endDrag();
		if (!draggedKey || draggedKey === submenuKey) {
			return;
		}

		this.edit(entries => {
			const source = this.findLocation(entries, draggedKey);
			const submenu = this.findLocation(entries, submenuKey);
			if (!source || submenu?.entry.type !== 'item' || !submenu.entry.submenu || this.entryContainsKey(source.entry, submenuKey)) {
				return false;
			}
			const [entry] = source.parent.splice(source.index, 1);
			submenu.entry.children ??= [];
			submenu.entry.children.push(entry);
			return true;
		});
		this.expandedKeys.add(submenuKey);
		this.selectedKey = draggedKey;
		this.forceUpdate();
	}

	protected entryContainsKey(entry: EditableMenuEntry, key: string): boolean {
		if (entry.key === key) {
			return true;
		}
		if (entry.type === 'item' && entry.children) {
			return entry.children.some(child => this.entryContainsKey(child, key));
		}
		return false;
	}

	protected findLocation(entries: EditableMenuEntry[], key: string): EntryLocation | undefined {
		for (let index = 0; index < entries.length; index++) {
			const entry = entries[index];
			if (entry.key === key) {
				return {
					entry,
					parent: entries,
					index
				};
			}
			if (entry.type === 'item' && entry.children) {
				const child = this.findLocation(entry.children, key);
				if (child) {
					return child;
				}
			}
		}
		return undefined;
	}

	protected getInsertionLocation(entries: EditableMenuEntry[]): { parent: EditableMenuEntry[], index: number } {
		const selected = this.selectedKey ? this.findLocation(entries, this.selectedKey) : undefined;
		if (!selected) {
			return {
				parent: entries,
				index: entries.length
			};
		}
		return {
			parent: selected.parent,
			index: selected.index + 1
		};
	}

	/**
	 * Keys of added entries use their own namespace, so they never collide with contributed entries,
	 * even when an extension later contributes the same command.
	 */
	protected nextCustomStorageKey(entries: EditableMenuEntry[]): string {
		const used = new Set<string>();
		const collect = (children: EditableMenuEntry[]): void => {
			for (const entry of children) {
				used.add(entry.storageKey);
				if (entry.type === 'item' && entry.children) {
					collect(entry.children);
				}
			}
		};
		collect(entries);

		let index = 1;
		while (used.has(`custom:${index}`)) {
			index++;
		}
		return `custom:${index}`;
	}

	protected addSeparator = (): void => {
		this.edit(entries => {
			const destination = this.getInsertionLocation(entries);
			const storageKey = this.nextCustomStorageKey(entries);
			const separator = {
				type: 'separator' as const,
				key: `custom-separator:${storageKey}`,
				storageKey,
				custom: true
			};
			destination.parent.splice(destination.index, 0, separator);
			this.selectedKey = separator.key;
			return true;
		});
		this.forceUpdate();
	};

	protected addSubmenu = (): void => {
		let submenu: EditableMenuItem | undefined;
		this.edit(entries => {
			const destination = this.getInsertionLocation(entries);
			const storageKey = this.nextCustomStorageKey(entries);
			submenu = {
				type: 'item',
				key: `custom-submenu:${storageKey}`,
				storageKey,
				label: 'New Submenu',
				custom: true,
				submenu: true,
				customSubmenu: true,
				children: [],
				defaultLabel: 'New Submenu'
			};
			destination.parent.splice(destination.index, 0, submenu);
			return true;
		});
		if (submenu) {
			this.selectedKey = submenu.key;
			this.expandedKeys.add(submenu.key);
			this.startRename(submenu);
		}
	};

	protected startRename(entry: EditableMenuItem): void {
		if (!entry.customSubmenu) {
			return;
		}
		this.renamingKey = entry.key;
		this.renameValue = entry.label;
		this.forceUpdate();
	}

	protected commitRename(entry: EditableMenuItem): void {
		if (this.renamingKey !== entry.key) {
			return;
		}
		const value = this.renameValue.trim();
		this.renamingKey = undefined;
		this.renameValue = '';
		if (value) {
			this.edit(entries => {
				const location = this.findLocation(entries, entry.key);
				if (location?.entry.type !== 'item') {
					return false;
				}
				location.entry.label = value;
				return true;
			});
		}
		this.forceUpdate();
	}

	protected cancelRename(): void {
		this.renamingKey = undefined;
		this.renameValue = '';
		this.forceUpdate();
	}

	protected removeEntry(key: string): void {
		this.edit(entries => {
			const location = this.findLocation(entries, key);
			if (!location) {
				return false;
			}
			location.parent.splice(location.index, 1);
			if (location.entry.type === 'item' && location.entry.customSubmenu) {
				// Default entries moved into a custom submenu return to its position instead of being hidden.
				const rescued: EditableMenuEntry[] = [];
				const collectDefaults = (children: EditableMenuEntry[]): void => {
					for (const child of children) {
						if (!child.custom) {
							rescued.push(child);
						} else if (child.type === 'item' && child.children) {
							collectDefaults(child.children);
						}
					}
				};
				collectDefaults(location.entry.children ?? []);
				location.parent.splice(location.index, 0, ...rescued);
			}
			if (this.selectedKey === key) {
				this.selectedKey = location.parent[Math.min(location.index, location.parent.length - 1)]?.key;
			}
			return true;
		});
		this.expandedKeys.delete(key);
		this.forceUpdate();
	}

	protected canMoveSelected(direction: -1 | 1): boolean {
		const location = this.selectedKey ? this.findLocation(this.getEntries(), this.selectedKey) : undefined;
		if (!location) {
			return false;
		}
		const destination = location.index + direction;
		return destination >= 0 && destination < location.parent.length;
	}

	protected moveSelected(direction: -1 | 1): void {
		const selectedKey = this.selectedKey;
		if (!selectedKey) {
			return;
		}
		this.edit(entries => {
			const location = this.findLocation(entries, selectedKey);
			const destination = location ? location.index + direction : -1;
			if (!location || destination < 0 || destination >= location.parent.length) {
				return false;
			}
			[location.parent[location.index], location.parent[destination]] = [location.parent[destination], location.parent[location.index]];
			return true;
		});
		this.forceUpdate();
	}

	protected restoreDefaults = (): void => {
		const targetId = this.activeTargetId;
		const previous = this.props.service.getStoredValue(targetId);
		if (previous !== undefined) {
			this.recordUndo(targetId, previous);
			this.props.service.setStoredValue(targetId, undefined);
		}
		this.selectedKey = undefined;
		this.renamingKey = undefined;
		this.forceUpdate();
	};
}

/**
 * Routes Theia's Undo and Redo commands to the configurator that has focus. Text inputs are handled
 * first by Theia's DOM input handler, so they keep their native undo.
 */
@injectable()
export class ContextMenuConfigUndoRedoHandler implements UndoRedoHandler<ContextMenuConfigEditor> {
	readonly priority = 500;

	select(): ContextMenuConfigEditor | undefined {
		return [...ContextMenuConfigEditor.mounted].find(editor => editor.hasFocus());
	}

	undo(editor: ContextMenuConfigEditor): void {
		editor.undo();
	}

	redo(editor: ContextMenuConfigEditor): void {
		editor.redo();
	}
}
