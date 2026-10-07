import { Command, Disposable } from '@theia/core';
import { codicon, Dialog, DialogProps } from '@theia/core/lib/browser';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { SelectComponent, SelectOption } from '@theia/core/lib/browser/widgets/select-component';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { inject, injectable, interfaces, postConstruct } from '@theia/core/shared/inversify';
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

export const ContextMenuConfigDialogFactory = Symbol('ContextMenuConfigDialogFactory');
export interface ContextMenuConfigDialogFactory {
	(): ContextMenuConfigDialog;
}

@injectable()
export class ContextMenuConfigDialog extends ReactDialog<ContextMenuConfigurationChanges> {
	@inject(CustomContextMenuService)
	protected readonly service!: CustomContextMenuService;

	@inject(QuickCommandService)
	protected readonly quickCommandService!: QuickCommandService;

	protected activeTargetId = 'editor';
	protected readonly drafts = new Map<string, EditableMenuEntry[]>();
	protected readonly dirtyTargets = new Set<string>();
	protected readonly resetTargets = new Set<string>();
	protected selectedKey: string | undefined;
	protected draggedKey: string | undefined;
	protected mode: 'menu' | 'add' = 'menu';
	protected addFilter = '';
	protected selectedAddKey: string | undefined;
	protected separatorCounter = 0;

	constructor(
		@inject(DialogProps) protected override readonly props: DialogProps
	) {
		super(props);
	}

	@postConstruct()
	protected init(): void {
		this.node.id = 'custom-context-menu-config-dialog';
		this.contentNode.style.minWidth = '760px';
		this.contentNode.style.width = 'min(860px, 80vw)';
		this.contentNode.style.minHeight = '520px';
		this.contentNode.style.maxHeight = '75vh';
		this.contentNode.style.overflow = 'hidden';
		this.appendCloseButton(Dialog.CANCEL);
		this.appendAcceptButton('Save');
		this.ensureDraft(this.activeTargetId);
		this.toDispose.push(Disposable.create(() => {
			this.drafts.clear();
			this.dirtyTargets.clear();
			this.resetTargets.clear();
		}));
	}

	get value(): ContextMenuConfigurationChanges {
		const layouts: Record<string, EditableMenuEntry[]> = {};
		for (const targetId of this.dirtyTargets) {
			layouts[targetId] = this.cloneEntries(this.ensureDraft(targetId));
		}
		return {
			layouts,
			resets: [...this.resetTargets]
		};
	}

	protected render(): React.ReactNode {
		return this.mode === 'add' ? this.renderAddCommands() : this.renderMenuEditor();
	}

	protected renderMenuEditor(): React.ReactNode {
		const targets = this.service.getTargets();
		const entries = this.ensureDraft(this.activeTargetId);
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '520px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
					<label style={{ minWidth: '52px' }}>Menu:</label>
					<div style={{ width: '280px' }}>
						<SelectComponent
							options={targets.map(target => ({ value: target.id, label: target.label }))}
							defaultValue={this.activeTargetId}
							onChange={this.handleTargetChange}
						/>
					</div>
					<span style={{ opacity: 0.7 }}>
						Drag items to reorder. Existing visibility conditions stay attached to their commands.
					</span>
				</div>

				<div
					style={{
						border: '1px solid var(--theia-panel-border)',
						flex: 1,
						overflow: 'auto',
						padding: '4px'
					}}
				>
					{entries.length
						? entries.map(entry => this.renderEntry(entry))
						: <div style={{ opacity: 0.7, padding: '18px', textAlign: 'center' }}>This menu is empty.</div>}
				</div>

				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<button type='button' className='theia-button secondary' onClick={this.openAddCommands}>
						<span className={codicon('add')} /> Add Command
					</button>
					<button type='button' className='theia-button secondary' onClick={this.addSeparator}>
						<span className={codicon('add')} /> Separator
					</button>
					<button type='button' className='theia-button secondary' disabled={!this.canMoveSelected(-1)} onClick={() => this.moveSelected(-1)}>
						<span className={codicon('arrow-up')} /> Move Up
					</button>
					<button type='button' className='theia-button secondary' disabled={!this.canMoveSelected(1)} onClick={() => this.moveSelected(1)}>
						<span className={codicon('arrow-down')} /> Move Down
					</button>
					<div style={{ flex: 1 }} />
					<button type='button' className='theia-button secondary' onClick={this.restoreDefaults}>
						Restore Defaults
					</button>
				</div>
			</div>
		);
	}

	protected renderEntry(entry: EditableMenuEntry): React.ReactNode {
		const selected = entry.key === this.selectedKey;
		if (entry.type === 'separator') {
			return (
				<div
					key={entry.key}
					draggable={true}
					onDragStart={event => this.startDrag(event, entry.key)}
					onDragOver={event => event.preventDefault()}
					onDrop={event => this.dropBefore(event, entry.key)}
					onClick={() => this.selectEntry(entry.key)}
					style={{
						alignItems: 'center',
						background: selected ? 'var(--theia-list-activeSelectionBackground)' : undefined,
						cursor: 'default',
						display: 'flex',
						height: '30px',
						padding: '0 8px'
					}}
				>
					<span className={codicon('grabber')} style={{ cursor: 'grab', marginRight: '8px', opacity: 0.7 }} />
					<div style={{ borderTop: '1px solid var(--theia-menu-separatorBackground)', flex: 1 }} />
					<span style={{ fontSize: '11px', margin: '0 8px', opacity: 0.6 }}>separator</span>
					<div style={{ borderTop: '1px solid var(--theia-menu-separatorBackground)', flex: 1 }} />
					{this.renderRemoveButton(entry.key)}
				</div>
			);
		}

		return (
			<div
				key={entry.key}
				draggable={true}
				onDragStart={event => this.startDrag(event, entry.key)}
				onDragOver={event => event.preventDefault()}
				onDrop={event => this.dropBefore(event, entry.key)}
				onClick={() => this.selectEntry(entry.key)}
				style={{
					alignItems: 'center',
					background: selected ? 'var(--theia-list-activeSelectionBackground)' : undefined,
					borderRadius: '2px',
					cursor: 'default',
					display: 'flex',
					minHeight: '36px',
					padding: '2px 8px'
				}}
			>
				<span className={codicon('grabber')} style={{ cursor: 'grab', marginRight: '8px', opacity: 0.7 }} />
				{entry.icon && <span className={entry.icon} style={{ marginRight: '8px' }} />}
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						{entry.label}{entry.submenu ? '  ›' : ''}
					</div>
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
				{entry.custom && <span title='Added by Custom Context Menu' className={codicon('add')} style={{ marginRight: '8px', opacity: 0.6 }} />}
				{this.renderRemoveButton(entry.key)}
			</div>
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
				style={{ cursor: 'pointer', marginLeft: '8px' }}
			/>
		);
	}

	protected renderAddCommands(): React.ReactNode {
		const choices = this.getAddChoices();
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '520px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<button type='button' className='theia-button secondary' onClick={this.closeAddCommands}>
						<span className={codicon('arrow-left')} /> Back
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
							this.update();
						}}
						style={{ flex: 1 }}
					/>
				</div>

				<div
					style={{
						border: '1px solid var(--theia-panel-border)',
						flex: 1,
						overflow: 'auto',
						padding: '4px'
					}}
				>
					{choices.length
						? choices.map(choice => this.renderAddChoice(choice))
						: <div style={{ opacity: 0.7, padding: '18px', textAlign: 'center' }}>No matching commands.</div>}
				</div>

				<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
					this.update();
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
		this.ensureDraft(this.activeTargetId);
		this.update();
	};

	protected openAddCommands = (): void => {
		this.mode = 'add';
		this.addFilter = '';
		this.selectedAddKey = undefined;
		this.update();
	};

	protected closeAddCommands = (): void => {
		this.mode = 'menu';
		this.addFilter = '';
		this.selectedAddKey = undefined;
		this.update();
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
		const entries = this.ensureDraft(this.activeTargetId);
		const selectedIndex = this.selectedKey ? entries.findIndex(entry => entry.key === this.selectedKey) : -1;
		entries.splice(selectedIndex >= 0 ? selectedIndex + 1 : entries.length, 0, { ...choice.entry });
		this.selectedKey = choice.entry.key;
		this.markModified();
		this.closeAddCommands();
	}

	protected getAddChoices(): AddChoice[] {
		const entries = this.ensureDraft(this.activeTargetId);
		const existingKeys = new Set(entries.map(entry => entry.key));
		const existingCommandIds = new Set(entries.flatMap(entry => entry.type === 'item' && entry.commandId ? [entry.commandId] : []));
		const choices: AddChoice[] = [];
		const commandIdsAlreadyOffered = new Set<string>();

		for (const entry of this.service.getDefaultEntries(this.activeTargetId)) {
			if (entry.type !== 'item' || !entry.commandId || existingKeys.has(entry.key)) {
				continue;
			}
			choices.push({
				key: `default:${entry.key}`,
				label: entry.label,
				commandId: entry.commandId,
				entry: { ...entry },
				detail: entry.when ? `Original menu item, when: ${entry.when}` : 'Original menu item'
			});
			commandIdsAlreadyOffered.add(entry.commandId);
		}

		const { recent, other } = this.quickCommandService.getCommands();
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
			entries = this.cloneEntries(this.service.getDraftEntries(targetId));
			this.drafts.set(targetId, entries);
		}
		return entries;
	}

	protected cloneEntries(entries: EditableMenuEntry[]): EditableMenuEntry[] {
		return entries.map(entry => ({ ...entry }));
	}

	protected selectEntry(key: string): void {
		this.selectedKey = key;
		this.update();
	}

	protected startDrag(event: React.DragEvent<HTMLElement>, key: string): void {
		this.draggedKey = key;
		event.dataTransfer.effectAllowed = 'move';
	}

	protected dropBefore(event: React.DragEvent<HTMLElement>, targetKey: string): void {
		event.preventDefault();
		const draggedKey = this.draggedKey;
		this.draggedKey = undefined;
		if (!draggedKey || draggedKey === targetKey) {
			return;
		}

		const entries = this.ensureDraft(this.activeTargetId);
		const from = entries.findIndex(entry => entry.key === draggedKey);
		let to = entries.findIndex(entry => entry.key === targetKey);
		if (from < 0 || to < 0) {
			return;
		}

		const [entry] = entries.splice(from, 1);
		if (from < to) {
			to -= 1;
		}
		entries.splice(to, 0, entry);
		this.selectedKey = draggedKey;
		this.markModified();
		this.update();
	}

	protected addSeparator = (): void => {
		const entries = this.ensureDraft(this.activeTargetId);
		const selectedIndex = this.selectedKey ? entries.findIndex(entry => entry.key === this.selectedKey) : -1;
		const separator = {
			type: 'separator' as const,
			key: `custom-separator:${Date.now()}:${this.separatorCounter++}`
		};
		entries.splice(selectedIndex >= 0 ? selectedIndex + 1 : entries.length, 0, separator);
		this.selectedKey = separator.key;
		this.markModified();
		this.update();
	};

	protected removeEntry(key: string): void {
		const entries = this.ensureDraft(this.activeTargetId);
		const index = entries.findIndex(entry => entry.key === key);
		if (index < 0) {
			return;
		}
		entries.splice(index, 1);
		if (this.selectedKey === key) {
			this.selectedKey = entries[Math.min(index, entries.length - 1)]?.key;
		}
		this.markModified();
		this.update();
	}

	protected canMoveSelected(direction: -1 | 1): boolean {
		if (!this.selectedKey) {
			return false;
		}
		const entries = this.ensureDraft(this.activeTargetId);
		const index = entries.findIndex(entry => entry.key === this.selectedKey);
		const destination = index + direction;
		return index >= 0 && destination >= 0 && destination < entries.length;
	}

	protected moveSelected(direction: -1 | 1): void {
		if (!this.selectedKey) {
			return;
		}
		const entries = this.ensureDraft(this.activeTargetId);
		const index = entries.findIndex(entry => entry.key === this.selectedKey);
		const destination = index + direction;
		if (index < 0 || destination < 0 || destination >= entries.length) {
			return;
		}
		[entries[index], entries[destination]] = [entries[destination], entries[index]];
		this.markModified();
		this.update();
	}

	protected restoreDefaults = (): void => {
		this.drafts.set(this.activeTargetId, this.cloneEntries(this.service.getDefaultEntries(this.activeTargetId)));
		this.resetTargets.add(this.activeTargetId);
		this.dirtyTargets.delete(this.activeTargetId);
		this.selectedKey = undefined;
		this.update();
	};

	protected markModified(): void {
		this.resetTargets.delete(this.activeTargetId);
		this.dirtyTargets.add(this.activeTargetId);
	}
}

export function bindContextMenuConfigDialog(bind: interfaces.Bind): void {
	bind(ContextMenuConfigDialogFactory).toFactory(context => (): ContextMenuConfigDialog => {
		const child = context.container.createChild();
		child.bind(DialogProps).toConstantValue({
			title: 'Configure Context Menus',
			maxWidth: 900
		});
		child.bind(ContextMenuConfigDialog).toSelf();
		return child.get(ContextMenuConfigDialog);
	});
}
