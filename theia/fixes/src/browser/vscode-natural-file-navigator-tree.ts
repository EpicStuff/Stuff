import { CompositeTreeNode, TreeNode } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';
import { DirNode, FileStatNode } from '@theia/filesystem/lib/browser/file-tree/file-tree';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { FileNavigatorTree } from '@theia/navigator/lib/browser/navigator-tree';
import { compareExplorerNames } from './natural-explorer-sort';

/** Make Explorer name sorting numeric without changing other file trees. */
@injectable()
export class VSCodeNaturalFileNavigatorTree extends FileNavigatorTree {
	protected override async toNodes(fileStat: FileStat, parent: CompositeTreeNode): Promise<TreeNode[]> {
		const nodes = await super.toNodes(fileStat, parent);
		return nodes.sort((left, right) => {
			const directoryOrder = DirNode.dirCompare(left, right);
			if (directoryOrder) {
				return directoryOrder;
			}
			if (FileStatNode.is(left) && FileStatNode.is(right)) {
				return compareExplorerNames(left.uri.displayName, right.uri.displayName);
			}
			return DirNode.uriCompare(left, right);
		});
	}
}
