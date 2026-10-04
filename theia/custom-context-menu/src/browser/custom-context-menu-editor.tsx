import { Command } from '@theia/core';
import { codicon } from '@theia/core/lib/browser';
import { SelectComponent, SelectOption } from '@theia/core/lib/browser/widgets/select-component';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import * as React from '@theia/core/shared/react';
import { ToolbarIconDialogFactory } from '@theia/toolbar/lib/browser/toolbar-icon-selector-dialog';
import {
	ContextMenuConfigurationChanges,
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

export interface ContextMenuConfigEditorProps {
	service: CustomContextMenuService;
	quickCommandService: QuickCommandService;
	iconDialogFactory: ToolbarIconDialogFactory;
	height: string;
	showApply?: boolean;
}

export interface ContextMenuConfigEditorState {
	activeTargetId: string;
	drafts: Record<string, EditableMenuEntry[]>;
	dirtyTargets: string[];
	resetTargets: string[];
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
	applyStatus: string;
}

export class ContextMenuConfigEditor extends React.Component<ContextMenuConfigEditorProps> {
	protected activeTargetId = 'editor';
	protected readonly drafts = new Map<string, EditableMenuEntry[]>();
	protected readonly dirtyTargets = new Set<string>();
	protected readonly resetTargets = new Set<string>();
	protected readonly expandedKeys = new Set<string>();
	protected selectedKey: string | undefined;
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
	protected applyStatus = '';

	componentDidMount(): void {
		this.ensureDraft(this.activeTargetId);
	}

	getChanges(): ContextMenuConfigurationChanges {
		this.flushPendingItemEdit();
		const layouts: Record<string, EditableMenuEntry[]> = {};
		for (const targetId of this.dirtyTargets) {
			layouts[targetId] = this.cloneEntries(this.ensureDraft(targetId));
		}
		return {
			layouts,
			resets: [...this.resetTargets]
		};
	}

	captureState(): ContextMenuConfigEditorState {
		const drafts: Record<string, EditableMenuEntry[]> = {};
		for (const [targetId, entries] of this.drafts) {
			drafts[targetId] = this.cloneEntries(entries);
		}
		return {
			activeTargetId: this.activeTargetId,
			drafts,
			dirtyTargets: [...this.dirtyTargets],
			resetTargets: [...this.resetTargets],
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
			renameValue: this.renameValue,
			applyStatus: this.applyStatus
		};
	}

	restoreState(state: ContextMenuConfigEditorState): void {
		this.activeTargetId = state.activeTargetId;
		this.drafts.clear();
		for (const [targetId, entries] of Object.entries(state.drafts)) {
			this.drafts.set(targetId, this.cloneEntries(entries));
		}

		this.dirtyTargets.clear();
		for (const targetId of state.dirtyTargets) {
			this.dirtyTargets.add(targetId);
		}

		this.resetTargets.clear();
		for (const targetId of state.resetTargets) {
			this.resetTargets.add(targetId);
		}

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
		this.applyStatus = state.applyStatus;
		this.draggedKey = undefined;
		this.dragOverKey = undefined;
		this.dragOverPosition = undefined;
		this.ensureDraft(this.activeTargetId);
		this.forceUpdate();
	}

	render(): React.ReactNode {
		if (this.mode === 'add') {
			return this.renderAddCommands();
		}
		if (this.mode === 'edit') {
			return this.renderItemEditor();
		}
		return this.renderMenuEditor();
	}

	protected renderMenuEditor(): React.ReactNode {
		const targets = this.props.service.getTargets();
		const entries = this.ensureDraft(this.activeTargetId);
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: this.props.height, minHeight: 0 }}>
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
					<div style={{ flex: 1 }} />
					{this.applyStatus && <span style={{ opacity: 0.7 }}>{this.applyStatus}</span>}
					<button type='button' className='theia-button secondary' onClick={this.restoreDefaults}>
						Restore Defaults
					</button>
					{this.props.showApply && (
						<button
							type='button'
							className='theia-button main'
							disabled={!this.hasChanges()}
							onClick={this.applyChanges}
						>
							Apply
						</button>
					)}
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
		const location = key ? this.findLocation(this.ensureDraft(this.activeTargetId), key) : undefined;
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
			<div style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: this.props.height, minHeight: 0 }}>
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
		const location = this.findLocation(this.ensureDraft(this.activeTargetId), key);
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
		this.applyItemEditorValues(entry);
		this.mode = 'menu';
		this.editingKey = undefined;
		this.forceUpdate();
	}

	protected flushPendingItemEdit(): void {
		if (this.mode !== 'edit' || !this.editingKey) {
			return;
		}
		const location = this.findLocation(this.ensureDraft(this.activeTargetId), this.editingKey);
		if (location?.entry.type === 'item') {
			this.applyItemEditorValues(location.entry);
		}
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
		this.markModified();
	}

	protected renderAddCommands(): React.ReactNode {
		const choices = this.getAddChoices();
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: this.props.height, minHeight: 0 }}>
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
		this.ensureDraft(this.activeTargetId);
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
		const destination = this.getInsertionLocation();
		destination.parent.splice(destination.index, 0, this.cloneEntry(choice.entry));
		this.selectedKey = choice.entry.key;
		this.markModified();
		this.closeAddCommands();
	}

	protected getAddChoices(): AddChoice[] {
		const entries = this.ensureDraft(this.activeTargetId);
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
				storageKey: command.id,
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

	protected ensureDraft(targetId: string): EditableMenuEntry[] {
		let entries = this.drafts.get(targetId);
		if (!entries) {
			entries = this.cloneEntries(this.props.service.getDraftEntries(targetId));
			this.drafts.set(targetId, entries);
		}
		return entries;
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
		if (!draggedKey || draggedKey === targetKey) {
			this.endDrag();
			return;
		}

		const root = this.ensureDraft(this.activeTargetId);
		const source = this.findLocation(root, draggedKey);
		const target = this.findLocation(root, targetKey);
		if (!source || !target || this.entryContainsKey(source.entry, targetKey)) {
			this.endDrag();
			return;
		}

		const bounds = event.currentTarget.getBoundingClientRect();
		const position = this.dragOverKey === targetKey && this.dragOverPosition
			? this.dragOverPosition
			: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
		const [entry] = source.parent.splice(source.index, 1);
		const refreshedTarget = this.findLocation(root, targetKey);
		if (!refreshedTarget) {
			source.parent.splice(source.index, 0, entry);
			this.endDrag();
			return;
		}
		const insertionIndex = refreshedTarget.index + (position === 'after' ? 1 : 0);
		refreshedTarget.parent.splice(insertionIndex, 0, entry);
		this.selectedKey = draggedKey;
		this.draggedKey = undefined;
		this.dragOverKey = undefined;
		this.dragOverPosition = undefined;
		this.markModified();
		this.forceUpdate();
	}

	protected dropIntoSubmenu(event: React.DragEvent<HTMLElement>, submenuKey: string): void {
		event.preventDefault();
		event.stopPropagation();
		const draggedKey = this.getDraggedKey(event);
		if (!draggedKey || draggedKey === submenuKey) {
			return;
		}

		const root = this.ensureDraft(this.activeTargetId);
		const source = this.findLocation(root, draggedKey);
		const submenuLocation = this.findLocation(root, submenuKey);
		if (!source || !submenuLocation || submenuLocation.entry.type !== 'item' || !submenuLocation.entry.submenu) {
			return;
		}
		if (this.entryContainsKey(source.entry, submenuKey)) {
			return;
		}

		const [entry] = source.parent.splice(source.index, 1);
		submenuLocation.entry.children ??= [];
		submenuLocation.entry.children.push(entry);
		this.expandedKeys.add(submenuKey);
		this.selectedKey = draggedKey;
		this.draggedKey = undefined;
		this.dragOverKey = undefined;
		this.dragOverPosition = undefined;
		this.markModified();
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

	protected getInsertionLocation(): { parent: EditableMenuEntry[], index: number } {
		const root = this.ensureDraft(this.activeTargetId);
		if (!this.selectedKey) {
			return {
				parent: root,
				index: root.length
			};
		}
		const selected = this.findLocation(root, this.selectedKey);
		if (!selected) {
			return {
				parent: root,
				index: root.length
			};
		}
		return {
			parent: selected.parent,
			index: selected.index + 1
		};
	}

	protected nextCustomStorageKey(prefix: string): string {
		const used = new Set<string>();
		const collect = (entries: EditableMenuEntry[]): void => {
			for (const entry of entries) {
				used.add(entry.storageKey);
				if (entry.type === 'item' && entry.children) {
					collect(entry.children);
				}
			}
		};
		collect(this.ensureDraft(this.activeTargetId));

		let index = 1;
		while (used.has(`${prefix}${index}`)) {
			index++;
		}
		return `${prefix}${index}`;
	}

	protected addSeparator = (): void => {
		const destination = this.getInsertionLocation();
		const storageKey = this.nextCustomStorageKey('sep');
		const separator = {
			type: 'separator' as const,
			key: `custom-separator:${storageKey}`,
			storageKey,
			custom: true
		};
		destination.parent.splice(destination.index, 0, separator);
		this.selectedKey = separator.key;
		this.markModified();
		this.forceUpdate();
	};

	protected addSubmenu = (): void => {
		const destination = this.getInsertionLocation();
		const storageKey = this.nextCustomStorageKey('submenu');
		const submenu: EditableMenuItem = {
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
		this.selectedKey = submenu.key;
		this.expandedKeys.add(submenu.key);
		this.markModified();
		this.startRename(submenu);
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
		if (value) {
			entry.label = value;
			this.markModified();
		}
		this.renamingKey = undefined;
		this.renameValue = '';
		this.forceUpdate();
	}

	protected cancelRename(): void {
		this.renamingKey = undefined;
		this.renameValue = '';
		this.forceUpdate();
	}

	protected removeEntry(key: string): void {
		const entries = this.ensureDraft(this.activeTargetId);
		const location = this.findLocation(entries, key);
		if (!location) {
			return;
		}
		location.parent.splice(location.index, 1);
		this.expandedKeys.delete(key);
		if (this.selectedKey === key) {
			this.selectedKey = location.parent[Math.min(location.index, location.parent.length - 1)]?.key;
		}
		this.markModified();
		this.forceUpdate();
	}

	protected canMoveSelected(direction: -1 | 1): boolean {
		if (!this.selectedKey) {
			return false;
		}
		const entries = this.ensureDraft(this.activeTargetId);
		const location = this.findLocation(entries, this.selectedKey);
		if (!location) {
			return false;
		}
		const destination = location.index + direction;
		return destination >= 0 && destination < location.parent.length;
	}

	protected moveSelected(direction: -1 | 1): void {
		if (!this.selectedKey) {
			return;
		}
		const entries = this.ensureDraft(this.activeTargetId);
		const location = this.findLocation(entries, this.selectedKey);
		if (!location) {
			return;
		}
		const destination = location.index + direction;
		if (destination < 0 || destination >= location.parent.length) {
			return;
		}
		[location.parent[location.index], location.parent[destination]] = [location.parent[destination], location.parent[location.index]];
		this.markModified();
		this.forceUpdate();
	}

	protected restoreDefaults = (): void => {
		this.drafts.set(this.activeTargetId, this.cloneEntries(this.props.service.getDefaultEntries(this.activeTargetId)));
		this.resetTargets.add(this.activeTargetId);
		this.dirtyTargets.delete(this.activeTargetId);
		this.selectedKey = undefined;
		this.renamingKey = undefined;
		this.applyStatus = '';
		this.forceUpdate();
	};

	protected hasChanges(): boolean {
		return this.dirtyTargets.size > 0 || this.resetTargets.size > 0;
	}

	protected applyChanges = async (): Promise<void> => {
		if (!this.hasChanges()) {
			return;
		}
		this.applyStatus = 'Applying...';
		this.forceUpdate();
		await this.props.service.applyChanges(this.getChanges());
		this.dirtyTargets.clear();
		this.resetTargets.clear();
		this.applyStatus = 'Applied';
		this.forceUpdate();
	};

	protected markModified(): void {
		this.resetTargets.delete(this.activeTargetId);
		this.dirtyTargets.add(this.activeTargetId);
		this.applyStatus = '';
	}
}
