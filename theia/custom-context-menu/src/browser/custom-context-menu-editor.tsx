import { Command } from '@theia/core';
import { codicon } from '@theia/core/lib/browser';
import { SelectComponent, SelectOption } from '@theia/core/lib/browser/widgets/select-component';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import * as React from '@theia/core/shared/react';
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
	height: string;
	showApply?: boolean;
}

export class ContextMenuConfigEditor extends React.Component<ContextMenuConfigEditorProps> {
	protected activeTargetId = 'editor';
	protected readonly drafts = new Map<string, EditableMenuEntry[]>();
	protected readonly dirtyTargets = new Set<string>();
	protected readonly resetTargets = new Set<string>();
	protected readonly expandedKeys = new Set<string>();
	protected selectedKey: string | undefined;
	protected draggedKey: string | undefined;
	protected mode: 'menu' | 'add' = 'menu';
	protected addFilter = '';
	protected selectedAddKey: string | undefined;
	protected separatorCounter = 0;
	protected submenuCounter = 0;
	protected renamingKey: string | undefined;
	protected renameValue = '';
	protected applyStatus = '';

	componentDidMount(): void {
		this.ensureDraft(this.activeTargetId);
	}

	getChanges(): ContextMenuConfigurationChanges {
		const layouts: Record<string, EditableMenuEntry[]> = {};
		for (const targetId of this.dirtyTargets) {
			layouts[targetId] = this.cloneEntries(this.ensureDraft(targetId));
		}
		return {
			layouts,
			resets: [...this.resetTargets]
		};
	}

	render(): React.ReactNode {
		return this.mode === 'add' ? this.renderAddCommands() : this.renderMenuEditor();
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

		if (entry.type === 'separator') {
			return (
				<div
					key={entry.key}
					draggable={true}
					onDragStart={event => this.startDrag(event, entry.key)}
					onDragEnd={this.endDrag}
					onDragOver={event => {
						event.preventDefault();
						event.dataTransfer.dropEffect = 'move';
					}}
					onDrop={event => this.dropBefore(event, entry.key)}
					onClick={() => this.selectEntry(entry.key)}
					style={{
						alignItems: 'center',
						background: selected ? 'var(--theia-list-activeSelectionBackground)' : undefined,
						cursor: 'default',
						display: 'flex',
						height: '30px',
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
				onDragOver={event => {
					event.preventDefault();
					event.dataTransfer.dropEffect = 'move';
				}}
				onDrop={event => this.dropBefore(event, entry.key)}
				onClick={() => this.selectEntry(entry.key)}
				style={{
					alignItems: 'center',
					background: selected ? 'var(--theia-list-activeSelectionBackground)' : undefined,
					borderRadius: '2px',
					cursor: 'default',
					display: 'flex',
					minHeight: '40px',
					padding: `2px 8px 2px ${paddingLeft}px`
				}}
			>
				{this.renderRowIcon('grabber', 'Drag to move', 'grab')}
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
					: <span style={{ display: 'inline-block', marginRight: '5px', width: '18px' }} />}
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
			const entry: EditableMenuItem = {
				type: 'item',
				key: `custom:${command.id}`,
				label: command.label || command.id,
				commandId: command.id,
				icon: command.iconClass,
				custom: true,
				submenu: false
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
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', key);
	}

	protected endDrag = (): void => {
		this.draggedKey = undefined;
	};

	protected dropBefore(event: React.DragEvent<HTMLElement>, targetKey: string): void {
		event.preventDefault();
		event.stopPropagation();
		const draggedKey = this.draggedKey;
		if (!draggedKey || draggedKey === targetKey) {
			return;
		}

		const root = this.ensureDraft(this.activeTargetId);
		const source = this.findLocation(root, draggedKey);
		const target = this.findLocation(root, targetKey);
		if (!source || !target || this.entryContainsKey(source.entry, targetKey)) {
			return;
		}

		const [entry] = source.parent.splice(source.index, 1);
		const refreshedTarget = this.findLocation(root, targetKey);
		if (!refreshedTarget) {
			source.parent.splice(source.index, 0, entry);
			return;
		}
		refreshedTarget.parent.splice(refreshedTarget.index, 0, entry);
		this.selectedKey = draggedKey;
		this.draggedKey = undefined;
		this.markModified();
		this.forceUpdate();
	}

	protected dropIntoSubmenu(event: React.DragEvent<HTMLElement>, submenuKey: string): void {
		event.preventDefault();
		event.stopPropagation();
		const draggedKey = this.draggedKey;
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

	protected addSeparator = (): void => {
		const destination = this.getInsertionLocation();
		const separator = {
			type: 'separator' as const,
			key: `custom-separator:${Date.now()}:${this.separatorCounter++}`
		};
		destination.parent.splice(destination.index, 0, separator);
		this.selectedKey = separator.key;
		this.markModified();
		this.forceUpdate();
	};

	protected addSubmenu = (): void => {
		const destination = this.getInsertionLocation();
		const submenu: EditableMenuItem = {
			type: 'item',
			key: `custom-submenu:${Date.now()}:${this.submenuCounter++}`,
			label: 'New Submenu',
			custom: true,
			submenu: true,
			customSubmenu: true,
			children: []
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
